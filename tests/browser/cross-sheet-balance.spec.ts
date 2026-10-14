import { expect, test, type Page } from '@playwright/test';
import type { Run } from '../../src/game/types';

const key = 'chain-incantation.save.v1';
const readRun = (page: Page): Promise<Run> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run, key);
async function resume(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
}

test('early wick offer remains a free choice and boss carry offer survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async key => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts';
    const { startRun, newSave, dispatch } = await import(/* @vite-ignore */ engine);
    const { singles } = await import(/* @vite-ignore */ sudoku);
    let save = startRun(newSave(), 'fuse', 103);
    save.meta.tutorialDone = true; save.settings.reducedMotion = true;
    save.run.stage = 2; save.run.stats.kills = 2; save.run.enemyHp = 1;
    save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
  await expect(page.locator('[data-reward="wick"]')).toBeVisible();
  await expect(page.locator('.reward-card')).toHaveCount(3);
  expect((await readRun(page)).inventory).not.toContain('wick');
  await page.locator('[data-reward="wick"]').click();
  const owned = await readRun(page);
  expect(owned.inventory).toContain('wick'); expect(owned.tier.wick ?? 1).toBe(1);
  await page.evaluate(async key => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts';
    const { dispatch } = await import(/* @vite-ignore */ engine);
    const { singles } = await import(/* @vite-ignore */ sudoku);
    let save = JSON.parse(localStorage.getItem(key)!);
    save.run.stage = 4; save.run.stats.kills = 4; save.run.enemyHp = 1;
    save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
  const first = await readRun(page);
  expect(first.pendingRelicRewards).toContain('greater:wick');
  await page.locator(`[data-reward="${first.rewards[0]}"]`).click();
  await expect(page.locator('[data-reward="greater:wick"]')).toBeVisible();
  const second = await readRun(page);
  await resume(page); expect(await readRun(page)).toEqual(second);
  await page.screenshot({ path: '.runtime/screenshots/cross-sheet-guaranteed-offer-mobile.png', fullPage: true });
  const alternative = second.rewards.find(id => id !== 'greater:wick')!;
  await page.locator(`[data-reward="${alternative}"]`).click();
  expect((await readRun(page)).tier.wick ?? 1).toBe(1);
  expect((await readRun(page)).stage).toBe(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('old boss HP and already sampled choices stay intact until the final reward', async ({ page }) => {
  await page.goto('/');
  const hp = await page.evaluate(async key => {
    const engine = '/src/game/engine.ts', content = '/src/game/content.ts';
    const { startRun, newSave } = await import(/* @vite-ignore */ engine);
    const { enemyOf } = await import(/* @vite-ignore */ content);
    const save = startRun(newSave(), 'fuse', 103);
    save.meta.tutorialDone = true; save.settings.reducedMotion = true;
    save.run.stage = 19; save.run.stats.kills = 19; save.run.enemyHp = 1;
    delete save.run.enemyHealthVersion;
    localStorage.setItem(key, JSON.stringify(save));
    return enemyOf(19).hp;
  }, key);
  await resume(page);
  await expect(page.locator('.enemy-health')).toContainText(`1 / ${hp}`);
  // Reading/resuming does not rewrite a save; absent remains legacy until action.
  expect((await readRun(page)).enemyHealthVersion).toBeUndefined();
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.locator('[data-action="cast"]').click();
  await expect(page.locator('.reward-progress')).toHaveAttribute('aria-label', 'ボス報酬 1/2 スキル');
  const first = await readRun(page), pending = first.pendingRelicRewards;
  await resume(page);
  expect((await readRun(page)).rewards).toEqual(first.rewards);
  expect((await readRun(page)).pendingRelicRewards).toEqual(pending);
  await page.locator(`[data-reward="${first.rewards[0]}"]`).click();
  expect((await readRun(page)).enemyHealthVersion).toBe(0);
  await page.locator(`[data-reward="${pending![0]}"]`).click();
  const next = await readRun(page);
  const expected = await page.evaluate(async () => {
    const path = '/src/game/enemies.ts';
    const { enemyHealthAt } = await import(/* @vite-ignore */ path);
    return enemyHealthAt(20);
  });
  expect(next.enemyHealthVersion).toBe(1); expect(next.stage).toBe(20);
  expect(next.enemyHp).toBe(expected);
  await expect(page.locator('.enemy-health')).toContainText(`${expected} / ${expected}`);
  await resume(page); expect(await readRun(page)).toEqual(next);
});

test('new boss HP display follows fixed wave even with a powerful carry build', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const hp = await page.evaluate(async key => {
    const engine = '/src/game/engine.ts', enemies = '/src/game/enemies.ts';
    const { startRun, newSave } = await import(/* @vite-ignore */ engine);
    const { enemyHealthAt } = await import(/* @vite-ignore */ enemies);
    const save = startRun(newSave(), 'fuse', 103);
    save.meta.tutorialDone = true; save.settings.reducedMotion = true;
    save.run.stage = 44; save.run.stats.kills = 44; save.run.enemyHp = enemyHealthAt(44);
    save.run.inventory = ['wick']; save.run.relicLevels = { wick: 10 }; save.run.tier = { wick: 2 };
    save.run.spellLevel = 100; save.run.hp = save.run.maxHp = 436;
    localStorage.setItem(key, JSON.stringify(save));
    return save.run.enemyHp;
  }, key);
  await resume(page);
  await expect(page.locator('.enemy-health')).toContainText(`${hp} / ${hp}`);
  const before = await readRun(page);
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  expect(await readRun(page)).toEqual(before);
  await page.screenshot({ path: '.runtime/screenshots/cross-sheet-boss-fixed-hp-desktop.png', fullPage: true });
  await resume(page); expect(await readRun(page)).toEqual(before);
});
