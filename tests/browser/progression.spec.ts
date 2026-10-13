import { expect, test, type Page } from '@playwright/test';
import type { Save } from '../../src/game/types';

const key = 'chain-incantation.save.v1';
const saved = (page: Page): Promise<Save> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
async function resume(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
}
async function finished(page: Page) {
  await expect(page.locator('[data-action="cast"]')).not.toHaveText('詠唱中…');
  await expect(page.locator('.combat-effects, .completion-cutin')).toHaveCount(0);
}

test('desktop: honest Trinity bounds survive reselection and resolve exactly once across animation reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1080 }); await page.goto('/');
  const fixture = await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts', sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, previewAction, dispatch } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    for (let seed = 1; seed < 80; seed++) {
      const save = startRun(newSave(), 'fuse', seed); save.meta.tutorialDone = true;
      save.run.inventory = ['trinity']; save.run.hp = 1;
      for (const cell of singles(save.run.cells)) {
        const p = previewAction(save.run, cell);
        if (!p.forecast || !p.received || p.fullClear) continue;
        save.run.enemyHp = p.damage + 1;
        const report = previewAction(save.run, cell);
        if (report.forecast.kill !== 'possible' || report.forecast.survival !== 'possible') continue;
        const expected = dispatch(save, { type: 'play', cell, skill: false, revision: save.run.revision });
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report, expected, roots: singles(save.run.cells).slice(0, 5) };
      }
    }
    throw new Error('No possible-kill and possible-death Trinity fixture');
  }, key);
  await resume(page); const before = await saved(page);
  for (const cell of fixture.roots) {
    await page.locator(`[data-cell="${cell}"]`).hover();
    await page.locator(`[data-cell="${cell}"]`).click();
  }
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await expect(page.locator('.prediction-card')).toHaveAttribute('data-forecast', 'chance');
  await expect(page.locator('.chance-forecast')).toContainText('30%');
  await expect(page.locator('#prediction-damage')).toHaveText(fixture.report.damage.toLocaleString('ja-JP'));
  await expect(page.locator('#prediction-received')).toHaveText(`0〜${fixture.report.forecast.receivedMax}`);
  await expect(page.locator('.prediction-outcome')).toContainText('確率発動なら撃破');
  await expect(page.locator('.prediction-outcome')).toContainText('不発時は生命力が尽きます');
  await expect(page.locator('.prediction-outcome')).not.toContainText('撃破確定');
  expect(await saved(page)).toEqual(before);
  await page.screenshot({ path: '.runtime/screenshots/desktop-trinity-uncertainty.png', fullPage: true });
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-action="cast"]')!;
    for (let i = 0; i < 12; i++) button.click();
  });
  const committed = await saved(page); expect(committed).toEqual(fixture.expected);
  expect(committed.run!.stats.moves).toBe(1); expect(committed.run!.castCounter).toBe(1);
  await page.reload();
  if (committed.run!.phase === 'reward') await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  expect(await saved(page)).toEqual(committed);
  expect(errors).toEqual([]);
});

test('mobile: fifth boss offers rank upgrade and two Greater relics, and repeated reward clicks collect once', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.evaluate(async key => {
    const path = '/src/game/engine.ts'; const { newSave, startRun } = await import(/* @vite-ignore */ path);
    const save = startRun(newSave(), 'fuse', 71); save.meta.tutorialDone = true;
    save.run.stage = 4; save.run.stats.kills = 4; save.run.enemyHp = 1;
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
  await expect(page.locator('.endless-track')).toContainText('第5戦');
  await expect(page.locator('.endless-track')).toContainText('BOSS');
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.locator('[data-action="cast"]').click();
  const committed = await saved(page); expect(committed.run!.rewards.slice().sort()).toEqual(['greater:stroke', 'greater:trinity', 'skill-upgrade']);
  await resume(page);
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toBeVisible();
  expect(await saved(page)).toEqual(committed);
  await expect(page.locator('.upgrade-reward')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/mobile-boss-upgrades.png', fullPage: true });
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-reward="skill-upgrade"]')!;
    for (let i = 0; i < 10; i++) button.click();
  });
  const advanced = await saved(page);
  expect(advanced.run!.skillRank).toBe(2); expect(advanced.run!.spellLevel).toBe(committed.run!.spellLevel);
  expect(advanced.run!.stage).toBe(5); expect(advanced.run!.revision).toBe(committed.run!.revision + 1);
  await expect(page.locator('.skill-rank')).toHaveText('Rank 2');
  await page.reload(); expect(await saved(page)).toEqual(advanced); expect(errors).toEqual([]);
});

test('mobile: Battery reserve and Greater Trinity rank remain readable and persist through a skill', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const fixture = await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts', sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    const save = startRun(newSave(), 'fuse', 71); save.meta.tutorialDone = true; save.settings.reducedMotion = true;
    save.run.inventory = ['battery', 'trinity', 'stroke']; save.run.acquisitionRank.trinity = 3;
    save.run.tier = { trinity: 2, stroke: 2 }; save.run.mana = 8; save.run.manaOverflow = 2; save.run.skillRank = 2;
    const cell = singles(save.run.cells)[0];
    const expected = dispatch(save, { type: 'play', cell, skill: true, revision: save.run.revision });
    localStorage.setItem(key, JSON.stringify(save)); return { cell, expected };
  }, key);
  await resume(page);
  await expect(page.locator('.mana-reserve')).toContainText('2 / 2');
  await page.locator('.inventory summary').click();
  await expect(page.locator('[data-relic="trinity"]')).toBeVisible();
  await expect(page.locator('[data-relic="trinity"]')).toContainText('上位');
  await expect(page.locator('[data-relic="trinity"]')).toContainText('取得 3/3');
  await expect(page.locator('[data-relic="trinity"]')).toContainText('60％');
  await expect(page.locator('[data-relic="stroke"]')).toContainText('5マス');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/mobile-relic-ranks-reserve.png', fullPage: true });
  await page.locator('[data-action="skill"]').click();
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await expect(page.locator('.prediction-detail')).toContainText('蓄電2を引継ぎ');
  await page.locator('[data-action="cast"]').click(); await finished(page);
  const actual = await saved(page); expect(actual).toEqual(fixture.expected);
  expect(actual.run).toMatchObject({ mana: 2, manaOverflow: 0 });
  expect(actual.run!.lastReport!.charge).toBe(0);
  await resume(page); expect(await saved(page)).toEqual(actual);
});

for (const reducedMotion of [false, true]) {
test(`one-cast completion has additive breakdown and stable reload (reduced motion: ${reducedMotion})`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1080 }); await page.goto('/');
  const fixture = await page.evaluate(async ({ key, reducedMotion }) => {
    const enginePath = '/src/game/engine.ts', sudokuPath = '/src/game/sudoku.ts', contentPath = '/src/game/content.ts';
    const { newSave, startRun, previewAction } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath); const { enemyOf } = await import(/* @vite-ignore */ contentPath);
    for (let seed = 1; seed <= 30; seed++) {
      const save = startRun(newSave(), 'fuse', seed); save.meta.tutorialDone = true; save.settings.reducedMotion = reducedMotion;
      save.run.stage = 19; save.run.stats.kills = 19; save.run.enemyHp = enemyOf(19).hp;
      save.run.spellLevel = 60; save.run.skillRank = 2; save.run.mana = 8;
      for (const cell of singles(save.run.cells)) {
        const report = previewAction(save.run, cell, true);
        if (!report.oneCastClear || report.path.length !== 36) continue;
        localStorage.setItem(key, JSON.stringify(save)); return { cell, report };
      }
    }
    throw new Error('No one-cast complete fixture');
  }, { key, reducedMotion });
  await resume(page); await page.locator('[data-action="skill"]').click();
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await expect(page.locator('.prediction-outcome')).toContainText('一詠全成');
  const damageLineCount = await page.locator('#prediction-damage').evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
  });
  expect(damageLineCount).toBe(1);
  await page.locator('.prediction-breakdown summary').click();
  await expect(page.locator('.prediction-breakdown')).toContainText('この手36/36マス');
  await expect(page.locator('.prediction-breakdown')).toContainText(`＋${fixture.report.clearBonus.toLocaleString('ja-JP')}`);
  await page.evaluate(() => {
    const audit = { shown: false, animations: -1 };
    (window as any).oneCastAudit = audit;
    const observer = new MutationObserver(() => {
      const effect = document.querySelector('.combat-effects[data-phase="one-cast"]');
      if (effect) { audit.shown = true; audit.animations = effect.getAnimations({ subtree: true }).length; observer.disconnect(); }
    });
    observer.observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  await page.locator('[data-action="cast"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).oneCastAudit.shown), { intervals: [20], timeout: 15000 }).toBe(true);
  if (reducedMotion) expect(await page.evaluate(() => (window as any).oneCastAudit.animations)).toBe(0);
  if (!reducedMotion) {
    await expect(page.locator('.combat-effects')).toContainText('一詠全成');
    await page.screenshot({ path: '.runtime/screenshots/desktop-one-cast-celebration.png', fullPage: false });
  } else {
    await page.screenshot({ path: '.runtime/screenshots/desktop-one-cast-reduced-motion.png', fullPage: false });
  }
  const committed = await saved(page); expect(committed.run!.stats.moves).toBe(1); expect(committed.run!.stats.sheets).toBe(1);
  expect(committed.run!.lastReport!.clearBonus).toBe(Math.floor(committed.run!.lastReport!.baseDamage! * .25));
  await resume(page); expect(await saved(page)).toEqual(committed);
  expect(errors).toEqual([]);
});

}
