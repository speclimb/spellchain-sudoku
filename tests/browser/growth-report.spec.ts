import { savedText } from './save-helpers';
import { expect, test, type Page } from '@playwright/test';
import type { Run } from '../../src/game/types';
const key = 'chain-incantation.save.v1';
const readRun = (page: Page): Promise<Run> => savedText(page, key).then(raw => JSON.parse(raw!).run);
async function resume(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
}
async function bossReward(page: Page) {
  await page.goto('/');
  await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts', sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    let save = startRun(newSave(), 'fuse', 413);
    save.settings.reducedMotion = true; save.settings.sound = false; save.meta.tutorialDone = true;
    save.run.inventory = ['pen', 'stroke', 'lens', 'battery', 'gold'];
    save.run.relicLevels = { pen: 2, stroke: 1, lens: 2, battery: 2, gold: 1 };
    save.run.skillLevels = { fuse: 2, bridge: 3, pierce: 4, bastion: 5 };
    save.run.skillRank = 2; save.run.equippedSkills = ['bridge', 'pierce'];
    for (let i = 0; i < 5; i++) {
      save.run.enemyHp = 1;
      save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
      if (i < 4) while (save.run.phase === 'reward') save = dispatch(save, { type: 'reward', relic: save.run.rewards[0], revision: save.run.revision });
    }
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
}

test('boss reward interruption preserves both steps and changes equipment without losing owned skills', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await bossReward(page);
  await expect(page.locator('.reward-progress')).toHaveAttribute('aria-label', 'ボス報酬 1/2 スキル');
  const before = await readRun(page);
  expect(before.rewardStep).toBe('skill');
  await resume(page);
  expect((await readRun(page)).rewards).toEqual(before.rewards);
  await page.locator('[data-equip-skill="bridge"]').click();
  await page.locator('[data-equip-skill="bastion"]').click();
  const equipped = await readRun(page);
  expect(equipped.equippedSkills).toEqual(['pierce', 'bastion']);
  expect(equipped.skillLevels?.bridge).toBe(3);
  expect(equipped.rewards).toEqual(before.rewards);
  await page.locator(`[data-reward="${equipped.rewards[0]}"]`).click();
  await expect(page.locator('.reward-progress')).toHaveAttribute('aria-label', 'ボス報酬 2/2 遺物');
  const second = await readRun(page);
  expect(second.stage).toBe(4);
  expect(second.rewardStep).toBe('relic');
  await resume(page);
  expect(await readRun(page)).toEqual(second);
  await expect(page.locator('.equipment-slots')).toContainText('固有');
  await page.screenshot({ path: '.runtime/screenshots/desktop-growth-reward.png', fullPage: true, animations: 'disabled', timeout: 15000 });
  // This flow checks equipment persistence; the first shuffled reward may now
  // be a new relic that legitimately opens the replacement comparison.
  const safeReward = second.rewards.find(id => ['training', 'vitality', 'recovery', 'magic-boon', 'defense-boon'].includes(id)
    || second.inventory.some(owned => id === owned || id === `greater:${owned}` || id === `apex:${owned}`));
  expect(safeReward).toBeDefined();
  await page.locator(`[data-reward="${safeReward}"]`).click();
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toHaveCount(0);
  const next = await readRun(page);
  expect(next.phase).toBe('battle'); expect(next.stage).toBe(5);
  expect(next.equippedSkills).toEqual(['pierce', 'bastion']);
  expect(next.stats.kills).toBe(5);
  await resume(page);
  expect((await readRun(page)).stage).toBe(5);
});

test('selected equipped skill has its own preview and uses the shared free coupon before mana', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts';
    const { newSave, startRun } = await import(/* @vite-ignore */ enginePath);
    const save = startRun(newSave(), 'fuse', 45);
    save.meta.tutorialDone = true; save.settings.reducedMotion = true; save.settings.sound = false;
    save.run.skillLevels = { fuse: 1, pierce: 5, bastion: 5 };
    save.run.equippedSkills = ['pierce', 'bastion']; save.run.mana = 8;
    save.run.inventory = ['quint', 'lens']; save.run.relicLevels = { quint: 1, lens: 1 }; save.run.tier.lens = 2;
    save.run.freeSkillTokens = 1;
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
  await expect(page.locator('.skill-picker button')).toHaveCount(3);
  const before = await readRun(page);
  await page.locator('[data-select-skill="pierce"]').click();
  await expect(page.locator('[data-select-skill="pierce"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await readRun(page)).toEqual(before);
  const cell = Number(await page.locator('[data-cell][aria-disabled="false"]').first().getAttribute('data-cell'));
  await page.locator(`[data-cell="${cell}"]`).click();
  const expected = await page.evaluate(async ({ run, cell }) => {
    const path = '/src/game/engine.ts';
    const { previewAction, longestOrigins } = await import(/* @vite-ignore */ path);
    return { report: previewAction(run, cell, true, 'pierce'), best: longestOrigins(run, true, 'pierce') };
  }, { run: before, cell });
  await expect(page.locator('#prediction-damage')).toHaveText(expected.report.damage.toLocaleString('ja-JP'));
  await expect(page.locator('[data-cell][data-longest="true"]')).toHaveCount(expected.best.cells.length);
  await expect(page.locator(`[data-cell="${cell}"]`)).toHaveAttribute('data-root', 'selected');
  await page.locator('[data-action="cast"]').click();
  await expect(page.locator('[data-action="cast"]')).not.toContainText('詠唱中');
  const after = await readRun(page);
  expect(after.lastReport?.skillId).toBe('pierce');
  expect(after.lastReport?.freeSkill).toBe(true);
  expect(after.mana).toBe(8); expect(after.freeSkillTokens).toBe(0);
  expect(after.stats.skills).toBe(before.stats.skills + 1);
  expect(after.lastReport?.damage).toBe(expected.report.damage);
  await page.screenshot({ path: '.runtime/screenshots/mobile-skill-selection.png', fullPage: true, animations: 'disabled', timeout: 15000 });
});

test('mobile report offers three highlights then detailed separate metrics and a boss-only view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bossReward(page);
  const report = page.locator('.contribution-report');
  await expect(report).toHaveAttribute('data-window', 'recent');
  await expect(report.locator('.report-sample')).toContainText('5戦');
  expect(await report.locator('.report-highlights li').count()).toBeLessThanOrEqual(3);
  await expect(report.locator('.report-totals')).toContainText('HPに与えたダメージ');
  await expect(report.locator('.report-totals')).toContainText('超過ダメージ');
  await expect(report.locator('.report-totals')).toContainText('獲得スコア');
  await expect(report.locator('.report-caution')).toContainText('数値を足しても全体のダメージにはなりません');
  await expect(report.locator('.contribution-details')).not.toHaveAttribute('open');
  await page.locator('[data-report-window="boss"]').click();
  await expect(report.locator('.report-sample')).toContainText('1戦');
  await report.locator('.contribution-details>summary').click();
  await expect(report.locator('[data-relic-report="pen"]')).toContainText('所持中');
  await expect(report.locator('[data-relic-report="pen"]')).toContainText('機会');
  await expect(report.locator('[data-relic-report="pen"]')).toContainText('次の成長');
  await expect(report.locator('[data-skill-report="bridge"]')).toContainText('未使用');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: '.runtime/screenshots/mobile-contribution-report.png', fullPage: true, animations: 'disabled', timeout: 15000 });
});

test('an already-sampled legacy boss reward stays a single step after reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async key => {
    const path = '/src/game/engine.ts', sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ path);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    let save = startRun(newSave(), 'fuse', 21);
    save.meta.tutorialDone = true; save.settings.reducedMotion = true; save.settings.sound = false;
    save.run.stage = 4; save.run.stats.kills = 4; save.run.enemyHp = 1;
    save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
    save.run.rewards = ['skill-upgrade', 'greater:lens', 'greater:wick'];
    for (const field of ['expansionVersion', 'enemyRulesVersion', 'skillLevels', 'equippedSkills', 'relicLevels', 'rewardStep', 'pendingRelicRewards', 'contributions']) delete save.run[field];
    for (const field of ['skillId', 'skillLevel', 'extraDamage', 'armorPrevented', 'armorBroken', 'ledger', 'temporaryShield', 'enemyStyle']) delete save.run.lastReport[field];
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
  await expect(page.locator('.reward-progress')).toHaveCount(0);
  await expect(page.locator('[data-reward="skill-upgrade"]')).toBeVisible();
  await expect(page.locator('.reward-card')).toHaveCount(3);
  await page.locator('[data-reward="greater:lens"]').click();
  const next = await readRun(page);
  expect(next.phase).toBe('battle'); expect(next.stage).toBe(5);
  expect(next.tier.lens).toBe(2); expect(next.rewardStep).toBeUndefined();
  await resume(page); expect(await readRun(page)).toEqual(next);
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toHaveCount(0);
});
