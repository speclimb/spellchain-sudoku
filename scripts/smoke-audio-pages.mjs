import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(project, 'dist');
const prefix = '/spellchain-sudoku/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
await stat(resolve(dist, 'index.html'));

// An isolated, randomly assigned loopback port leaves the user's preview alone.
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
    const file = resolve(dist, pathname.slice(prefix.length) || 'index.html');
    if (file !== dist && !file.startsWith(dist + sep)) { response.writeHead(400); response.end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], responses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (/\.(?:mp3|js|css)(?:[?#]|$)/.test(response.url())) responses.push({ url: response.url(), status: response.status() });
  });
  await page.addInitScript(() => {
    window.audioPages = { decoded: [], started: [] };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (bytes) {
      return decode.call(this, bytes).then(buffer => {
        const values = buffer.getChannelData(0), stride = Math.max(1, Math.floor(values.length / 10000));
        let peak = 0, squares = 0, count = 0;
        for (let i = 0; i < values.length; i += stride) { peak = Math.max(peak, Math.abs(values[i])); squares += values[i] ** 2; count++; }
        window.audioPages.decoded.push({ duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, peak, rms: Math.sqrt(squares / count) });
        return buffer;
      });
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.audioPages.started.push({ duration: this.buffer?.duration, at: this.context.currentTime });
      return start.apply(this, args);
    };
  });
  const loaded = await page.goto(base);
  assert.equal(loaded.status(), 200);
  assert.equal(responses.filter(item => item.url.endsWith('.mp3')).length, 0, 'Default-muted page must not fetch samples.');
  await page.getByRole('button', { name: '音をオンにする', exact: true }).click();
  await page.waitForFunction(() => window.audioPages.decoded.length === 12, null, { timeout: 10000 });
  await page.getByRole('button', { name: /冒険をはじめる/ }).click();
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.locator('[data-action="cast"]').click();
  // Persistence is asynchronous: wait for the committed core mirror before
  // checking animation completion or reading the saved gameplay action.
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('chain-incantation.save.v1');
    return raw && JSON.parse(raw).run?.stats.moves === 1;
  });
  await page.waitForFunction(() => !document.querySelector('.combat-effects'));
  const evidence = await page.evaluate(() => ({ audio: window.audioPages, saved: JSON.parse(localStorage.getItem('chain-incantation.save.v1')) }));
  const audioResponses = responses.filter(item => item.url.endsWith('.mp3'));
  assert.equal(new Set(audioResponses.map(item => item.url)).size, 12);
  assert(audioResponses.every(item => item.status === 200 && item.url.startsWith(base + 'assets/')), 'Every sound must resolve beneath the repository path.');
  assert(responses.every(item => item.status === 200), 'Built JavaScript, CSS and audio requests must succeed.');
  assert(evidence.audio.decoded.every(item => item.duration > 0 && item.channels > 0 && item.peak > 0 && item.rms > 0));
  assert(evidence.audio.started.length >= 2, 'The real gameplay must start decoded sample sources.');
  assert.equal(evidence.saved.run.stats.moves, 1);
  assert.deepEqual(errors, []);
  await mkdir(resolve(project, '.runtime/screenshots'), { recursive: true });
  await page.screenshot({ path: resolve(project, '.runtime/screenshots/production-audio-pages.png'), fullPage: true });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const creditLink = page.getByRole('link', { name: '出典とライセンス', exact: true });
  const creditsUrl = await creditLink.evaluate(link => link.href);
  assert.equal(creditsUrl, base + 'audio-licenses/CREDITS.txt');
  const licenses = [];
  for (const filename of ['CREDITS.txt', 'Kenney-Interface.txt', 'Kenney-Impact.txt', 'CC0-1.0.txt']) {
    const url = new URL(filename, creditsUrl).href;
    const response = await page.request.get(url);
    const content = await response.text();
    assert.equal(response.status(), 200);
    assert(response.headers()['content-type'].startsWith('text/plain'));
    assert(content.length > 100);
    if (filename === 'CREDITS.txt') for (const author of ['Kenney', 'JaggedStone', 'CC0']) assert(content.includes(author));
    licenses.push({ url, status: response.status(), contentType: response.headers()['content-type'], characters: content.length });
  }
  await page.screenshot({ path: resolve(project, '.runtime/screenshots/desktop-audio-settings.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(project, '.runtime/screenshots/mobile-audio-settings.png'), fullPage: false });
  await writeFile(resolve(project, '.runtime/audio-pages-report.json'), JSON.stringify({ path: prefix, responses, licenses, audio: evidence.audio, moves: evidence.saved.run.stats.moves, errors }, null, 2));
  console.log(`Built repository-path audio: ${audioResponses.length} MP3 responses HTTP 200, twelve non-silent WebAudio decodes, ${evidence.audio.started.length} sample starts, a saved gameplay action and four credit/license responses HTTP 200.`);
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
