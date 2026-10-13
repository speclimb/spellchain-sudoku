import { expect, test, type Page } from '@playwright/test';
import type { Report, Run, Save } from '../../src/game/types';

const key = 'chain-incantation.save.v1';

type FixtureKind = 'hit' | 'block' | 'sheet';

/** Browser contexts are isolated, so these fixtures never overwrite a player's save. */
async function prepareCombat(page: Page, kind: FixtureKind, settings: { fast?: boolean; reducedMotion?: boolean } = {}): Promise<{ cell: number; report: Report; before: Run }> {
  await page.goto('/');
  const fixture = await page.evaluate(async ({ key, kind, settings }) => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, previewAction } = await import(/* @vite-ignore */ enginePath);
    const { candidates } = await import(/* @vite-ignore */ sudokuPath);
    for (let seed = 21; seed < 80; seed++) {
      const save = startRun(newSave(), 'fuse', seed);
      save.meta.tutorialDone = true;
      Object.assign(save.settings, settings);
      const run = save.run;
      if (kind === 'sheet') {
        const cell = run.cells.findIndex((n: number) => !n);
        run.cells = [...run.solution];
        run.cells[cell] = 0;
        const report = previewAction(run, cell);
        if (!report.fullClear || report.defeated || !report.sheetAdvanced) throw new Error('Sheet rollover fixture must survive the last fill');
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report, before: run };
      }
      for (let cell = 0; cell < 81; cell++) {
        if (run.cells[cell] || candidates(run.cells, cell).length !== 1) continue;
        let report = previewAction(run, cell);
        if (report.path.length !== 5 || report.defeated || report.fullClear) continue;
        if (kind === 'block') {
          run.marks.fill(null);
          const shields = report.path.slice(0, 3).map((event: { cell: number }) => event.cell);
          const weak = run.cells.flatMap((n: number, i: number) => !n && !shields.includes(i) ? [i] : []).slice(0, 3);
          shields.forEach((i: number) => { run.marks[i] = 'shield'; });
          weak.forEach((i: number) => { run.marks[i] = 'weak'; });
          report = previewAction(run, cell);
        }
        if (kind === 'hit' ? !report.received : report.received !== 0 || report.shield < report.incoming) continue;
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report, before: run };
      }
    }
    throw new Error(`No deterministic ${kind} combat fixture found`);
  }, { key, kind, settings });
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await expect(page.locator('#prediction-damage')).toHaveText(fixture.report.damage.toLocaleString('ja-JP'));
  return fixture;
}

async function saved(page: Page): Promise<Save> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
}

async function finished(page: Page): Promise<void> {
  await expect(page.locator('[data-action="cast"]')).not.toHaveText('詠唱中…');
  await expect(page.locator('.combat-effects[data-phase]')).toHaveCount(0);
}

test('chain, score strike and damaging counter are distinct visible phases with exact committed numbers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  const { report, before } = await prepareCombat(page, 'hit');
  await page.locator('[data-action="cast"]').click();
  const effects = page.locator('.combat-effects');
  await expect(effects).toHaveAttribute('data-phase', 'chain');
  await expect(effects.locator('.combat-chain')).toBeVisible();
  await expect(page.locator('[data-action="cast"]')).toBeDisabled();
  await expect(effects.locator('.combat-chain strong')).toHaveText(String(report.path.length));
  await page.screenshot({ path: '.runtime/screenshots/desktop-combat-chain.png', fullPage: false });
  await expect(effects).toHaveAttribute('data-phase', 'strike');
  await expect(effects.locator('.combat-number')).toContainText(report.damage.toLocaleString('ja-JP'));
  await expect(effects.locator('.combat-score')).toContainText(report.attackScore.toLocaleString('ja-JP'));
  await page.screenshot({ path: '.runtime/screenshots/desktop-combat-strike.png', fullPage: false });
  await expect(effects).toHaveAttribute('data-phase', 'counter');
  await expect(effects.locator('.combat-caption')).toContainText(/反撃|強攻撃/);
  await expect(effects.locator('.combat-number')).toContainText(`−${report.received}`);
  await page.screenshot({ path: '.runtime/screenshots/desktop-combat-counter.png', fullPage: false });
  await finished(page);
  const after = (await saved(page)).run!;
  expect(after.hp).toBe(before.hp - report.received);
  expect(after.enemyHp).toBe(before.enemyHp - report.damage);
  expect(after.score).toBe(before.score + report.attackScore);
  expect(after.lastReport).toEqual(report);
  expect(errors).toEqual([]);
});

test('mobile shield counter shows complete defense and combat effects do not overflow the playfield', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const { report, before } = await prepareCombat(page, 'block');
  await page.locator('[data-action="cast"]').click();
  const effects = page.locator('.combat-effects');
  await expect(effects).toHaveAttribute('data-phase', 'counter');
  await expect(effects.locator('.combat-caption')).toContainText('完全防御');
  await expect(effects.locator('.combat-number')).toContainText('0');
  await expect(effects.locator('.combat-shield')).toBeVisible();
  expect(report.shield).toBeGreaterThanOrEqual(report.incoming);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/mobile-combat-defense.png', fullPage: false });
  await finished(page);
  expect((await saved(page)).run!.hp).toBe(before.hp);
  expect(errors).toEqual([]);
});

test('full sheet advances against the same enemy, grows the spell and restores exactly once when reloaded during transition', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const { before, report } = await prepareCombat(page, 'sheet');
  await page.locator('[data-action="cast"]').click();
  await expect(page.locator('.combat-effects')).toHaveAttribute('data-phase', 'sheet');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const committed = await saved(page);
  const after = committed.run!;
  expect(after.id).toBe(before.id);
  expect(after.stage).toBe(before.stage);
  expect(after.phase).toBe('battle');
  expect(after.enemyHp).toBe(before.enemyHp - report.damage);
  expect(after.enemyHp).toBeGreaterThan(0);
  expect(after.cells).toContain(0);
  expect(after.solution).not.toEqual(before.solution);
  expect(after.sheet).toBe(before.sheet + 1);
  expect(after.encounterSheet).toBe(before.encounterSheet + 1);
  expect(after.spellLevel).toBe(before.spellLevel + 1);
  expect(after.maxHp).toBe(before.maxHp + 4);
  expect(after.stats.sheets).toBe(before.stats.sheets + 1);
  expect(after.stats.kills).toBe(before.stats.kills);
  expect(committed.meta.clears).toBe(0);
  await page.screenshot({ path: '.runtime/screenshots/mobile-next-sheet.png', fullPage: false });
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('.sheet-status')).toContainText(`シート ${after.encounterSheet}`);
  await expect(page.locator('.spell-growth')).toContainText(`術式 Lv.${after.spellLevel}`);
  await expect(page.locator('canvas')).toBeVisible();
  expect(await saved(page)).toEqual(committed);
  await expect(page.getByRole('dialog', { name: '遺物の選択' })).toHaveCount(0);
  await expect(page.locator('.combat-effects[data-phase]')).toHaveCount(0);
  await page.screenshot({ path: '.runtime/screenshots/mobile-grown-sheet.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('sheet completion visibly announces spell growth before clearing the effect layer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { before } = await prepareCombat(page, 'sheet');
  await page.locator('[data-action="cast"]').click();
  const effects = page.locator('.combat-effects');
  await expect(effects).toHaveAttribute('data-phase', 'growth');
  await expect(effects.locator('.combat-caption')).not.toBeEmpty();
  await expect(effects.locator('.combat-number')).toContainText(String(before.spellLevel + 1));
  await page.screenshot({ path: '.runtime/screenshots/desktop-spell-growth.png', fullPage: false });
  await finished(page);
  await expect(page.locator('.spell-growth')).toContainText('攻撃 ×1.2');
});

test('reduced motion keeps readable static outcomes, fast mode clears promptly, and effects leave no animation behind', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareCombat(page, 'hit', { reducedMotion: true });
  await page.locator('[data-action="cast"]').click();
  await expect(page.locator('.combat-effects')).toHaveAttribute('data-phase', 'strike');
  await expect(page.locator('html')).toHaveClass(/reduced-motion/);
  expect(await page.locator('.combat-effects').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await finished(page);
  await expect(page.locator('.combat-effects, .player-struck, .player-blocked, .enemy-struck')).toHaveCount(0);
  await prepareCombat(page, 'hit', { fast: true });
  const started = Date.now();
  await page.locator('[data-action="cast"]').click();
  await finished(page);
  expect(Date.now() - started).toBeLessThan(1600);
  await expect(page.locator('.combat-effects, .player-struck, .player-blocked, .enemy-struck')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
