import { savedText } from './save-helpers';
import { expect, test, type Page } from '@playwright/test';

const key = 'chain-incantation.save.v1';
const cues = ['ui-select', 'ui-confirm', 'ui-reward', 'hit-light', 'hit-heavy', 'shield', 'spell-line', 'spell-box', 'spell-cross', 'sheet-clear', 'growth', 'cast'];

interface AudioAudit {
  requests: { asset: string; status: number; bytes?: number }[];
  decoded: { asset: string; duration: number; channels: number; sampleRate: number; peak: number; rms: number }[];
  started: { asset: string; at: number; rate: number; wall: number }[];
  stopped: { asset: string; at: number; when: number }[];
  tones: { frequency: number; at: number }[];
  failed: { asset: string; message: string }[];
  active: string[];
  activePeak: number;
}

/** Observe native fetch, decoding and buffer playback; the real audio path remains intact. */
function instrumentAudio(names: string[]): void {
  const audit: AudioAudit = { requests: [], decoded: [], started: [], stopped: [], tones: [], failed: [], active: [], activePeak: 0 };
  const contexts = new Set<AudioContext>();
  Object.assign(window, { audioAudit: audit, audioContexts: contexts });
  const buffers = new WeakMap<AudioBuffer, string>();
  const bytes = new Map<string, string>();
  const active = new Set<AudioScheduledSourceNode>();
  const sourceNames = new WeakMap<AudioScheduledSourceNode, string>();
  const fingerprint = (buffer: ArrayBuffer) => {
    const values = new Uint8Array(buffer);
    return `${values.length}:${[...values.slice(0, 24), ...values.slice(-24)].join(',')}`;
  };
  const assetName = (url: string) => names.find(name => new RegExp(`/${name}(?:-[\\w-]+)?\\.mp3(?:[?#]|$)`).test(url));
  const updateActive = () => { audit.active = [...active].map(source => sourceNames.get(source) ?? 'generated'); audit.activePeak = Math.max(audit.activePeak, active.size); };
  const createGain = AudioContext.prototype.createGain;
  AudioContext.prototype.createGain = function (): GainNode { contexts.add(this); return createGain.call(this); };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    const asset = assetName(response.url || String(args[0]));
    if (asset) {
      const entry: AudioAudit['requests'][number] = { asset, status: response.status };
      audit.requests.push(entry);
      const arrayBuffer = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => {
        const result = await arrayBuffer();
        entry.bytes = result.byteLength;
        bytes.set(fingerprint(result), asset);
        return result;
      };
    }
    return response;
  };
  const decode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = function (data: ArrayBuffer, success?: ((value: AudioBuffer) => void) | null, failure?: ((error: DOMException) => void) | null): Promise<AudioBuffer> {
    const asset = bytes.get(fingerprint(data)) ?? 'unknown';
    return decode.call(this, data).then(buffer => {
      buffers.set(buffer, asset);
      const samples = buffer.getChannelData(0);
      let peak = 0, squares = 0, count = 0;
      const stride = Math.max(1, Math.floor(samples.length / 10000));
      for (let i = 0; i < samples.length; i += stride) { peak = Math.max(peak, Math.abs(samples[i])); squares += samples[i] ** 2; count++; }
      audit.decoded.push({ asset, duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, peak, rms: Math.sqrt(squares / count) });
      success?.(buffer);
      return buffer;
    }, error => {
      audit.failed.push({ asset, message: String(error) });
      failure?.(error);
      throw error;
    });
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when?: number, offset?: number, duration?: number): void {
    const asset = this.buffer ? buffers.get(this.buffer) ?? 'generated' : 'generated';
    sourceNames.set(this, asset);
    audit.started.push({ asset, at: this.context.currentTime, rate: this.playbackRate.value, wall: performance.now() });
    active.add(this);
    updateActive();
    this.addEventListener('ended', () => { active.delete(this); updateActive(); }, { once: true });
    start.call(this, when ?? 0, offset ?? 0, duration);
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (when?: number): void {
    audit.stopped.push({ asset: sourceNames.get(this) ?? 'generated', at: this.context.currentTime, when: when ?? 0 });
    stop.call(this, when ?? 0);
    // Closing a context can suppress its queued ended event. An immediate stop
    // has already removed the source from audible playback at this point.
    if (when === undefined || when <= this.context.currentTime) { active.delete(this); updateActive(); }
  };
  const toneStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when?: number): void {
    sourceNames.set(this, 'tone');
    audit.tones.push({ frequency: this.frequency.value, at: this.context.currentTime });
    active.add(this); updateActive();
    this.addEventListener('ended', () => { active.delete(this); updateActive(); }, { once: true });
    toneStart.call(this, when ?? 0);
  };
  const toneStop = OscillatorNode.prototype.stop;
  OscillatorNode.prototype.stop = function (when?: number): void {
    audit.stopped.push({ asset: 'tone', at: this.context.currentTime, when: when ?? 0 });
    toneStop.call(this, when ?? 0);
    if (when === undefined || when <= this.context.currentTime) { active.delete(this); updateActive(); }
  };
}

async function audit(page: Page): Promise<AudioAudit> {
  return page.evaluate(() => (window as unknown as { audioAudit: AudioAudit }).audioAudit);
}

async function ready(page: Page): Promise<void> {
  await expect.poll(async () => new Set((await audit(page)).decoded.map(item => item.asset)).size, { intervals: [50], timeout: 10000 }).toBe(12);
}

async function finished(page: Page): Promise<void> {
  await expect(page.locator('.combat-effects, .completion-cutin')).toHaveCount(0);
}

async function fixture(page: Page, kind: 'chain' | 'sheet' | 'victory'): Promise<number> {
  await page.goto('/');
  const cell = await page.evaluate(async ({ key, kind }) => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, previewAction } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    for (let seed = 21; seed < 80; seed++) {
      const save = startRun(newSave(), 'fuse', seed);
      save.meta.tutorialDone = true;
      if (kind === 'sheet') {
        const cell = save.run.cells.findIndex((value: number) => !value);
        save.run.cells = [...save.run.solution];
        save.run.cells[cell] = 0;
        localStorage.setItem(key, JSON.stringify(save));
        return cell;
      }
      if (kind === 'victory') save.run.enemyHp = 1;
      for (const cell of singles(save.run.cells)) {
        const report = previewAction(save.run, cell);
        if (kind === 'chain' && (report.path.length !== 5 || !report.units || !report.received || report.defeated)) continue;
        localStorage.setItem(key, JSON.stringify(save));
        return cell;
      }
    }
    throw new Error('No audio gameplay fixture found');
  }, { key, kind });
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  return cell;
}

test.beforeEach(async ({ page }) => { await page.addInitScript(instrumentAudio, cues); });

test('sound starts muted; enabling it loads twelve real MP3 buffers and gameplay plays the matching cues', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const cell = await fixture(page, 'chain');
  expect((await audit(page)).requests).toEqual([]);
  expect((await audit(page)).decoded).toEqual([]);
  await page.getByRole('button', { name: '音なし：音をオンにする', exact: true }).click();
  await ready(page);
  const loaded = await audit(page);
  expect(loaded.requests).toHaveLength(12);
  expect(loaded.requests.every(item => item.status === 200 && item.bytes! > 100)).toBe(true);
  expect(loaded.decoded.every(item => item.asset !== 'unknown' && item.duration > 0 && item.channels > 0 && item.sampleRate > 0 && item.peak > 0 && item.rms > 0)).toBe(true);
  await page.locator(`[data-cell="${cell}"]`).click();
  await page.locator('[data-action="cast"]').click();
  await finished(page);
  const played = (await audit(page)).started.map(item => item.asset);
  expect(played).toContain('ui-select');
  expect(played).toContain('cast');
  expect(played).toContain('hit-light');
  expect(played.some(name => name.startsWith('spell-'))).toBe(true);
  expect((await audit(page)).tones.length).toBeGreaterThan(0);
  expect((await audit(page)).failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('mobile full-sheet completion plays its seal, shield, sheet-clear and growth sounds', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cell = await fixture(page, 'sheet');
  await page.getByRole('button', { name: '音なし：音をオンにする', exact: true }).click();
  await ready(page);
  await page.locator(`[data-cell="${cell}"]`).click();
  await page.locator('[data-action="cast"]').click();
  await finished(page);
  const played = (await audit(page)).started.map(item => item.asset);
  for (const name of ['cast', 'spell-cross', 'hit-light', 'shield', 'sheet-clear', 'growth']) expect(played).toContain(name);
  const run = await savedText(page, key).then(raw => JSON.parse(raw!).run);
  expect(run.sheet).toBe(2);
  expect(run.phase).toBe('battle');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('muting during a cast stops active samples and later phases stay silent while the move finishes', async ({ page }) => {
  const cell = await fixture(page, 'chain');
  await page.getByRole('button', { name: '音なし：音をオンにする', exact: true }).click();
  await ready(page);
  await page.locator(`[data-cell="${cell}"]`).click();
  await page.locator('[data-action="cast"]').click();
  await expect.poll(async () => (await audit(page)).active.length, { intervals: [10] }).toBeGreaterThan(0);
  const before = await audit(page);
  await page.getByRole('button', { name: '音あり：消音する', exact: true }).click();
  await expect(page.locator('[data-action="cast"]')).toHaveText(/詠唱中/);
  await expect.poll(async () => (await audit(page)).active.length, { intervals: [10] }).toBe(0);
  const muted = await audit(page);
  expect(muted.stopped.length).toBeGreaterThan(before.stopped.length);
  await finished(page);
  expect((await audit(page)).started).toHaveLength(muted.started.length);
  expect(await savedText(page, key).then(raw => JSON.parse(raw!).run.stats.moves)).toBe(1);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).settings.sound, key)).toBe(false);
});

test('failed sound downloads do not stop casting, damage, progression or saving', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\.mp3(?:[?#]|$)/, route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing test sound' }));
  const cell = await fixture(page, 'sheet');
  await page.getByRole('button', { name: '音なし：音をオンにする', exact: true }).click();
  await expect.poll(async () => (await audit(page)).requests.length, { intervals: [50] }).toBe(12);
  expect((await audit(page)).requests.every(item => item.status === 404)).toBe(true);
  await page.locator(`[data-cell="${cell}"]`).click();
  await page.locator('[data-action="cast"]').click();
  await finished(page);
  const committed = await savedText(page, key).then(raw => JSON.parse(raw!));
  expect(committed.run.stats.moves).toBe(1);
  expect(committed.run.sheet).toBe(2);
  await page.reload();
  expect(await savedText(page, key).then(raw => JSON.parse(raw!))).toEqual(committed);
  expect(errors).toEqual([]);
});

test('all twelve cues use decoded samples and rapid duplicates are limited', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '音なし：音をオンにする', exact: true }).click();
  await ready(page);
  const decodedBefore = (await audit(page)).decoded.length;
  await page.evaluate(async () => {
    const path = '/src/ui/audio.ts';
    const { IncantationAudio } = await import(/* @vite-ignore */ path);
    const probe = new IncantationAudio();
    probe.setEnabled(true);
    probe.unlock();
    Object.assign(window, { audioProbe: probe });
  });
  await expect.poll(async () => (await audit(page)).decoded.length, { intervals: [50], timeout: 10000 }).toBeGreaterThanOrEqual(decodedBefore + 12);
  await page.evaluate(async () => {
    const probe = (window as unknown as { audioProbe: { ui(kind: string): void; cast(): void; impact(chain: number, defeated?: boolean): void; attack(received: number, blocked?: boolean): void; completion(kind: string): void; sheetClear(): void; growth(): void } }).audioProbe;
    const calls = [() => probe.ui('select'), () => probe.ui('confirm'), () => probe.ui('reward'), () => probe.cast(), () => probe.impact(3), () => probe.impact(10), () => probe.attack(0, true), () => probe.completion('line'), () => probe.completion('box'), () => probe.completion('cross'), () => probe.sheetClear(), () => probe.growth()];
    for (const call of calls) { call(); await new Promise(resolve => setTimeout(resolve, 160)); }
  });
  expect(new Set((await audit(page)).started.map(item => item.asset))).toEqual(new Set(cues));
  const before = (await audit(page)).started.length;
  await page.evaluate(() => {
    const probe = (window as unknown as { audioProbe: { ui(kind: string): void } }).audioProbe;
    for (let index = 0; index < 100; index++) probe.ui('select');
  });
  const emitted = (await audit(page)).started.length - before;
  expect(emitted).toBeLessThanOrEqual(1);
  await page.evaluate(async () => {
    const probe = (window as unknown as { audioProbe: { note(ordinal: number, completion: boolean): void } }).audioProbe;
    for (let ordinal = 1; ordinal <= 40; ordinal++) { probe.note(ordinal, true); await new Promise(resolve => setTimeout(resolve, 20)); }
  });
  expect((await audit(page)).activePeak).toBeLessThanOrEqual(24);
  await page.evaluate(() => (window as unknown as { audioProbe: { dispose(): void } }).audioProbe.dispose());
  await expect.poll(async () => (await audit(page)).active.length, { intervals: [20] }).toBe(0);
});

test('muted or disposed requests are not replayed after pending sound downloads finish', async ({ page }) => {
  await page.route(/\.mp3(?:[?#]|$)/, async route => { await new Promise(resolve => setTimeout(resolve, 350)); await route.continue(); });
  await page.goto('/');
  await page.getByRole('button', { name: '音なし：音をオンにする', exact: true }).click();
  await page.getByRole('button', { name: '音あり：消音する', exact: true }).click();
  await ready(page);
  const loadedMuted = (await audit(page)).started.length;
  await page.waitForTimeout(250);
  expect((await audit(page)).started).toHaveLength(loadedMuted);
  await page.evaluate(async () => {
    const path = '/src/ui/audio.ts';
    const { IncantationAudio } = await import(/* @vite-ignore */ path);
    const probe = new IncantationAudio();
    probe.setEnabled(true);
    probe.unlock();
    probe.cast();
    probe.dispose();
  });
  const disposed = (await audit(page)).started.length;
  await page.waitForTimeout(800);
  expect((await audit(page)).started).toHaveLength(disposed);
  await expect.poll(async () => (await audit(page)).active.length, { intervals: [20] }).toBe(0);
});

test('suspended audio drops cues instead of replaying them after resume', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '音なし：音をオンにする', exact: true }).click();
  await ready(page);
  const decodedBefore = (await audit(page)).decoded.length;
  await page.evaluate(async () => {
    const path = '/src/ui/audio.ts';
    const { IncantationAudio } = await import(/* @vite-ignore */ path);
    const probe = new IncantationAudio();
    probe.unlock();
    Object.assign(window, { audioProbe: probe });
  });
  await expect.poll(async () => (await audit(page)).decoded.length, { intervals: [50] }).toBeGreaterThanOrEqual(decodedBefore + 12);
  await page.evaluate(async () => {
    const state = window as unknown as { audioContexts: Set<AudioContext>; audioProbe: { cast(): void } };
    const context = [...state.audioContexts].at(-1)!;
    await context.suspend();
    state.audioProbe.cast();
  });
  const sleeping = await audit(page);
  await page.evaluate(async () => {
    const state = window as unknown as { audioContexts: Set<AudioContext> };
    await [...state.audioContexts].at(-1)!.resume();
  });
  await page.waitForTimeout(100);
  expect((await audit(page)).started).toHaveLength(sleeping.started.length);
  expect((await audit(page)).tones).toHaveLength(sleeping.tones.length);
  await page.evaluate(() => {
    const probe = (window as unknown as { audioProbe: { cast(): void; dispose(): void } }).audioProbe;
    probe.cast();
    probe.dispose();
  });
  expect((await audit(page)).started.length).toBe(sleeping.started.length + 1);
});
