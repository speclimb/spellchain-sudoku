import { savedText, resetHistoryDatabase } from './save-helpers';
import { expect, test, type Page } from '@playwright/test';
import type { Report, Run } from '../../src/game/types';

const key = 'chain-incantation.save.v1';
type Completion = 'row' | 'column' | 'box' | 'cross';

/** Complete selected units in a real generated puzzle while keeping its givens. */
async function prepareCompletion(page: Page, completion: Completion, settings: { fast?: boolean; reducedMotion?: boolean } = {}): Promise<{ cell: number; report: Report }> {
  await page.goto('/');
  await resetHistoryDatabase(page);
  const fixture = await page.evaluate(async ({ key, completion, settings }) => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, previewAction } = await import(/* @vite-ignore */ enginePath);
    const { UNITS } = await import(/* @vite-ignore */ sudokuPath);
    for (let seed = 21; seed < 100; seed++) {
      const base = startRun(newSave(), 'fuse', seed);
      base.meta.tutorialDone = true;
      Object.assign(base.settings, settings);
      for (let cell = 0; cell < 81; cell++) {
        if (base.run.cells[cell]) continue;
        const save = structuredClone(base);
        const run = save.run;
        const row = Math.floor(cell / 9), column = 9 + cell % 9;
        const box = 18 + Math.floor(cell / 27) * 3 + Math.floor(cell % 9 / 3);
        const chosen = completion === 'row' ? [row] : completion === 'column' ? [column] : completion === 'box' ? [box] : [row, box];
        for (const unit of chosen) for (const i of UNITS[unit]) if (i !== cell) run.cells[i] = run.solution[i];
        const report = previewAction(run, cell);
        const first = report.path[0].units;
        const all = report.path.flatMap((event: { units: number[] }) => event.units);
        const matching = completion === 'row' ? first.length && all.every((unit: number) => unit < 9)
          : completion === 'column' ? first.length && all.every((unit: number) => unit >= 9 && unit < 18)
          : completion === 'box' ? first.length && all.every((unit: number) => unit >= 18)
          : first.some((unit: number) => unit < 18) && first.some((unit: number) => unit >= 18);
        if (!matching || report.defeated || report.fullClear) continue;
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report };
      }
    }
    throw new Error(`No stable ${completion} completion fixture found`);
  }, { key, completion, settings });
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  return fixture;
}

async function finished(page: Page): Promise<void> {
  await expect(page.locator('[data-action="cast"]')).not.toHaveText('詠唱中…');
  await expect(page.locator('.completion-cutin, .combat-effects')).toHaveCount(0);
}

for (const scenario of [
  { completion: 'row' as const, viewport: { width: 1440, height: 900 }, screenshot: 'desktop-row-magic.png' },
  { completion: 'column' as const, viewport: { width: 390, height: 844 }, screenshot: 'mobile-column-magic.png' },
  { completion: 'box' as const, viewport: { width: 390, height: 844 }, screenshot: 'mobile-box-magic.png' },
  { completion: 'cross' as const, viewport: { width: 1440, height: 900 }, screenshot: 'desktop-cross-magic.png' },
]) {
  test(`${scenario.completion} completion briefly casts a full-screen spell and returns to the same committed action`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(scenario.viewport);
    const { report } = await prepareCompletion(page, scenario.completion);
    await page.locator('[data-action="cast"]').click();
    const cutin = page.locator('.completion-cutin');
    await expect(cutin).toHaveAttribute('data-completion', scenario.completion === 'row' || scenario.completion === 'column' ? 'line' : scenario.completion);
    await expect(cutin.locator('.completion-title')).toContainText(scenario.completion === 'cross' ? '複合詠唱' : scenario.completion === 'box' ? '3×3区画' : 'ライン');
    await expect(cutin.locator('.completion-count')).toContainText('単位完成');
    if (scenario.completion === 'row' || scenario.completion === 'column') await expect(cutin).toHaveAttribute('data-direction', scenario.completion);
    const bounds = await cutin.boundingBox();
    expect(bounds!.x).toBeCloseTo(0, 0);
    expect(bounds!.y).toBeCloseTo(0, 0);
    expect(bounds!.width).toBeCloseTo(scenario.viewport.width, 0);
    expect(bounds!.height).toBeCloseTo(scenario.viewport.height, 0);
    await expect(page.locator('[data-action="cast"]')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // The beams and seal reach their readable peak after the entrance accent.
    await page.waitForTimeout(60);
    await page.screenshot({ path: `.runtime/screenshots/${scenario.screenshot}`, fullPage: false });
    await finished(page);
    const run: Run = await savedText(page, key).then(raw => JSON.parse(raw!).run);
    expect(run.lastReport).toEqual(report);
    expect(run.stats.moves).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('completion cut-ins clean up in fast and reduced-motion modes without changing the cast result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const settings of [{ fast: true }, { reducedMotion: true }]) {
    const { report } = await prepareCompletion(page, 'cross', settings);
    const started = Date.now();
    await page.locator('[data-action="cast"]').click();
    if (settings.reducedMotion) {
      await expect(page.locator('html')).toHaveClass(/reduced-motion/);
      expect(await page.evaluate(() => [...document.querySelectorAll('.completion-cutin, .combat-effects')].flatMap(node => node.getAnimations({ subtree: true })).length)).toBe(0);
    }
    await finished(page);
    expect(Date.now() - started).toBeLessThan(1800);
    const after = await savedText(page, key).then(raw => JSON.parse(raw!).run);
    expect(after.lastReport).toEqual(report);
    expect(after.stats.moves).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('level growth adds eight automatic fills and a real thirteen-link cast stays within a short animation budget', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const fixture = await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, previewAction, chainCapacity } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    for (let seed = 21; seed < 150; seed++) {
      const save = startRun(newSave(), 'fuse', seed);
      save.meta.tutorialDone = true;
      save.run.spellLevel = 9;
      save.run.maxHp = 72;
      save.run.hp = 72;
      for (const cell of singles(save.run.cells)) {
        const report = previewAction(save.run, cell);
        if (report.path.length !== 13 || report.chain.stopReason !== 'limit' || report.defeated || report.fullClear) continue;
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report, capacity: chainCapacity(save.run) };
      }
    }
    throw new Error('No thirteen-link level-growth fixture found');
  }, key);
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  expect(fixture.capacity).toBe(12);
  expect(fixture.report.chain!.bonuses).toContainEqual({ label: '術式成長', amount: 8 });
  await expect(page.locator('.spell-growth')).toContainText('術式 Lv.9');
  await expect(page.locator('.spell-growth')).toContainText(/自動\s*[＋+]\s*8/);
  await expect(page.locator('.skill-description')).toContainText('自動12回');
  await expect(page.locator('#prediction-chain')).toHaveText('13');
  await page.screenshot({ path: '.runtime/screenshots/desktop-high-level.png', fullPage: false });
  await page.evaluate(() => {
    const audit = { activations: 0, intervals: [] as number[], opened: new Map<Node, number>() };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof HTMLElement && node.classList.contains('completion-cutin')) { audit.activations++; audit.opened.set(node, performance.now()); }
        for (const node of record.removedNodes) if (audit.opened.has(node)) { audit.intervals.push(performance.now() - audit.opened.get(node)!); audit.opened.delete(node); }
      }
    });
    observer.observe(document.body, { childList: true });
    Object.assign(window, { completionAudit: audit, completionObserver: observer });
  });
  const started = Date.now();
  await page.locator('[data-action="cast"]').click();
  await expect.poll(() => page.locator('.combat-chain strong').textContent(), { intervals: [25], timeout: 2500 }).toBe('13');
  await expect(page.locator('.combat-effects')).toHaveAttribute('data-phase', 'chain');
  await page.screenshot({ path: '.runtime/screenshots/desktop-thirteen-chain.png', fullPage: false });
  await finished(page);
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(4500);
  const audit = await page.evaluate(() => {
    const state = window as unknown as { completionAudit: { activations: number; intervals: number[] }; completionObserver: MutationObserver };
    state.completionObserver.disconnect();
    return state.completionAudit;
  });
  expect(audit.activations).toBeLessThanOrEqual(3);
  expect(audit.intervals.every(duration => duration < 450)).toBe(true);
  expect(audit.intervals.reduce((sum, duration) => sum + duration, 0)).toBeLessThan(1300);
  const after = await savedText(page, key).then(raw => JSON.parse(raw!).run);
  expect(after.lastReport).toEqual(fixture.report);
  expect(after.stats.bestChain).toBe(13);
  console.info(`Thirteen-link cast: ${elapsed} ms; completion cut-ins: ${audit.activations}; visible intervals: ${audit.intervals.map(n => Math.round(n)).join(', ')} ms`);
  expect(errors).toEqual([]);
});

test('exhausted relic pool offers repeatable growth and advances to another playable enemy after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const original = await page.evaluate(async key => {
    const path = '/src/game/engine.ts';
    const { newSave, startRun } = await import(/* @vite-ignore */ path);
    const save = startRun(newSave(), 'fuse', 21);
    save.meta.tutorialDone = true;
    save.settings.reducedMotion = true;
    save.run.inventory = [...save.run.pool];
    save.run.relicLevels = Object.fromEntries(save.run.inventory.map((id: string) => [id,10]));
    for (const id of ['duality', 'trinity', 'quint', 'sept']) save.run.acquisitionRank[id] = 3;
    save.run.maxHp -= 8;
    save.run.hp = save.run.maxHp;
    save.run.enemyHp = 1;
    localStorage.setItem(key, JSON.stringify(save));
    return save.run.inventory;
  }, key);
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.locator('[data-action="cast"]').click();
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toBeVisible();
  const rewardRun = await savedText(page, key).then(raw => JSON.parse(raw!).run);
  expect([...rewardRun.rewards].sort()).toEqual(['recovery', 'training', 'vitality']);
  await expect(page.locator('[data-reward]')).toHaveCount(3);
  await page.screenshot({ path: '.runtime/screenshots/mobile-repeatable-rewards.png', fullPage: true });
  await page.locator('[data-reward="training"]').click();
  const next = await savedText(page, key).then(raw => JSON.parse(raw!));
  expect(next.run.stage).toBe(1);
  expect(next.run.phase).toBe('battle');
  expect(next.run.spellLevel).toBe(rewardRun.spellLevel + 1);
  expect(next.run.inventory).toEqual(original);
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  expect(await savedText(page, key).then(raw => JSON.parse(raw!))).toEqual(next);
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.locator('[data-action="cast"]').click();
  await finished(page);
  const played = await savedText(page, key).then(raw => JSON.parse(raw!).run);
  expect(played.revision).toBe(next.run.revision + 1);
  expect(played.stats.moves).toBe(next.run.stats.moves + 1);
  expect(played.inventory).toEqual(original);
});
