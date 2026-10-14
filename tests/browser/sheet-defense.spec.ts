import { savedText } from './save-helpers';
import { expect, test, type Page } from '@playwright/test';
import type { Report, Run, Save } from '../../src/game/types';

const key = 'chain-incantation.save.v1';

async function phase(page: Page, expected: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.querySelector('.combat-effects')?.getAttribute('data-phase')), { intervals: [20] }).toBe(expected);
}

async function saved(page: Page): Promise<Save> {
  return savedText(page, key).then(raw => JSON.parse(raw!));
}

async function resumed(page: Page): Promise<void> {
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
}

async function finished(page: Page): Promise<void> {
  await expect(page.locator('[data-action="cast"]')).not.toHaveText('詠唱中…');
  await expect(page.locator('.combat-effects, .completion-cutin')).toHaveCount(0);
}

async function lateSheet(page: Page, remaining: 1 | 2, ward: boolean): Promise<{ cell: number; nextCell: number | null; before: Run; defense: number; report: Report }> {
  await page.goto('/');
  const fixture = await page.evaluate(async ({ key, remaining, ward }) => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const contentPath = '/src/game/content.ts';
    const { newSave, startRun, previewAction, sheetShield } = await import(/* @vite-ignore */ enginePath);
    const { PEERS } = await import(/* @vite-ignore */ sudokuPath);
    const { enemyOf } = await import(/* @vite-ignore */ contentPath);
    const save = startRun(newSave(), 'fuse', 21);
    save.meta.clears = 8;
    save.meta.tutorialDone = true;
    const run = save.run;
    run.stage = 8; run.balanceVersion = 1; run.enemyRulesVersion = 0;
    run.stats.kills = 8;
    run.turn = 2; // The next attack is the third-turn heavy counter.
    run.sheet = 9;
    run.puzzleCursor = 8;
    run.spellLevel = 30;
    run.maxHp = 156;
    run.hp = ward ? 5 : 156;
    run.enemyHp = enemyOf(run.stage, run.balanceVersion).hp;
    if (ward) run.inventory = ['ward'];
    const empty = run.cells.flatMap((value: number, cell: number) => !value && run.marks[cell] !== 'shield' ? [cell] : []);
    const cell = empty[0];
    const nextCell = remaining === 2 ? empty.find((other: number) => other !== cell && !PEERS[cell].includes(other)) : null;
    if (remaining === 2 && nextCell === undefined) throw new Error('No separated pair of nongiven cells found');
    run.cells = [...run.solution];
    run.cells[cell] = 0;
    if (nextCell !== null) run.cells[nextCell] = 0;
    run.stats.filled = 36 - remaining;
    run.stats.moves = 2; run.castCounter = 2;
    const report = previewAction(run, cell);
    if (report.path.length !== 1 || report.defeated) throw new Error('Late-sheet fixture must have one actual link and a surviving enemy');
    localStorage.setItem(key, JSON.stringify(save));
    return { cell, nextCell, before: run, defense: sheetShield(run), report };
  }, { key, remaining, ward });
  await resumed(page);
  return fixture;
}

test('shield acquired by one cast protects a later cast without new shield marks and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const fixture = await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, previewAction } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    const save = startRun(newSave(), 'fuse', 21);
    save.meta.tutorialDone = true;
    save.settings.reducedMotion = true;
    const run = save.run;
    for (const cell of singles(run.cells)) {
      const preview = previewAction(run, cell);
      if (preview.path.length !== 5) continue;
      run.marks.fill(null);
      const shieldCells = preview.path.slice(0, 3).map((event: { cell: number }) => event.cell);
      const weakCells = run.cells.flatMap((value: number, i: number) => !value && !shieldCells.includes(i) ? [i] : []).slice(0, 3);
      shieldCells.forEach((i: number) => { run.marks[i] = 'shield'; });
      weakCells.forEach((i: number) => { run.marks[i] = 'weak'; });
      const report = previewAction(run, cell);
      localStorage.setItem(key, JSON.stringify(save));
      return { cell, report };
    }
    throw new Error('No three-shield acquisition fixture found');
  }, key);
  await resumed(page);
  await expect(page.locator('.sheet-ward b')).toHaveText('0');
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await page.locator('[data-action="cast"]').click();
  await finished(page);
  await expect(page.locator('.sheet-ward b')).toHaveText('18');
  await expect(page.locator('.sheet-ward')).toContainText('シート内で継続');
  const carried = await saved(page);
  await resumed(page);
  expect(await saved(page)).toEqual(carried);
  await expect(page.locator('.sheet-ward b')).toHaveText('18');
  const next = await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const { previewAction } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    const run = JSON.parse(localStorage.getItem(key)!).run;
    const cell = singles(run.cells)[0];
    return { cell, report: previewAction(run, cell) };
  }, key);
  expect(next.report.path.every((event: { mark: string | null }) => event.mark !== 'shield')).toBe(true);
  expect(next.report.shield).toBe(18);
  expect(next.report.received).toBe(0);
  await page.locator(`[data-cell="${next.cell}"]`).click();
  await expect(page.locator('.prediction-detail')).toContainText('守護 18→18');
  await page.locator('[data-action="cast"]').click();
  await finished(page);
  const after = (await saved(page)).run!;
  expect(after.hp).toBe(carried.run!.hp);
  expect(after.lastReport).toEqual(next.report);
  await expect(page.locator('.sheet-ward b')).toHaveText('18');
  await page.screenshot({ path: '.runtime/screenshots/mobile-persistent-defense.png', fullPage: false });
});

test('level thirty, two separated final cells: accumulated ward protects a one-link heavy counter and resets only on the next sheet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const { cell, nextCell, before, defense, report } = await lateSheet(page, 2, true);
  expect(report.chain!.stopReason).toBe('no-target');
  expect(report.fullClear).toBe(false);
  expect(report.incoming).toBe(42);
  expect(report.shield).toBe(defense + 9);
  expect(report.received).toBe(0);
  await expect(page.locator('.sheet-ward b')).toHaveText(String(defense));
  const snapshot = await saved(page);
  await resumed(page);
  expect(await saved(page)).toEqual(snapshot);
  await expect(page.locator('.sheet-ward b')).toHaveText(String(defense));
  await page.locator(`[data-cell="${cell}"]`).click();
  await expect(page.locator('#prediction-chain')).toHaveText('1');
  await expect(page.locator('.prediction-detail')).toContainText(`守護 ${defense}→${report.shield}`);
  await page.screenshot({ path: '.runtime/screenshots/mobile-late-sheet-defense.png', fullPage: false });
  await page.locator('[data-action="cast"]').click();
  await phase(page, 'counter');
  await expect(page.locator('.combat-caption')).toContainText('完全防御');
  await finished(page);
  const oneLeft = (await saved(page)).run!;
  expect(oneLeft.cells.filter(value => !value)).toHaveLength(1);
  expect(oneLeft.hp).toBe(before.hp);
  expect(oneLeft.sheet).toBe(before.sheet);
  await expect(page.locator('.sheet-ward b')).toHaveText(String(report.shield));
  const lastReport: Report = await page.evaluate(async key => {
    const path = '/src/game/engine.ts';
    const { previewAction } = await import(/* @vite-ignore */ path);
    const run = JSON.parse(localStorage.getItem(key)!).run;
    return previewAction(run, run.cells.findIndex((value: number) => !value));
  }, key);
  expect(lastReport.fullClear).toBe(true);
  expect(lastReport.defeated).toBe(false);
  expect(lastReport.incoming).toBeGreaterThan(0);
  expect(lastReport.shield).toBe(report.shield + 9);
  await page.locator(`[data-cell="${nextCell}"]`).click();
  await page.locator('[data-action="cast"]').click();
  await phase(page, 'counter');
  await expect(page.locator('.sheet-ward b')).toHaveText(String(lastReport.shield));
  const committed = await saved(page);
  expect(committed.run!.lastReport).toEqual(lastReport);
  expect(committed.run!.sheet).toBe(before.sheet + 1);
  expect(committed.run!.spellLevel).toBe(31);
  expect(committed.run!.cells.filter(value => !value)).toHaveLength(36);
  await resumed(page);
  expect(await saved(page)).toEqual(committed);
  await expect(page.locator('.sheet-ward b')).toHaveText('0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('filling the entire sheet in one link still applies the enemy counter before growth and defense reset', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { cell, before, defense, report } = await lateSheet(page, 1, false);
  expect(defense).toBe(18);
  expect(report.path).toHaveLength(1);
  expect(report.fullClear).toBe(true);
  expect(report.defeated).toBe(false);
  expect(report.incoming).toBe(42);
  expect(report.shield).toBe(18);
  expect(report.received).toBe(24);
  await page.locator(`[data-cell="${cell}"]`).click();
  await expect(page.locator('.prediction-detail')).toContainText('守護 18→18');
  await page.locator('[data-action="cast"]').click();
  await phase(page, 'counter');
  await expect(page.locator('.combat-number')).toHaveText('−24');
  await expect(page.locator('.sheet-ward b')).toHaveText('18');
  await page.screenshot({ path: '.runtime/screenshots/desktop-full-sheet-counter.png', fullPage: false });
  await finished(page);
  const after = (await saved(page)).run!;
  expect(after.hp).toBe(before.hp - 24 + report.healed);
  expect(after.lastReport).toEqual(report);
  expect(after.sheet).toBe(before.sheet + 1);
  expect(after.spellLevel).toBe(before.spellLevel + 1);
  await expect(page.locator('.sheet-ward b')).toHaveText('0');
});

test('level forty fills all thirty-six original blanks in one legal cast, counters, and continues against the same enemy', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const fixture = await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const contentPath = '/src/game/content.ts';
    const { newSave, startRun, previewAction, sheetShield } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    const { enemyOf } = await import(/* @vite-ignore */ contentPath);
    for (let seed = 21; seed < 150; seed++) {
      const save = startRun(newSave(), 'fuse', seed);
      save.meta.tutorialDone = true;
      save.meta.clears = 15;
      const run = save.run;
      run.stage = 15; run.balanceVersion = 1;
      run.stats.kills = 15;
      run.spellLevel = 40;
      run.maxHp = 196;
      run.hp = 196;
      run.enemyHp = enemyOf(run.stage, run.balanceVersion).hp;
      run.sheet = 16;
      run.puzzleCursor = 15;
      run.inventory = ['ward'];
      for (const cell of singles(run.cells)) {
        const report = previewAction(run, cell);
        if (report.path.length !== 36 || !report.fullClear || report.defeated || !report.sheetAdvanced || report.shield !== 99) continue;
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report, before: run, defense: sheetShield(run) };
      }
    }
    throw new Error('No legal natural thirty-six-link full-sheet fixture found');
  }, key);
  expect(fixture.before.cells.filter((value: number) => !value)).toHaveLength(36);
  expect(fixture.defense).toBe(0);
  expect(fixture.report.incoming).toBe(126);
  expect(fixture.report.received).toBe(27);
  await resumed(page);
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await expect(page.locator('#prediction-chain')).toHaveText('36');
  await expect(page.locator('.prediction-detail')).toContainText('守護 0→99');
  const started = Date.now();
  await page.locator('[data-action="cast"]').click();
  // Check the chain while it is running. The final fill immediately starts the
  // per-sheet celebration, so checking this phase after 36 is a timing race.
  await phase(page, 'chain');
  await expect.poll(() => page.evaluate(() => document.querySelector('.combat-chain strong')?.textContent), { intervals: [20] }).toBe('36');
  await page.screenshot({ path: '.runtime/screenshots/desktop-thirtysix-chain.png', fullPage: false });
  await phase(page, 'counter');
  await expect(page.locator('.combat-number')).toHaveText('−27');
  await expect(page.locator('.sheet-ward b')).toHaveText('99');
  await finished(page);
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(5000);
  const after = (await saved(page)).run!;
  expect(after.lastReport).toEqual(fixture.report);
  expect(after.stage).toBe(fixture.before.stage);
  expect(after.enemyHp).toBe(fixture.before.enemyHp - fixture.report.damage);
  expect(after.hp).toBe(fixture.before.hp - 27 + fixture.report.healed);
  expect(after.sheet).toBe(fixture.before.sheet + 1);
  expect(after.stats.filled).toBe(36);
  expect(after.stats.bestChain).toBe(36);
  expect(after.stats.sheets).toBe(1);
  expect(after.cells.filter(value => !value)).toHaveLength(36);
  await expect(page.locator('.sheet-ward b')).toHaveText('0');
  console.info(`Natural thirty-six-link full-sheet cast: ${elapsed} ms; counter ${fixture.report.incoming} - defense ${fixture.report.shield} = ${fixture.report.received}`);
  expect(errors).toEqual([]);
});
