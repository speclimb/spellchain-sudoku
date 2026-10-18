import { expect, test, type Page } from '@playwright/test';
import { savedGame } from './save-helpers';

const key = 'chain-incantation.save.v1';
test.use({ actionTimeout: 10000 });
type Fixture = { mode?: 'campaign' | 'endless'; level?: number; legacy?: boolean; scene?: 'growth' | 'evolution' | 'fusion' };

async function resume(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  // The board module performs one initial render; interact with details only
  // after it mounts so the screenshot represents a settled, playable scene.
  await expect(page.locator('canvas')).toBeAttached();
}

async function inject(page: Page, options: Fixture = {}) {
  await page.goto('/');
  const result = await page.evaluate(async ({ key, options }) => {
    const enginePath = '/src/game/engine.ts', rewardsPath = '/src/game/rewards.ts', sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun } = await import(/* @vite-ignore */ enginePath);
    const { rollRelicRewards } = await import(/* @vite-ignore */ rewardsPath);
    const { Random } = await import(/* @vite-ignore */ sudokuPath);
    const initial = newSave(); initial.meta.tutorialDone = true;
    initial.settings.reducedMotion = true; initial.settings.sound = false;
    const save = startRun(initial, 'fuse', 730, options.mode ?? 'campaign'), run = save.run;
    if (options.legacy) delete run.progressionVersion;
    run.stage = options.scene === 'fusion' ? 9 : 50;
    run.phase = 'reward'; run.rewardStep = 'relic'; run.enemyHp = 0;
    run.cells = [...run.solution]; run.stats.kills = run.stage + 1;
    run.pendingRelicRewards = []; run.lastReport = null;
    run.inventory = options.scene === 'fusion' ? ['wick', 'rekindle'] : ['pen'];
    run.relicLevels = Object.fromEntries(run.inventory.map((id: string) => [id, options.scene === 'fusion' ? 8 : options.level ?? 3]));
    run.tier = Object.fromEntries(run.inventory.map((id: string) => [id, options.scene === 'evolution' ? 2 : run.relicLevels[id] >= 5 ? 3 : 1]));
    run.acquisitionRank = Object.fromEntries(run.inventory.map((id: string) => [id, 1]));
    run.rewards = options.scene === 'fusion' || options.legacy ? ['training', 'vitality', 'recovery'] : ['pen', 'training', 'recovery'];
    let selected = 'pen';
    if (options.scene === 'evolution') {
      let found = false;
      // Search a deterministic reward stream, then save the real sampled menu.
      // Reload must preserve that menu without drawing the lottery again.
      for (let index = 0; index < 1000; index++) {
        const random = new Random(Math.imul(index + 1, 0x9e3779b1) >>> 0);
        const offers = rollRelicRewards(run, random);
        const evolution = offers.find((id: string) => /^(greater|apex):/.test(id));
        if (!evolution) continue;
        run.rewards = offers; run.randomState = random.state; selected = evolution; found = true; break;
      }
      if (!found) throw new Error('No ordinary evolution menu in the deterministic seed sample');
    }
    localStorage.setItem(key, JSON.stringify(save));
    return { selected, offers: [...run.rewards], randomState: run.randomState };
  }, { key, options });
  await resume(page);
  return result;
}

for (const viewport of [{ name: 'desktop', width: 1920, height: 1080 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`${viewport.name}: new campaign grants one level after battle 50 and stops at eight`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await inject(page, { level: 3 });
    const dialog = page.getByRole('dialog', { name: '成長の選択' });
    await expect(dialog.locator('[data-reward="pen"]')).toContainText('Lv.4');
    await dialog.locator('[data-reward="pen"]').click();
    expect((await savedGame(page)).run!.relicLevels!.pen).toBe(4);
    await page.locator('.inventory > summary').click();
    await expect(page.locator('.inventory-item[data-relic="pen"]')).toContainText('Lv.4');
    await page.getByRole('button', { name: '遺物図鑑', exact: true }).click();
    const card = page.getByRole('dialog', { name: '遺物図鑑' }).locator('[data-codex-relic="pen"]');
    await card.locator('.codex-growth > summary').click();
    await expect(card.locator('.codex-levels li')).toHaveCount(8);
    await expect(card.locator('[data-level="8"]')).toContainText('上限');
    await card.locator('[data-level="8"]').scrollIntoViewIfNeeded();
    await expect(card.locator('[data-level="8"]')).toBeVisible();
    await expect(card.locator('.codex-growth')).toHaveAttribute('open');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: `.runtime/screenshots/progression-${viewport.name}-campaign-eight.png` });
  });

  test(`${viewport.name}: ordinary evolution is sampled once, survives reload, and advances tier only`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await inject(page, { scene: 'evolution', level: 5 });
    expect(fixture.selected).toBe('apex:pen');
    const dialog = page.getByRole('dialog', { name: '成長の選択' });
    await expect(dialog.locator(`[data-reward="${fixture.selected}"]`)).toBeVisible();
    const before = await savedGame(page);
    await resume(page);
    expect((await savedGame(page)).run).toEqual(before.run);
    expect(before.run!.rewards).toEqual(fixture.offers);
    expect(before.run!.randomState).toBe(fixture.randomState);
    await dialog.locator(`[data-reward="${fixture.selected}"]`).click();
    const after = await savedGame(page);
    expect(after.run!.tier.pen).toBe(3); expect(after.run!.relicLevels!.pen).toBe(5);
    expect(after.run!.stage).toBe(51); expect(after.run!.revision).toBe(before.run!.revision + 1);
    await resume(page);
    expect((await savedGame(page)).run).toEqual(after.run);
  });

  test(`${viewport.name}: apex level eight fusion retains both slots and the ordinary boss reward`, async ({ page }) => {
    await page.setViewportSize(viewport); await inject(page, { scene: 'fusion' });
    const dialog = page.getByRole('dialog', { name: '成長の選択' });
    await expect(dialog.locator('[data-fusion="eternal-flame"]')).toBeVisible();
    const before = await savedGame(page);
    await dialog.locator('[data-fusion="eternal-flame"]').click();
    const fused = await savedGame(page);
    expect(fused.run!.fusions).toEqual(['eternal-flame']);
    expect(fused.run!.inventory).toEqual(['wick', 'rekindle']);
    expect(fused.run!.rewards).toEqual(before.run!.rewards);
    expect(fused.run!.relicLevels).toEqual({ wick: 8, rekindle: 8 });
    await resume(page);
    await expect(dialog).toContainText('融合を保存しました');
    await expect(dialog.locator('[data-reward]')).toHaveCount(3);
    await expect(dialog.locator('.reward-slots')).toContainText('2 / 8');
    await dialog.locator('[data-reward="training"]').click();
    expect((await savedGame(page)).run!.stage).toBe(10);
    await page.locator('.inventory > summary').click();
    await expect(page.locator('[data-fused="eternal-flame"]')).toContainText('2枠');
    await expect(page.locator('[data-fused="eternal-flame"]')).toContainText('Lv.8');
    await expect(page.locator('.inventory-item')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-fused="eternal-flame"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.runtime/screenshots/progression-${viewport.name}-fusion-eight.png` });
  });
}

test('campaign level seven reaches its level eight cap and remains capped after reload', async ({ page }) => {
  await inject(page, { level: 7 });
  await page.locator('[data-reward="pen"]').click();
  expect((await savedGame(page)).run!.relicLevels!.pen).toBe(8);
  await resume(page);
  expect((await savedGame(page)).run!.relicLevels!.pen).toBe(8);
  const eligible = await page.evaluate(async () => {
    const rewardsPath = '/src/game/rewards.ts';
    const { canTakeReward } = await import(/* @vite-ignore */ rewardsPath);
    const run = JSON.parse(localStorage.getItem('chain-incantation.save.v1')!).run;
    return canTakeReward({ ...run, rewardStep: 'relic' }, 'pen');
  });
  expect(eligible).toBe(false);
});

test('endless level nineteen grows to twenty and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await inject(page, { mode: 'endless', level: 19 });
  await expect(page.locator('[data-reward="pen"]')).toContainText('Lv.20');
  await page.locator('[data-reward="pen"]').click();
  expect((await savedGame(page)).run!.relicLevels!.pen).toBe(20);
  await resume(page);
  await page.locator('.inventory > summary').click();
  await expect(page.locator('.inventory-item[data-relic="pen"]')).toContainText('Lv.20');
  await page.locator('.inventory-item[data-relic="pen"]').scrollIntoViewIfNeeded();
  await expect(page.locator('.inventory')).toHaveAttribute('open');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: '.runtime/screenshots/progression-desktop-endless-twenty.png' });
});

test('title codex follows the selected campaign and endless level caps', async ({ page }) => {
  await page.goto('/');
  for (const [mode, cap] of [['campaign', 8], ['endless', 20]] as const) {
    await page.locator(`[data-mode="${mode}"]`).click();
    await page.getByRole('button', { name: '遺物図鑑', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '遺物図鑑' });
    const card = dialog.locator('[data-codex-relic="pen"]');
    await card.locator('.codex-growth > summary').click();
    await expect(card.locator('.codex-levels li')).toHaveCount(cap);
    await expect(card.locator(`[data-level="${cap}"]`)).toContainText('上限');
    await dialog.locator('.modal-close').click();
  }
});

test('an in-flight flagless campaign keeps its level ten relic and codex after saving again', async ({ page }) => {
  await inject(page, { level: 10, legacy: true });
  const before = await savedGame(page);
  expect(before.run!.progressionVersion).toBeUndefined();
  await page.locator('[data-reward="training"]').click();
  await resume(page);
  const after = await savedGame(page);
  expect(after.run!.progressionVersion).toBeUndefined();
  expect(after.run!.relicLevels!.pen).toBe(10);
  await page.getByRole('button', { name: '遺物図鑑', exact: true }).click();
  const card = page.getByRole('dialog', { name: '遺物図鑑' }).locator('[data-codex-relic="pen"]');
  await card.locator('.codex-growth > summary').click();
  await expect(card.locator('.codex-levels li')).toHaveCount(10);
  await expect(card.locator('[data-level="10"]')).toContainText('上限');
});

test('320px title keeps both new-adventure modes visible without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/');
  await expect(page.locator('[data-mode="campaign"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-mode="campaign"]')).toBeInViewport();
  await expect(page.locator('[data-mode="endless"]')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/progression-narrow-mode.png' });
});
