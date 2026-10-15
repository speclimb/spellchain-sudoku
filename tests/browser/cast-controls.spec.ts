import { expect, test, type Page } from '@playwright/test';
import { savedGame, savedText } from './save-helpers';
import type { Report } from '../../src/game/types';

const key = 'chain-incantation.save.v1';

/** Browser contexts are isolated; fixtures never touch the open player's save. */
async function prepare(page: Page, options: { skill?: boolean; reducedMotion?: boolean; expanded?: boolean } = {}): Promise<{ cell: number; report: Report }> {
  await page.goto('/');
  const fixture = await page.evaluate(async ({ key, options }) => {
    const path = '/src/game/engine.ts';
    const { newSave, startRun, legalOrigins, previewAction } = await import(/* @vite-ignore */ path);
    for (let seed = 21; seed < 80; seed++) {
      const save = startRun(newSave(), 'fuse', seed), run = save.run;
      save.meta.tutorialDone = true;
      save.settings.sound = false;
      save.settings.reducedMotion = options.reducedMotion ?? true;
      run.mana = 8;
      if (options.expanded) {
        run.skillLevels = { ...run.skillLevels, bridge: 1, bastion: 1 };
        run.equippedSkills = ['bridge', 'bastion'];
        run.inventory = ['trinity'];
      }
      for (const cell of legalOrigins(run, !!options.skill)) {
        const report = previewAction(run, cell, !!options.skill);
        if (report.path.length < 3 || report.defeated || report.fullClear) continue;
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report };
      }
    }
    throw new Error('No stable cast shortcut fixture found');
  }, { key, options });
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  return fixture;
}

async function finished(page: Page): Promise<void> {
  await expect(page.locator('[data-action="cast"]')).not.toContainText('詠唱中');
  await expect(page.locator('.combat-effects, .completion-cutin')).toHaveCount(0);
}

for (const skill of [false, true]) {
  test(`${skill ? 'selected skill' : 'normal'}: C casts the shown prediction once and ignores another press during animation`, async ({ page }) => {
    await page.setViewportSize({ width: 1108, height: 1052 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const fixture = await prepare(page, { skill, reducedMotion: false });
    if (skill) await page.locator('[data-action="skill"]').click();
    await page.locator(`[data-cell="${fixture.cell}"]`).click();
    const cast = page.locator('[data-action="cast"]');
    await expect(cast).toHaveAttribute('aria-keyshortcuts', 'C');
    await expect(cast.locator('kbd')).toHaveText('C');
    await expect(cast).toBeEnabled();
    await page.keyboard.down('c');
    await expect(cast).toBeDisabled();
    await expect(cast).toContainText('詠唱中');
    await page.keyboard.down('c');
    await page.keyboard.up('c');
    // A new, non-repeated keydown must also be harmless while the cast runs.
    await page.keyboard.press('c');
    const committed = (await savedGame(page)).run!;
    expect(committed.stats.moves).toBe(1);
    expect(committed.castCounter).toBe(1);
    expect(committed.lastReport).toEqual(fixture.report);
    if (skill) { expect(committed.stats.skills).toBe(1); expect(committed.mana).toBe(0); }
    await page.locator('[data-action="skip-animation"]').click();
    await finished(page);
    // The full redraw can leave focus on the document body; C still must not
    // replay the old prediction after its selection has been cleared.
    await page.keyboard.press('c');
    expect((await savedGame(page)).run!.castCounter).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('C ignores missing selection, dialogs, modifiers, repeated keys, composition and editable fields', async ({ page }) => {
  const fixture = await prepare(page);
  const before = await savedText(page);
  await page.keyboard.press('c');
  expect(await savedText(page)).toBe(before);
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  for (const combination of ['Control+c', 'Alt+c', 'Meta+c', 'Shift+c']) await page.keyboard.press(combination);
  await page.evaluate(() => {
    const target = document.activeElement!;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true, repeat: true }));
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true, isComposing: true }));
  });
  expect(await savedText(page)).toBe(before);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
  expect(await savedText(page)).toBe(before);
  await page.keyboard.press('Escape');
  for (const markup of ['<input>', '<textarea></textarea>', '<select><option>c</option></select>', '<div contenteditable="true"><span>入力中</span></div>']) {
    await page.evaluate(markup => {
      const fixture = document.createElement('div'); fixture.dataset.shortcutEditable = '';
      fixture.innerHTML = markup; document.querySelector('.command-panel')!.append(fixture);
      const editable = fixture.firstElementChild as HTMLElement;
      editable.focus();
      // Dispatch from the nested text's element to catch contenteditable ancestors.
      (editable.firstElementChild ?? editable).dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true }));
    }, markup);
    expect(await savedText(page)).toBe(before);
    await page.locator('[data-shortcut-editable]').evaluate(element => element.remove());
  }
  // Ordinary native Enter continues to select a board origin before C commits.
  await page.locator(`[data-cell="${fixture.cell}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-cell="${fixture.cell}"]`)).toHaveAttribute('aria-selected', 'true');
  expect(await savedText(page)).toBe(before);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(page.locator('body')).toBeFocused();
  await page.keyboard.press('c');
  await finished(page);
  expect((await savedGame(page)).run!.castCounter).toBe(1);
});

test('desktop: cast button stays in the same top-right position through skill, prediction and guide changes', async ({ page }) => {
  await page.setViewportSize({ width: 1108, height: 1052 });
  const fixture = await prepare(page, { expanded: true });
  const cast = page.locator('[data-action="cast"]');
  const initial = await cast.boundingBox();
  expect(initial).not.toBeNull();
  expect(initial!.x).toBeGreaterThan(550);
  const heading = await page.locator('.player-heading').boundingBox();
  expect(initial!.y + initial!.height).toBeLessThanOrEqual(heading!.y);
  const samePosition = async () => {
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    const bounds = await cast.boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.x - initial!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds!.y - initial!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds!.width - initial!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds!.height - initial!.height)).toBeLessThanOrEqual(1);
  };
  await page.locator(`[data-cell="${fixture.cell}"]`).click(); await samePosition();
  await page.locator('.prediction-breakdown summary').click(); await samePosition();
  await page.locator('[data-action="chain-guide"]').click(); await samePosition();
  await page.locator('[data-action="chain-next"]').click(); await samePosition();
  await page.locator('[data-action="chain-close"]').click();
  await page.locator('[data-action="skill"]').click(); await samePosition();
  await page.locator(`[data-cell="${fixture.cell}"]`).click(); await samePosition();
  await page.locator('[data-select-skill="bridge"]').click(); await samePosition();
  await page.locator(`[data-cell="${fixture.cell}"]`).click(); await samePosition();
  await page.screenshot({ path: '.runtime/screenshots/desktop-cast-controls.png', fullPage: false });
  await page.evaluate(() => window.scrollTo({ top: 300 }));
  const sticky = await cast.boundingBox();
  expect(sticky!.y).toBeGreaterThanOrEqual(0);
  expect(sticky!.y).toBeLessThan(initial!.y);
  expect(sticky!.y + sticky!.height).toBeLessThanOrEqual(1052);
});

test('mobile: cast controls lead the command panel without overflow or covering the board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await prepare(page, { expanded: true });
  await page.locator('[data-action="skill"]').click();
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await expect(page.locator('[data-action="cast"]')).toBeEnabled();
  const cast = await page.locator('[data-action="cast"]').boundingBox();
  const board = await page.locator('.board-surface').boundingBox();
  const vitals = await page.locator('.vitals').boundingBox();
  expect(cast!.y).toBeGreaterThanOrEqual(board!.y + board!.height);
  expect(cast!.y + cast!.height).toBeLessThanOrEqual(vitals!.y);
  expect(cast!.height).toBeGreaterThanOrEqual(44);
  expect(cast!.x).toBeGreaterThanOrEqual(0);
  expect(cast!.x + cast!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/mobile-cast-controls.png', fullPage: true });
});
