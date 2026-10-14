import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const scenario of [{ casts: 100, rich: false }, { casts: 20, rich: true }]) {
test(`1000 battles / ${1000 * scenario.casts} ${scenario.rich ? 'rich' : 'light'} casts persist, restore, page, inspect and export on mobile`, async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const metrics = await page.evaluate(async scenario => {
    const enginePath = '/src/game/engine.ts', historyPath = '/src/game/history.ts', storagePath = '/src/game/history-storage.ts', corePath = '/src/game/storage.ts', enemiesPath = '/src/game/enemies.ts';
    const { newSave, startRun, dispatch, legalOrigins } = await import(/* @vite-ignore */ enginePath);
    const { historyCounts, historyBytes } = await import(/* @vite-ignore */ historyPath);
    const { HistoryStorage } = await import(/* @vite-ignore */ storagePath);
    const { parseSaveData } = await import(/* @vite-ignore */ corePath);
    const { enemyForRun } = await import(/* @vite-ignore */ enemiesPath);
    const original = startRun(newSave(), 'fuse', 31);
    const played = dispatch(original, { type: 'play', cell: legalOrigins(original.run)[0], skill: false, revision: 0 });
    const template = played.history.runs[0].battles[0], cast = template.casts[0];
    if (scenario.rich) for (const id of ['wick','echo','rekindle','pen','ward','stroke','battery','amplifier','afterglow','lens','glass','gold','trinity','duality','quint','sept']) cast.relics[id] = { level: 10, tier: 3, metric: { heldCasts: 1, opportunities: 1, triggers: 1, damage: 999999, addedInputs: 3, fuelGranted: 10, fuelUsed: 10, mana: 4, prevented: 5, tokensGranted: 3, tokensUsed: 1, score: 50 } };
    const save = startRun(newSave(), 'fuse', 31); save.meta.runs = 10; save.meta.tutorialDone = true;
    save.run.stage = 99; save.run.stats.kills = 99; save.run.stats.moves = 100 * scenario.casts; save.run.castCounter = 100 * scenario.casts; save.run.turn = scenario.casts; save.run.enemyHp = enemyForRun(save.run).hp;
    save.history.runs = Array.from({ length: 10 }, (_, n) => ({ ...played.history.runs[0], key: `run-31/${n + 1}`, number: n + 1, status: n === 9 ? 'battle' : 'retired', battles: Array.from({ length: 100 }, (_, stage) => {
      const battle = structuredClone(template); battle.stage = stage; battle.ledger.stage = stage; battle.status = stage === 99 && n === 9 ? 'battle' : 'victory';
      battle.casts = Array.from({ length: scenario.casts }, (_, c) => ({ ...structuredClone(cast), id: stage * scenario.casts + c + 1, turn: c + 1 }));
      battle.ledger.casts = scenario.casts;
      for (const key of ['damage', 'hpDamage', 'overkill', 'score']) battle.ledger[key] = cast[key] * scenario.casts;
      for (const key of ['received', 'hpLost', 'sheetsCompleted']) battle[key] = cast[key] * scenario.casts;
      return battle;
    }) }));
    if (!parseSaveData(save).history) throw new Error('Invalid maximum fixture');
    const store = new HistoryStorage(); await store.load();
    const start = performance.now(); const result = await store.persist(save); const saveMs = performance.now() - start; store.close();
    if (!result.saved || result.warning) throw new Error(result.warning);
    const restoreStart = performance.now(); const restored = new HistoryStorage(); const data = await restored.load(); const loadMs = performance.now() - restoreStart;
    const counts = historyCounts(data.save.history), bytes = historyBytes(data.save.history);
    const writeStart = performance.now(); await restored.persist(data.save); const unchangedSaveMs = performance.now() - writeStart; restored.close();
    return { ...counts, runs: data.save.history.runs.length, bytes, saveMs, loadMs, unchangedSaveMs, mirrorBytes: localStorage.getItem('chain-incantation.save.v1')!.length * 2 };
  }, scenario);
  console.log('CAPACITY_METRICS', JSON.stringify(metrics));
  expect(metrics).toMatchObject({ battles: 1000, casts: 1000 * scenario.casts, runs: 10 });
  expect(metrics.mirrorBytes).toBeLessThan(100000);
  await page.reload();
  const begin = Date.now();
  await page.locator('[data-action="history"]').click();
  await expect(page.locator('.history-battle')).toHaveCount(10);
  console.log('CAPACITY_HISTORY_OPEN_MS', Date.now() - begin);
  await expect(page.locator('.history-retention')).toContainText('1,000戦');
  await page.locator('[data-history-run]').selectOption('run-31/1');
  await page.locator('[data-history-battle]').first().locator('summary').click();
  await expect(page.locator('.history-cast')).toHaveCount(Math.min(30, scenario.casts));
  await page.locator('[data-history-cast]').first().locator('summary').click();
  await expect(page.locator('.history-cast-content').first()).toContainText('通算');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('[data-history-page="1"]').click();
  await expect(page.locator('.history-battle')).toHaveCount(10);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-action="history-export"]').click();
  const download = await downloadEvent, path = await download.path();
  const exported = JSON.parse(await readFile(path!, 'utf8'));
  expect(exported.history.runs).toHaveLength(10);
  expect(exported.history.runs.reduce((n: number, run: any) => n + run.battles.length, 0)).toBe(1000);
  expect(exported.history.runs.flatMap((run: any) => run.battles).reduce((n: number, battle: any) => n + battle.casts.length, 0)).toBe(1000 * scenario.casts);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const update = await page.evaluate(async () => {
    const path = '/src/game/history-storage.ts', enginePath = '/src/game/engine.ts';
    const { HistoryStorage } = await import(/* @vite-ignore */ path);
    const { dispatch, legalOrigins } = await import(/* @vite-ignore */ enginePath);
    const store = new HistoryStorage(), { save } = await store.load();
    await store.persist(save); // Warm one-time size cache after restore.
    const started = performance.now();
    const next = dispatch(save, { type: 'play', cell: legalOrigins(save.run)[0], skill: false, revision: save.run.revision });
    const computeMs = performance.now() - started, writing = performance.now();
    const result = await store.persist(next), saveMs = performance.now() - writing;
    store.close(); if (!result.saved) throw new Error(result.warning);
    return { computeMs, saveMs, castCounter: next.run.castCounter };
  });
  console.log('CAPACITY_UPDATE_4X_CPU', JSON.stringify(update));
  expect(update.castCounter).toBe(100 * scenario.casts + 1);
  expect(update.saveMs).toBeLessThan(1000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.screenshot({ path: `.runtime/history-capacity-${scenario.rich ? 'rich' : 'light'}-mobile.png`, fullPage: true });
});

}
