import { savedText } from './save-helpers';
import { expect, test } from '@playwright/test';
import type { Run } from '../../src/game/types';
const key = 'chain-incantation.save.v1';
test('desktop: title, prediction, restoration, seventh encounter and a loss result without a six-battle ending', async ({ page }) => {
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
  const before = await savedText(page, key);
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  expect(await savedText(page, key)).toBe(before);
  // Reach the old final opponent with the public reducer, then exercise the
  // sixth/seventh wins, reward choices and actual HP-zero action through the UI.
  await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const { dispatch, newSave, startRun } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    let save = startRun(newSave(), 'fuse', 21);
    save.run.pool = save.run.pool.filter((id: string) => id !== 'trinity');
    save.meta.tutorialDone = true;
    save.settings.reducedMotion = true;
    for (let encounter = 0; encounter < 5; encounter++) {
      save.run.enemyHp = 1;
      save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
      while (save.run.phase === 'reward') save = dispatch(save, { type: 'reward', relic: save.run.rewards[0], revision: save.run.revision });
    }
    save.run.enemyHp = 1;
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  for (let expectedStage = 6; expectedStage <= 7; expectedStage++) {
    await page.locator('[data-cell][aria-disabled="false"]').first().click();
    await page.locator('[data-action="cast"]').click();
    await expect(page.getByRole('dialog', { name: '成長の選択' })).toBeVisible();
    const rewardRun: Run = await savedText(page, key).then(raw => JSON.parse(raw!).run);
    expect(rewardRun.phase).toBe('reward');
    expect(rewardRun.stats.kills).toBe(expectedStage);
    if (expectedStage === 6) await page.screenshot({ path: '.runtime/screenshots/desktop-reward.png', fullPage: true });
    await page.locator(`[data-reward="${rewardRun.rewards[0]}"]`).click();
    const continued: Run = await savedText(page, key).then(raw => JSON.parse(raw!).run);
    expect(continued.phase).toBe('battle');
    expect(continued.stage).toBe(expectedStage);
    await expect(page.locator('.endless-track')).toContainText(`第${expectedStage + 1}戦`);
    await expect(page.getByRole('dialog', { name: '冒険の結果' })).toHaveCount(0);
    if (expectedStage === 6) {
      await page.screenshot({ path: '.runtime/screenshots/desktop-seventh-encounter.png', fullPage: true });
      await page.evaluate(key => {
        const save = JSON.parse(localStorage.getItem(key)!);
        save.run.enemyHp = 1;
        localStorage.setItem(key, JSON.stringify(save));
      }, key);
      await page.reload();
      await page.getByRole('button', { name: /冒険の続きへ/ }).click();
    }
  }
  const fatal = await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const { previewAction } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    const save = JSON.parse(localStorage.getItem(key)!);
    save.run.hp = 1; save.run.turn = 2; save.run.spellLevel = 1;
    // Keep the real encounter-8 attack. Use a short-chain spell and remove Ward
    // so this focused loss fixture does not block every root with accumulated guard.
    save.run.inventory = save.run.inventory.filter((id: string) => id !== 'ward');
    delete save.run.acquisitionRank.ward; delete save.run.tier.ward; delete save.run.relicLevels.ward;
    for (const cell of singles(save.run.cells)) {
      const report = previewAction(save.run, cell);
      if (!report.defeated && !report.fullClear && report.received > 0) {
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report };
      }
    }
    throw new Error('No surviving-enemy fatal counter fixture found');
  }, key);
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await page.locator(`[data-cell="${fatal.cell}"]`).click();
  await expect(page.locator('#prediction-damage')).toHaveText(fatal.report.damage.toLocaleString('ja-JP'));
  await page.locator('[data-action="cast"]').click();
  await expect(page.getByRole('dialog', { name: '冒険の結果' })).toBeVisible();
  const final: Run = await savedText(page, key).then(raw => JSON.parse(raw!).run);
  expect(final.phase).toBe('lost');
  expect(final.hp).toBe(0);
  expect(final.stats.kills).toBe(7);
  expect(final.stage).toBe(7);
  await expect(page.getByRole('dialog', { name: '冒険の結果' })).toContainText('第8戦');
  await page.screenshot({ path: '.runtime/screenshots/desktop-result.png', fullPage: true });
  const ended = await savedText(page, key);
  await page.reload();
  expect(await savedText(page, key)).toBe(ended);
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
  await expect(page.locator('.codex-item')).toHaveCount(16);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('演出を短く').check();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.locator('[data-action="cast"]').click();
  await expect.poll(() => savedText(page, key).then(raw => JSON.parse(raw!).run.stats.moves)).toBe(1);
  await page.reload();
  expect(await savedText(page, key).then(raw => JSON.parse(raw!).settings.fast)).toBe(true);
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
  const committed = await savedText(page, key).then(raw => JSON.parse(raw!));
  expect(committed.meta.clears).toBe(1);
  expect(committed.run.phase).toBe('reward');
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toBeVisible();
  await expect(page.locator('.reward-progress')).toHaveCount(0);
  await expect(page.locator('.modal-intro')).toContainText('敵を撃破しました');
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toBeVisible();
  const restored = await savedText(page, key).then(raw => JSON.parse(raw!));
  expect(restored).toEqual(committed);
  await page.screenshot({ path: '.runtime/screenshots/mobile-reward.png', fullPage: true });
  await page.locator(`[data-reward="${restored.run.rewards[0]}"]`).click();
  await page.reload();
  const advanced = await savedText(page, key).then(raw => JSON.parse(raw!));
  expect(advanced.meta.clears).toBe(1);
  expect(advanced.run.stage).toBe(1);
  expect(advanced.run.inventory).toHaveLength(1);
});
