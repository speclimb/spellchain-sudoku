import { expect, test, type Page } from '@playwright/test';
import type { Save } from '../../src/game/types';

const key = 'chain-incantation.save.v1';
const saved = (page: Page): Promise<Save> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
async function resume(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
}
const finished = (page: Page) => expect(page.locator('.combat-effects')).toHaveCount(0);

for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }]) {
  test(`dense 36-cell preview preserves every legal root and reselects without a relic at ${viewport.width}px`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport); await page.goto('/');
    const fixture = await page.evaluate(async key => {
      const path = '/src/game/engine.ts';
      const { newSave, startRun, previewAction, legalOrigins } = await import(/* @vite-ignore */ path);
      for (let seed = 1; seed < 100; seed++) {
        const save = startRun(newSave(), 'fuse', seed); save.meta.tutorialDone = true;
        const run = save.run; run.spellLevel = 32;
        const legal = legalOrigins(run, false);
        for (const cell of legal) {
          const report = previewAction(run, cell);
          const alternative = legal.find((other: number) => other !== cell && report.path.some((e: { cell: number }) => e.cell === other));
          if (report.path.length !== 36 || alternative === undefined) continue;
          localStorage.setItem(key, JSON.stringify(save)); return { cell, alternative, legal, blanks: run.cells.filter((n: number) => !n).length };
        }
      }
      throw new Error('No dense natural 36-link fixture');
    }, key);
    await resume(page); const before = await saved(page);
    await page.locator(`[data-cell="${fixture.cell}"]`).click();
    await expect(page.locator('#prediction-chain')).toHaveText('36');
    await expect(page.locator('[data-root="selected"]')).toHaveCount(1);
    await expect(page.locator('[data-root="legal"]')).toHaveCount(fixture.legal.length - 1);
    await expect(page.locator('[data-path="true"]')).toHaveCount(36);
    const alternative = page.locator(`[data-cell="${fixture.alternative}"]`);
    await expect(alternative).toHaveAttribute('data-root', 'legal');
    await expect(alternative).toHaveAttribute('data-path', 'true');
    await expect(alternative.locator('.origin-mark')).toHaveText('○');
    await expect(alternative).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('[data-longest="true"]')).toHaveCount(0);
    await expect(page.locator('.longest-origins')).toHaveCount(0);
    expect(await saved(page)).toEqual(before);
    await page.screenshot({ path: `.runtime/screenshots/endgame-roots-${viewport.width}.png`, fullPage: true });
    await alternative.click();
    await expect(alternative).toHaveAttribute('data-root', 'selected');
    await page.locator(`[data-cell="${fixture.cell}"]`).focus(); await page.keyboard.press('Enter');
    await expect(page.locator(`[data-cell="${fixture.cell}"]`)).toHaveAttribute('data-root', 'selected');
    expect(await saved(page)).toEqual(before);
    await page.evaluate(key => { const save = JSON.parse(localStorage.getItem(key)!); save.run.inventory = ['quint']; save.run.freeSkillTokens = 1; localStorage.setItem(key, JSON.stringify(save)); }, key);
    await resume(page); const withToken = await saved(page);
    await page.locator('[data-action="skill"]').click();
    await expect(page.locator('[data-root="legal"]')).toHaveCount(fixture.blanks);
    await page.locator(`[data-cell="${fixture.cell}"]`).click();
    await expect(page.locator('[data-root="legal"]')).toHaveCount(fixture.blanks - 1);
    await expect(page.locator('.prediction-detail')).toContainText('無料スキル1回を優先使用');
    await alternative.click(); await expect(alternative).toHaveAttribute('data-root', 'selected');
    expect(await saved(page)).toEqual(withToken);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('upper lens marks all tied longest roots in normal and free-skill modes without drawing randomness', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const fixture = await page.evaluate(async key => {
    const path = '/src/game/engine.ts';
    const { newSave, startRun, longestOrigins, legalOrigins } = await import(/* @vite-ignore */ path);
    for (let seed = 1; seed < 70; seed++) {
      const save = startRun(newSave(), 'fuse', seed); save.meta.tutorialDone = true;
      const run = save.run; run.inventory = ['lens', 'quint']; run.tier.lens = 2; run.freeSkillTokens = 1; run.spellLevel = 9;
      const normal = longestOrigins(run, false), skill = longestOrigins(run, true);
      if (normal.cells.length < 2 || skill.cells.length < 2) continue;
      localStorage.setItem(key, JSON.stringify(save)); return { normal, skill, legal: legalOrigins(run, false) };
    }
    throw new Error('No tied longest-root fixture');
  }, key);
  await resume(page); const before = await saved(page);
  const roots = () => page.locator('[data-longest="true"]').evaluateAll(elements => elements.map(element => Number((element as HTMLElement).dataset.cell)));
  expect(await roots()).toEqual(fixture.normal.cells);
  await expect(page.locator('.longest-origins')).toHaveAttribute('data-length', String(fixture.normal.length));
  await expect(page.locator('.longest-origins')).toHaveAttribute('data-count', String(fixture.normal.cells.length));
  await expect(page.locator('.longest-origins')).toContainText('ダメージは各予告で比較');
  await page.locator(`[data-cell="${fixture.normal.cells[0]}"]`).click();
  expect(await roots()).toEqual(fixture.normal.cells);
  const cast = await page.locator('[data-action="cast"]').boundingBox();
  expect(cast!.y + cast!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: '.runtime/screenshots/endgame-lens-mobile.png', fullPage: true });
  await page.locator('[data-action="skill"]').click();
  expect(await roots()).toEqual(fixture.skill.cells);
  await expect(page.locator('.longest-origins')).toHaveAttribute('data-length', String(fixture.skill.length));
  await expect(page.locator('[data-root="legal"]')).toHaveCount(36);
  await page.locator(`[data-cell="${fixture.skill.cells.at(-1)}"]`).click();
  await expect(page.locator('#prediction-chain')).toHaveText(String(fixture.skill.length));
  expect(await saved(page)).toEqual(before);
  await page.locator('[data-action="skill"]').click();
  expect(await roots()).toEqual(fixture.normal.cells);
  expect(await saved(page)).toEqual(before);
});

async function multisheet(page: Page, reducedMotion: boolean) {
  await page.goto('/');
  return page.evaluate(async ({ key, reducedMotion }) => {
    const path = '/src/game/engine.ts';
    const { newSave, startRun, previewAction, legalOrigins, dispatch } = await import(/* @vite-ignore */ path);
    for (let seed = 1; seed < 80; seed++) {
      const save = startRun(newSave(), 'fuse', seed); save.meta.tutorialDone = true; save.settings.reducedMotion = reducedMotion;
      const run = save.run; run.spellLevel = 60; run.inventory = ['wick']; run.tier.wick = 2;
      for (const cell of legalOrigins(run, false)) {
        const report = previewAction(run, cell);
        if (report.segments.length < 2 || !report.segments[0].oneCastClear) continue;
        const expected = dispatch(save, { type: 'play', cell, skill: false, revision: run.revision });
        localStorage.setItem(key, JSON.stringify(save)); return { cell, report, expected };
      }
    }
    throw new Error('No multi-sheet fixture');
  }, { key, reducedMotion });
}

test('multi-sheet guide projects each board separately, and skip resolves the already-saved cast exactly once', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1080 });
  const fixture = await multisheet(page, false); await resume(page);
  const before = await saved(page); const second = fixture.report.segments![1];
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await expect(page.locator('[data-path="true"]')).toHaveCount(36);
  await expect(page.locator('.sheet-forecast')).toContainText('シートにまたがる連鎖');
  await page.locator('[data-action="chain-guide"]').click();
  await page.evaluate(count => { for (let i = 0; i < count; i++) document.querySelector<HTMLButtonElement>('[data-action="chain-next"]')!.click(); }, second.pathStart);
  await expect(page.locator('.board-surface')).toHaveAttribute('data-sheet', String(second.sheet));
  await expect(page.locator('#chain-step-title')).toContainText(`シート${second.sheet}へ連鎖を継続`);
  await expect(page.locator('.sheet-status')).toContainText(`予告シート ${second.sheet}`);
  const next = fixture.report.path[second.pathStart];
  await expect(page.locator(`[data-cell="${next.cell}"]`)).toHaveAttribute('aria-label', new RegExp(`次に${next.value}を入力`));
  await expect(page.locator('[data-path="true"]')).toHaveCount(1);
  expect(await saved(page)).toEqual(before);
  await page.screenshot({ path: '.runtime/screenshots/endgame-next-sheet-guide.png', fullPage: true });
  await page.locator('[data-action="chain-prev"]').click();
  await expect(page.locator('.board-surface')).toHaveAttribute('data-sheet', String(fixture.report.segments![0].sheet));
  await page.locator('[data-action="chain-close"]').click();
  await page.locator('[data-action="cast"]').click();
  expect(await saved(page)).toEqual(fixture.expected);
  await expect.poll(() => page.locator('.board-surface').getAttribute('data-sheet'), { intervals: [20] }).toBe(String(second.sheet));
  await page.locator('[data-action="skip-animation"]').click();
  await finished(page);
  expect(await saved(page)).toEqual(fixture.expected);
  await page.reload(); expect(await saved(page)).toEqual(fixture.expected);
  expect(errors).toEqual([]);
});

test('reduced-motion multi-sheet animation still labels one-cast clear and reload never repeats the spell', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await multisheet(page, true); await resume(page);
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await page.locator('[data-action="cast"]').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('.combat-effects')?.getAttribute('data-phase')), { intervals: [10] }).toBe('one-cast');
  await expect(page.locator('.combat-effects')).toHaveClass(/fx-still/);
  await expect(page.locator('.combat-number')).toContainText('シート 1');
  await page.screenshot({ path: '.runtime/screenshots/endgame-multisheet-reduced-motion.png', fullPage: true });
  expect(await saved(page)).toEqual(fixture.expected);
  await page.reload(); expect(await saved(page)).toEqual(fixture.expected);
  await expect(page.locator('.combat-effects')).toHaveCount(0);
});

test('free tokens take priority over full mana, and reserved fuel plus five-encounter boons stay readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const fixture = await page.evaluate(async key => {
    const path = '/src/game/engine.ts'; const { newSave, startRun, legalOrigins, dispatch } = await import(/* @vite-ignore */ path);
    const save = startRun(newSave(), 'fuse', 71); save.meta.tutorialDone = true; save.settings.reducedMotion = true;
    const run = save.run; run.inventory = ['battery', 'quint', 'sept']; run.mana = 8; run.manaOverflow = 2;
    run.freeSkillTokens = 2; run.tier.quint = 2; run.reservedAuto = 7; run.boons = { defense: 3, magic: 5 };
    const cell = legalOrigins(run, true)[0], expected = dispatch(save, { type: 'play', cell, skill: true, revision: run.revision });
    localStorage.setItem(key, JSON.stringify(save)); return { cell, expected };
  }, key);
  await resume(page);
  await expect(page.locator('.free-skill-tokens')).toContainText('2回');
  await expect(page.locator('.reserved-auto')).toContainText('自動＋7回');
  await expect(page.locator('.defense-boon')).toContainText('残り3戦');
  await expect(page.locator('.magic-boon')).toContainText('残り5戦');
  await page.locator('[data-action="skill"]').click(); await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await expect(page.locator('.prediction-detail')).toContainText('魔力を温存');
  await expect(page.locator('.chance-forecast [data-proc="quint"]')).toHaveCount(0);
  await page.screenshot({ path: '.runtime/screenshots/endgame-tokens-reserve-boons.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-action="cast"]').click(); await finished(page);
  expect(await saved(page)).toEqual(fixture.expected);
  const result = (await saved(page)).run!;
  expect(result).toMatchObject({ mana: 8, manaOverflow: 2, freeSkillTokens: 1 });
});

test('an exhausted upper-relic boss offers both five-encounter boons and applying one survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts', contentPath = '/src/game/content.ts';
    const { newSave, startRun } = await import(/* @vite-ignore */ enginePath);
    const { greaterIds, primeIds } = await import(/* @vite-ignore */ contentPath);
    const save = startRun(newSave(), 'fuse', 71); save.meta.tutorialDone = true; save.settings.reducedMotion = true;
    const run = save.run; run.stage = 4; run.stats.kills = 4; run.enemyHp = 1; run.skillRank = 2;
    run.inventory = [...run.pool]; run.maxHp -= 8; run.hp = run.maxHp;
    for (const id of greaterIds) run.tier[id] = 2;
    for (const id of primeIds) run.acquisitionRank[id] = 3;
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.locator('[data-action="cast"]').click();
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toBeVisible();
  const victory = await saved(page);
  expect(victory.run!.rewards.slice().sort()).toEqual(['defense-boon', 'magic-boon', 'training']);
  await expect(page.locator('[data-reward="magic-boon"]')).toContainText('5戦');
  await expect(page.locator('[data-reward="defense-boon"]')).toContainText('25％');
  await page.screenshot({ path: '.runtime/screenshots/endgame-boon-reward.png', fullPage: true });
  await page.locator('[data-reward="defense-boon"]').click();
  await expect(page.locator('.defense-boon')).toContainText('残り5戦');
  const next = await saved(page); expect(next.run!.stage).toBe(5); expect(next.run!.boons.defense).toBe(5);
  await resume(page); expect(await saved(page)).toEqual(next);
  await expect(page.locator('.defense-boon')).toContainText('残り5戦');
});
