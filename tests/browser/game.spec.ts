import { expect, test } from '@playwright/test';
import type { Run } from '../../src/game/types';
const key = 'chain-incantation.save.v1';
test('desktop: title, prediction, animation commit, restoration, all six encounters and result', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '一手が、 魔法になる。' })).toBeVisible();
  await page.screenshot({ path: '.runtime/screenshots/desktop-title.png', fullPage: true });
  await page.getByRole('button', { name: /冒険をはじめる/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('動きを抑える').check();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const playable = page.locator('[data-cell][aria-disabled="false"]');
  await playable.first().click();
  await expect(page.locator('#prediction-chain')).not.toHaveText('—');
  await page.screenshot({ path: '.runtime/screenshots/desktop-battle.png', fullPage: true });
  await page.locator('[data-action="cast"]').click();
  await expect(page.locator('[data-action="cast"]')).not.toHaveText('詠唱中…');
  const before = await page.evaluate(key => localStorage.getItem(key), key);
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(before);
  let firstReward = true;
  for (let step = 0; step < 90; step++) {
    const run: Run = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run, key);
    if (run.phase === 'won' || run.phase === 'lost') break;
    if (run.phase === 'reward') {
      if (firstReward) { await page.screenshot({ path: '.runtime/screenshots/desktop-reward.png', fullPage: true }); firstReward = false; }
      const order = ['wick', 'pen', 'lens', 'glass', 'ward', 'battery', 'afterglow', 'stroke', 'gold'];
      const id = [...run.rewards].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
      await page.locator(`[data-reward="${id}"]`).click();
      continue;
    }
    const choice = await page.evaluate(async key => {
      const enginePath = '/src/game/engine.ts';
      const sudokuPath = '/src/game/sudoku.ts';
      const { previewAction } = await import(/* @vite-ignore */ enginePath);
      const { singles } = await import(/* @vite-ignore */ sudokuPath);
      const run = JSON.parse(localStorage.getItem(key)!).run;
      const choices = singles(run.cells).map((cell: number) => ({ cell, skill: false, report: previewAction(run, cell) }));
      if (run.mana === 8) run.cells.forEach((value: number, cell: number) => { if (!value) choices.push({ cell, skill: true, report: previewAction(run, cell, true) }); });
      const value = (c: any) => (c.report.defeated ? 10000 : 0) + Math.min(run.enemyHp, c.report.damage) - c.report.received * 15;
      choices.sort((a: any, b: any) => value(b) - value(a));
      return { cell: choices[0].cell, skill: choices[0].skill, damage: choices[0].report.damage };
    }, key);
    if (choice.skill) await page.locator('[data-action="skill"]').click();
    await page.locator(`[data-cell="${choice.cell}"]`).click();
    await expect(page.locator('#prediction-damage')).toHaveText(choice.damage.toLocaleString('ja-JP'));
    await page.locator('[data-action="cast"]').click();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run.revision, key)).toBeGreaterThan(run.revision);
    await expect(page.locator('[data-action="cast"]')).not.toHaveText('詠唱中…');
  }
  await expect(page.getByRole('dialog', { name: '冒険の結果' })).toBeVisible();
  const final: Run = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run, key);
  expect(final.phase).toBe('won');
  expect(final.stats.kills).toBe(6);
  expect(final.inventory).toHaveLength(5);
  await page.screenshot({ path: '.runtime/screenshots/desktop-result.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile: readable board, touch targets, settings, codex and persistent selection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.screenshot({ path: '.runtime/screenshots/mobile-title.png', fullPage: true });
  await page.getByRole('button', { name: /冒険をはじめる/ }).click();
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.screenshot({ path: '.runtime/screenshots/mobile-battle.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const board = await page.locator('.board-surface').boundingBox();
  expect(board!.width).toBeGreaterThan(340);
  const cell = await page.locator('[data-cell="0"]').boundingBox();
  expect(cell!.width).toBeGreaterThan(35);
  const cast = await page.locator('[data-action="cast"]').boundingBox();
  expect(cast!.y + cast!.height).toBeLessThanOrEqual(844);
  await page.getByRole('button', { name: '遺物図鑑' }).click();
  await expect(page.locator('.codex-item')).toHaveCount(12);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('演出を短く').check();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.locator('[data-action="cast"]').click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run.stats.moves, key)).toBe(1);
  await page.reload();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).settings.fast, key)).toBe(true);
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reload during the victory animation preserves a single clear and the exact reward offer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async key => {
    const path = '/src/game/engine.ts';
    const { newSave, startRun } = await import(/* @vite-ignore */ path);
    const save = startRun(newSave(), 'fuse', 45);
    save.meta.tutorialDone = true;
    save.run.enemyHp = 1;
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.locator('[data-action="cast"]').click();
  const committed = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
  expect(committed.meta.clears).toBe(1);
  expect(committed.run.phase).toBe('reward');
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.getByRole('dialog', { name: '遺物の選択' })).toBeVisible();
  const restored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
  expect(restored).toEqual(committed);
  await page.screenshot({ path: '.runtime/screenshots/mobile-reward.png', fullPage: true });
  await page.locator(`[data-reward="${restored.run.rewards[0]}"]`).click();
  await page.reload();
  const advanced = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
  expect(advanced.meta.clears).toBe(1);
  expect(advanced.run.stage).toBe(1);
  expect(advanced.run.inventory).toHaveLength(1);
});
