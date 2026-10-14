import { expect, test } from '@playwright/test';
const key = 'chain-incantation.save.v1';

for (const width of [1440, 390, 320]) test(`enemy HP commas and standard first-turn guidance at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  const fixture = await page.evaluate(async key => {
    const path = '/src/game/engine.ts', enemies = '/src/game/enemies.ts';
    const { newSave, startRun, longestOrigins } = await import(/* @vite-ignore */ path);
    const { enemyForRun } = await import(/* @vite-ignore */ enemies);
    const save = startRun(newSave(), 'fuse', 51), run = save.run;
    save.meta.tutorialDone = true; save.settings.sound = false;
    run.stage = 99; run.stats.kills = 99; run.enemyHp = enemyForRun(run).hp;
    const maximum = longestOrigins(run);
    localStorage.setItem(key, JSON.stringify(save));
    return { hp: run.enemyHp, maximum };
  }, key);
  await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.enemy-health')).toContainText(`${fixture.hp.toLocaleString('ja-JP')} / ${fixture.hp.toLocaleString('ja-JP')}`);
  await expect(page.locator('[data-longest="true"]')).toHaveCount(fixture.maximum.cells.length);
  await expect(page.locator('.longest-origins')).toContainText('最長の起点');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const health = page.locator('.enemy-health > span'), info = page.locator('.enemy-info');
  const healthBox = await health.boundingBox(), infoBox = await info.boundingBox();
  expect(healthBox!.x + healthBox!.width).toBeLessThanOrEqual(infoBox!.x + infoBox!.width + 1);
  await page.screenshot({ path: `.runtime/screenshots/standard-guidance-${width}.png`, fullPage: true });
});

test('first-turn longest search is cached under mobile-equivalent CPU throttling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const session = await page.context().newCDPSession(page); await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const measurements = await page.evaluate(async () => {
    const path = '/src/game/engine.ts';
    const { newSave, startRun, longestOrigins } = await import(/* @vite-ignore */ path);
    const samples = [];
    for (const skill of [false, true]) {
      const run = startRun(newSave(), 'fuse', skill ? 63 : 62).run; run.mana = 8;
      const before = JSON.stringify(run), start = performance.now();
      const maximum = longestOrigins(run, skill); const coldMs = performance.now() - start;
      const cacheStart = performance.now();
      for (let i = 0; i < 100; i++) longestOrigins(run, skill);
      samples.push({ skill, coldMs, cachedMeanMs: (performance.now() - cacheStart) / 100, count: maximum.cells.length, unchanged: before === JSON.stringify(run) });
    }
    return samples;
  });
  console.log('Longest-origin CPU measurements:', JSON.stringify(measurements));
  await test.info().attach('longest-mobile-cpu.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  for (const sample of measurements) { expect(sample.unchanged).toBe(true); expect(sample.count).toBeGreaterThan(0); expect(sample.cachedMeanMs).toBeLessThan(sample.coldMs); }
  await session.detach();
});
