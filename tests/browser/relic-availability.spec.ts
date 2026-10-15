import { expect, test } from '@playwright/test';
import { savedGame, savedText } from './save-helpers';
import type { Save } from '../../src/game/types';

const key = 'chain-incantation.save.v1';
test.use({ actionTimeout: 10000 });

for (const viewport of [{ name: 'desktop', width: 1440, height: 1080 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`${viewport.name}: all relics are candidates at zero clears while character progression stays locked`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('[data-character="scribe"]')).toBeDisabled();
    await expect(page.locator('[data-character="lumen"]')).toBeDisabled();
    const before = await savedText(page);
    await page.getByRole('button', { name: '遺物図鑑', exact: true }).click();
    const codex = page.getByRole('dialog', { name: '遺物図鑑' });
    await expect(codex.locator('.codex-item')).toHaveCount(16);
    await expect(codex.locator('.codex-item.locked')).toHaveCount(0);
    await expect(codex.locator('.codex-item .unlocked')).toHaveCount(16);
    await expect(codex).not.toContainText('戦クリアで解放');
    await expect(codex).toContainText('全16種が最初の冒険から報酬候補');
    await expect(codex).toContainText('同時に使えるのは8枠');
    await expect(codex).toContainText('Lv.10');
    expect(await codex.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await savedText(page)).toBe(before);
    await page.screenshot({ path: `.runtime/screenshots/${viewport.name}-all-relics-codex.png`, fullPage: true });
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(page.locator('[data-character="scribe"]')).toBeDisabled();
    await expect(page.locator('[data-character="lumen"]')).toBeDisabled();
    await page.locator('[data-action="new"]').click();
    await expect(page.locator('canvas')).toBeVisible();
    const started = await savedGame(page);
    expect(started.meta.clears).toBe(0); expect(started.run!.pool).toHaveLength(16);
    expect(started.run!.inventory).toEqual([]);
    expect(started.run!.pool).toEqual(expect.arrayContaining(['gold', 'trinity', 'lens']));
  });
}

test('reloading an older low-clear boss save expands the pool without rerolling either reward step', async ({ page }) => {
  await page.goto('/');
  const original: Save = await page.evaluate(async key => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ engine);
    const { singles } = await import(/* @vite-ignore */ sudoku);
    const initial = newSave(); initial.meta.clears = 4; initial.meta.tutorialDone = true; initial.settings.reducedMotion = true;
    let save = startRun(initial, 'fuse', 73);
    // Before relic thresholds were removed, these two still needed more than four clears.
    save.run.pool = save.run.pool.filter((id: string) => !['rekindle', 'amplifier'].includes(id));
    save.run.stage = 4; save.run.stats.kills = 4; save.run.enemyHp = 1;
    save.history.runs[0].battles = [];
    save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
    localStorage.setItem(key, JSON.stringify(save));
    return save;
  }, key);
  expect(original.meta.clears).toBe(5); expect(original.run!.pool).toHaveLength(14);
  expect(original.run!.pendingRelicRewards).toHaveLength(3);
  await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  const dialog = page.getByRole('dialog', { name: '成長の選択' });
  await expect(dialog.locator('.reward-progress')).toContainText('1/2');
  const loaded = await savedGame(page);
  expect(loaded.run!.pool).toHaveLength(16);
  expect(loaded.run!.pool.slice(0, original.run!.pool.length)).toEqual(original.run!.pool);
  expect({ ...loaded.run!, pool: original.run!.pool }).toEqual(original.run);
  expect(loaded.meta).toEqual(original.meta); expect(loaded.history).toEqual(original.history);
  expect(await dialog.locator('[data-reward]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.reward))).toEqual(original.run!.rewards);
  await dialog.locator('[data-reward]').first().click();
  await expect(dialog.locator('.reward-progress')).toContainText('2/2');
  const second = await savedGame(page);
  expect(second.run!.rewards).toEqual(original.run!.pendingRelicRewards);
  expect(second.run!.randomState).toBe(original.run!.randomState);
  await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  expect(await savedGame(page)).toEqual(second);
  expect(await dialog.locator('[data-reward]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.reward))).toEqual(original.run!.pendingRelicRewards);
});
