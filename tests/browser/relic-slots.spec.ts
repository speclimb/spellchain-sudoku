import { expect, test, type Page } from '@playwright/test';
import { savedGame, savedText } from './save-helpers';
import type { Save } from '../../src/game/types';

const key = 'chain-incantation.save.v1';
test.use({ actionTimeout: 10000 });
async function prepare(page: Page, options: { boss?: boolean; legacy?: boolean } = {}): Promise<Save> {
  await page.goto('/');
  await page.evaluate(async ({ key, options }) => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts', enemies = '/src/game/enemies.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ engine);
    const { singles } = await import(/* @vite-ignore */ sudoku);
    const { enemyForRun } = await import(/* @vite-ignore */ enemies);
    const initial = newSave(); initial.meta.clears = 100; initial.meta.tutorialDone = true; initial.settings.reducedMotion = true;
    let save = startRun(initial, 'fuse', 45);
    save.run.inventory = ['glass', 'ward', 'pen', 'battery', 'afterglow', 'trinity', 'quint', 'sept'];
    if (options.legacy) { save.run.inventory.push('echo', 'wick'); delete save.run.relicBalanceVersion; }
    save.run.relicLevels = Object.fromEntries(save.run.inventory.map((id: string) => [id, id === 'glass' ? 5 : 1]));
    save.run.tier.glass = 2; save.run.maxHp = 32; save.run.hp = 15;
    save.run.stowedRelics = { lens: { level: 5, rank: 1, tier: 2 } };
    if (options.boss) {
      save.run.stage = 4; save.run.stats.kills = 4;
      save.run.enemyHp = enemyForRun(save.run).hp;
      save.run.skillLevels = { fuse: 1, bridge: 2, pierce: 1 }; save.run.equippedSkills = ['bridge'];
      save.history.runs[0].battles = [];
    }
    save.run.enemyHp = 1;
    save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
    if (options.boss) {
      save.run.rewards = ['skill:fuse', 'skill:bridge', 'skill:pierce'];
      save.run.pendingRelicRewards = ['lens', 'pen', 'training'];
    } else save.run.rewards = ['lens', 'pen', 'training'];
    localStorage.setItem(key, JSON.stringify(save));
  }, { key, options });
  await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toBeVisible();
  return savedGame(page);
}
const rewardDialog = (page: Page) => page.getByRole('dialog', { name: '成長の選択' });
async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dialog = rewardDialog(page);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

for (const viewport of [{ name: 'desktop', width: 1440, height: 1080 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`${viewport.name}: eight slots preserve pending choice, restore growth and record exchange once`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    const before = await prepare(page), dialog = rewardDialog(page);
    await expect(dialog.locator('.reward-slots')).toContainText('8 / 8');
    await expect(dialog).not.toContainText('おすすめ');
    // Keep the pointer where resume left it: a translating hover card used to oscillate here.
    await dialog.locator('[data-reward="lens"]').click();
    await expect(dialog.getByRole('heading', { name: '入れ替える遺物を選ぶ' })).toBeVisible();
    await expect(dialog.locator('[data-replace]')).toHaveCount(8);
    await expect(dialog.locator('.replacement-incoming')).toContainText('Lv.5');
    expect(await savedGame(page)).toEqual(before);
    await noOverflow(page);
    await page.screenshot({ path: `.runtime/screenshots/${viewport.name}-eight-relics.png`, fullPage: true });

    await dialog.locator('[data-action="reward-back"]').click();
    await expect(dialog.locator('[data-reward="lens"]')).toBeFocused();
    expect(await savedGame(page)).toEqual(before);
    await dialog.locator('[data-reward="lens"]').click(); await page.keyboard.press('Escape');
    await expect(dialog.locator('[data-reward]')).toHaveCount(3);
    await dialog.locator('[data-reward="lens"]').click();
    await dialog.locator('[data-action="history-reward"]').click();
    await expect(page.getByRole('dialog', { name: 'プレイ履歴', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.locator('[data-replace]')).toHaveCount(8);
    expect(await savedGame(page)).toEqual(before);

    await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
    await expect(dialog.locator('[data-reward]')).toHaveCount(3);
    expect(await savedGame(page)).toEqual(before);
    await dialog.locator('[data-reward="lens"]').click();
    await dialog.locator('[data-replace="glass"]').click(); await savedText(page);
    await expect(dialog).toHaveCount(0);
    const after = await savedGame(page);
    expect(after.run!.inventory).toHaveLength(8);
    expect(after.run!.inventory).toContain('lens'); expect(after.run!.inventory).not.toContain('glass');
    expect(after.run!.relicLevels!.lens).toBe(5); expect(after.run!.tier.lens).toBe(2);
    expect(after.run!.stowedRelics!.glass).toEqual({ level: 5, rank: 1, tier: 2 });
    expect(after.run!.maxHp).toBe(before.run!.maxHp + 8); expect(after.run!.hp).toBe(before.run!.hp);
    expect(after.run!.revision).toBe(before.run!.revision + 1);
    await expect(page.locator('.weak-text')).toContainText('起点ならさらに＋14');
    const rewards = after.history!.runs.at(-1)!.battles[0].rewards;
    expect(rewards).toHaveLength(1); expect(rewards[0].description).toContain('硝子の杖（Lv.5・上位）と交換');
    await page.locator('.inventory>summary').click(); await expect(page.locator('.stowed-inventory')).toContainText('硝子の杖');
    await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
    expect(await savedGame(page)).toEqual(after);
    expect(errors).toEqual([]);
  });
}

test('old ten-relic inventory stays intact and owned upgrades use no exchange', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await prepare(page, { legacy: true }), dialog = rewardDialog(page);
  await expect(dialog.locator('.reward-slots')).toContainText('10 / 10');
  await expect(dialog.locator('.reward-balance-note')).toContainText('次の戦闘から新しい遺物バランス');
  await dialog.locator('[data-reward="lens"]').click(); await expect(dialog.locator('[data-replace]')).toHaveCount(10);
  await dialog.locator('[data-action="reward-back"]').click();
  await dialog.locator('[data-reward="pen"]').click(); await savedText(page);
  await expect(dialog).toHaveCount(0);
  const after = await savedGame(page);
  expect(after.run!.inventory).toEqual(before.run!.inventory);
  expect(after.run!.relicLevels!.pen).toBe(before.run!.relicLevels!.pen! + 1);
  expect(after.run!.relicBalanceVersion).toBe(1);
});

test('boss skill step, equipment and saved relic step survive exchange cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await prepare(page, { boss: true }), dialog = rewardDialog(page);
  await expect(dialog.locator('.reward-progress')).toContainText('1/2');
  await dialog.locator('[data-reward="skill:fuse"]').click(); await savedText(page);
  await expect(dialog.locator('.reward-progress')).toContainText('2/2');
  const skillTaken = await savedGame(page);
  expect(skillTaken.run!.stage).toBe(before.run!.stage); expect(skillTaken.run!.skillLevels!.fuse).toBe(2);
  await dialog.locator('.equipment-editor>summary').click();
  await dialog.locator('[data-equip-skill="pierce"]').click(); await savedText(page);
  const equipped = await savedGame(page); expect(equipped.run!.equippedSkills).toEqual(['bridge', 'pierce']);
  await dialog.locator('[data-reward="lens"]').click();
  await expect(dialog.locator('.replacement-stage')).toContainText('スキル選択は保存済み');
  await page.keyboard.press('Escape');
  expect(await savedGame(page)).toEqual(equipped);
  await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(dialog.locator('.reward-progress')).toContainText('2/2');
  await dialog.locator('[data-reward="lens"]').click(); await dialog.locator('[data-replace="afterglow"]').click(); await savedText(page);
  const after = await savedGame(page);
  expect(after.run!.stage).toBe(before.run!.stage + 1); expect(after.run!.equippedSkills).toEqual(['bridge', 'pierce']);
  expect(after.history!.runs.at(-1)!.battles.find(battle => battle.stage === 4)!.rewards).toHaveLength(2);
});
