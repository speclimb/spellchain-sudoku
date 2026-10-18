import { expect, test, type Page } from '@playwright/test';
import { savedGame, savedText } from './save-helpers';

const key = 'chain-incantation.save.v1';
test.use({ actionTimeout: 10000 });
const viewports = [{ name: 'desktop', width: 1920, height: 1080 }, { name: 'mobile', width: 390, height: 844 }];
async function inject(page: Page, scene: 'fusion' | 'boss' | 'victory') {
  await page.goto('/');
  await page.evaluate(async ({ key, scene }) => {
    const enginePath = '/src/game/engine.ts', enemyPath = '/src/game/enemies.ts';
    const { newSave, startRun, dispatch, legalOrigins } = await import(/* @vite-ignore */ enginePath);
    const { enemyForRun } = await import(/* @vite-ignore */ enemyPath);
    const initial = newSave(); initial.meta.tutorialDone = true;
    initial.settings.reducedMotion = true; initial.settings.sound = false;
    let save = startRun(initial, 'fuse', 730, 'campaign');
    if (scene === 'fusion') {
      const run = save.run;
      run.stage = 4; run.stats.kills = 4; run.enemyHp = 1;
      run.inventory = ['wick', 'rekindle']; run.relicLevels = { wick: 8, rekindle: 8 };
      run.tier = { wick: 3, rekindle: 3 }; run.acquisitionRank = { wick: 1, rekindle: 1 };
      save = dispatch(save, { type: 'play', cell: legalOrigins(run)[0], skill: false, revision: run.revision });
      save = dispatch(save, { type: 'reward', relic: save.run.rewards[0], revision: save.run.revision });
      save.run.rewards = ['training', 'vitality', 'recovery'];
    } else {
      save.run.stage = 99; save.run.stats.kills = 99;
      save.run.hp = save.run.maxHp = 50000;
      save.run.enemyHp = scene === 'victory' ? 1 : enemyForRun(save.run).hp;
    }
    localStorage.setItem(key, JSON.stringify(save));
  }, { key, scene });
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const dialog of await page.getByRole('dialog').all()) expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

for (const viewport of viewports) {
  test(`${viewport.name}: normal mode defaults to 100 battles and endless remains selectable`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto('/');
    await expect(page.locator('[data-mode="campaign"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-mode="endless"]')).toHaveAttribute('aria-pressed', 'false');
    await noOverflow(page);
    await page.screenshot({ path: `.runtime/screenshots/campaign-${viewport.name}-mode.png`, fullPage: true });
    await page.locator('[data-action="new"]').click();
    await expect(page.locator('.endless-track')).toContainText('第1戦 / 100');
    expect((await savedGame(page)).run!.mode).toBe('campaign');
    await page.getByRole('button', { name: 'タイトルへ', exact: true }).click();
    await page.locator('[data-mode="endless"]').click();
    await page.locator('[data-action="new"]').click();
    await page.locator('[data-action="restart"]').click();
    await expect(page.locator('.endless-track')).toContainText('エンドレス');
    expect((await savedGame(page)).run!.mode).toBe('endless');
    await noOverflow(page);
  });

  test(`${viewport.name}: bonus fusion persists without consuming the ordinary boss reward or freeing slots`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport); await inject(page, 'fusion');
    const dialog = page.getByRole('dialog', { name: '成長の選択' });
    await expect(dialog.locator('[data-fusion="eternal-flame"]')).toBeVisible();
    await expect(dialog.locator('[data-reward]')).toHaveCount(3);
    await expect(dialog.locator('.reward-slots')).toContainText('2 / 8');
    await noOverflow(page);
    await dialog.locator('[data-fusion="eternal-flame"]').evaluate(node => node.scrollIntoView({ block: 'center' }));
    // The initial scene-ready render may replace the modal while screenshot
    // fonts settle. Reacquire the live card for this visual-only capture.
    await expect(async () => {
      await dialog.locator('[data-fusion="eternal-flame"]').screenshot({ path: `.runtime/screenshots/campaign-${viewport.name}-fusion-card.png` });
    }).toPass({ timeout: 5000 });
    await page.screenshot({ path: `.runtime/screenshots/campaign-${viewport.name}-fusion-offer.png`, fullPage: true });
    const before = await savedGame(page);
    await dialog.locator('[data-fusion="eternal-flame"]').click(); await savedText(page);
    const fused = await savedGame(page);
    expect(fused.run!.fusions).toEqual(['eternal-flame']);
    expect(fused.run!.inventory).toEqual(before.run!.inventory);
    expect(fused.run!.rewards).toEqual(before.run!.rewards);
    expect(fused.run!.stage).toBe(4);
    await expect(dialog.locator('[data-fusion]')).toHaveCount(0);
    await expect(dialog.locator('[data-reward]')).toHaveCount(3);
    await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
    await expect(dialog).toContainText('融合を保存しました');
    expect((await savedGame(page)).run!.fusions).toEqual(['eternal-flame']);
    await dialog.locator('[data-reward="training"]').click(); await savedText(page);
    await expect(dialog).toHaveCount(0);
    await page.locator('.inventory > summary').click();
    await expect(page.locator('[data-fused="eternal-flame"]')).toContainText('不滅の星炉');
    await expect(page.locator('[data-fused="eternal-flame"]')).toContainText('2枠');
    await expect(page.locator('.inventory-item')).toHaveCount(1);
    await noOverflow(page);
    await page.screenshot({ path: `.runtime/screenshots/campaign-${viewport.name}-fusion-owned.png`, fullPage: true });
    const after = await savedGame(page);
    const boss = after.history!.runs.at(-1)!.battles.find(battle => battle.stage === 4)!;
    expect(boss.rewards.map(reward => reward.step)).toEqual(['skill', 'fusion', 'relic']);
    expect(errors).toEqual([]);
  });

  test(`${viewport.name}: final boss clearly previews escalating retaliation`, async ({ page }) => {
    await page.setViewportSize(viewport); await inject(page, 'boss');
    await expect(page.locator('.enemy-overline')).toContainText('FINAL BOSS');
    await expect(page.locator('.endless-track')).toContainText('第100戦 / 100');
    await expect(page.locator('.enemy-intent')).toContainText('次');
    const first = Number((await page.locator('.enemy-intent strong').innerText()).replace(/[^\d]/g, ''));
    await page.locator('[data-cell][aria-disabled="false"]').first().click();
    await page.screenshot({ path: `.runtime/screenshots/campaign-${viewport.name}-final-boss.png`, fullPage: true });
    await page.locator('[data-action="cast"]').click(); await savedText(page);
    await expect(page.locator('[data-action="cast"]')).not.toContainText('詠唱中');
    await expect.poll(async () => Number((await page.locator('.enemy-intent strong').innerText()).replace(/[^\d]/g, ''))).toBeGreaterThan(first);
    expect((await savedGame(page)).run!.phase).toBe('battle');
    await noOverflow(page);
  });

  test(`${viewport.name}: final boss victory ends the campaign without another reward or encounter`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport); await inject(page, 'victory');
    await page.locator('[data-cell][aria-disabled="false"]').first().click();
    await page.locator('[data-action="cast"]').click(); await savedText(page);
    const result = page.getByRole('dialog', { name: '冒険の結果' });
    await expect(result).toContainText('100戦を踏破');
    await expect(page.locator('[data-reward]')).toHaveCount(0);
    const save = await savedGame(page);
    expect(save.run!.phase).toBe('won'); expect(save.run!.stage).toBe(99); expect(save.run!.stats.kills).toBe(100);
    expect(save.meta.wins).toBe(1); expect(save.run!.rewards).toEqual([]);
    await noOverflow(page);
    await page.screenshot({ path: `.runtime/screenshots/campaign-${viewport.name}-victory.png`, fullPage: true });
    await page.reload();
    const restored = await savedGame(page);
    expect(restored.run!.phase).toBe('won'); expect(restored.meta.wins).toBe(1);
    expect(errors).toEqual([]);
  });
}
