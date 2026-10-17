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

for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
  test(`${viewport.width}px: cast follows HP/mana in visual and Tab order and stays reachable while scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await prepare(page, { expanded: true });
    const cast = page.locator('[data-action="cast"]');
    const controls = page.locator('.cast-controls');
    await expect(controls).toHaveCount(1);
    await expect(controls).toHaveCSS('position', 'sticky');
    await expect(controls).toHaveCSS('order', '0');
    expect(await controls.evaluate(element => element.previousElementSibling?.className)).toBe('vitals');

    await page.evaluate(() => scrollTo(0, 0));
    const initial = (await cast.boundingBox())!;
    const vitals = (await page.locator('.vitals').boundingBox())!;
    const heading = await page.locator('.player-heading').boundingBox();
    const board = (await page.locator('.board-surface').boundingBox())!;
    if (viewport.width > 760) {
      expect(heading).not.toBeNull();
      expect(heading!.y + heading!.height).toBeLessThanOrEqual(vitals.y);
    } else await expect(page.locator('.player-heading')).toBeHidden();
    expect(initial.y - (vitals.y + vitals.height)).toBeGreaterThanOrEqual(0);
    expect(initial.y - (vitals.y + vitals.height)).toBeLessThanOrEqual(18);
    expect(initial.height).toBeGreaterThanOrEqual(44);
    expect(initial.x).toBeGreaterThanOrEqual(0);
    expect(initial.x + initial.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.width <= 760) expect(initial.y).toBeGreaterThanOrEqual(board.y + board.height);
    else expect(initial.x).toBeGreaterThanOrEqual(board.x + board.width);
    const samePosition = async () => {
      await page.evaluate(() => scrollTo(0, 0));
      const bounds = (await cast.boundingBox())!;
      const dimensions = viewport.width <= 760 ? ['x', 'width', 'height'] as const : ['x', 'y', 'width', 'height'] as const;
      for (const dimension of dimensions) {
        expect(Math.abs(bounds[dimension] - initial[dimension])).toBeLessThanOrEqual(1);
      }
      // The phone guide belongs below the board, above the entire panel, so
      // opening it can move the panel without separating cast from HP/mana.
      const currentVitals = (await page.locator('.vitals').boundingBox())!;
      expect(bounds.y - (currentVitals.y + currentVitals.height)).toBeGreaterThanOrEqual(0);
      expect(bounds.y - (currentVitals.y + currentVitals.height)).toBeLessThanOrEqual(18);
      expect(await controls.evaluate(element => element.previousElementSibling?.className)).toBe('vitals');
      for (const selector of ['.prediction-card', '.skill-picker', '[data-action="skill"]']) {
        const following = (await page.locator(selector).boundingBox())!;
        expect(following.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
      }
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
    await expect(cast).toBeEnabled();

    // Focus order follows the same HP/mana → cast → autoplay → forecast → skill layout.
    if (viewport.width > 760) await page.locator('.player-heading [data-action="home"]').focus();
    else await page.locator(`[data-cell="${fixture.cell}"]`).focus();
    await page.keyboard.press('Tab'); await expect(cast).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.locator('[data-action="autoplay"]')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.locator('[data-action="chain-guide"]')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(page.locator('[data-action="autoplay"]')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(cast).toBeFocused();
    await samePosition();
    await page.screenshot({ path: `.runtime/screenshots/cast-below-vitals-${viewport.width}.png`, fullPage: true });

    // Exercise expanded combat details at mid-panel and near-bottom positions.
    // Compact phone panels may reach the document end before the rail pins.
    await page.locator('.prediction-breakdown').evaluate(element => { (element as HTMLDetailsElement).open = true; });
    await page.locator('.inventory').evaluate(element => { (element as HTMLDetailsElement).open = true; });
    const before = await savedText(page);
    const stickyTop = viewport.width <= 760 ? 8 : 12;
    const naturalCastY = await cast.evaluate(element => element.getBoundingClientRect().top + scrollY);
    const assertReachable = async () => {
      const box = (await cast.boundingBox())!;
      const actualScrollY = await page.evaluate(() => scrollY);
      const expectedY = Math.max(stickyTop, naturalCastY - actualScrollY);
      expect(box.y).toBeGreaterThanOrEqual(expectedY - 1);
      expect(box.y).toBeLessThanOrEqual(expectedY + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(await cast.evaluate(element => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })).toBe(true);
    };
    await page.evaluate(top => scrollTo(0, top), initial.y + 160);
    await assertReachable();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight - innerHeight - 10));
    await assertReachable();

    // Scroll-to and keyboard navigation must leave the following controls
    // below the opaque rail, with their complete touch targets unobscured.
    for (const selector of ['.prediction-card', '.prediction-breakdown summary', '[data-select-skill="bridge"]', '[data-action="skill"]', '.inventory summary']) {
      const target = page.locator(selector);
      await target.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const box = (await target.boundingBox())!;
      const action = (await cast.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(action.y + action.height + 4);
      expect(box.y).toBeLessThan(viewport.height);
      if (selector !== '.prediction-card') {
        await target.focus();
        expect(await target.evaluate(element => {
          const r = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        })).toBe(true);
      }
    }
    await page.locator('[data-select-skill="bastion"]').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-action="skill"]')).toBeFocused();
    const skill = (await page.locator('[data-action="skill"]').boundingBox())!;
    const pinned = (await cast.boundingBox())!;
    expect(skill.y).toBeGreaterThanOrEqual(pinned.y + pinned.height + 4);
    await page.screenshot({ path: `.runtime/screenshots/cast-sticky-${viewport.width}.png`, fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await savedText(page)).toBe(before);
  });
}

for (const height of [600, 320]) {
  test(`1440x${height}: ordinary collapsed panel keeps cast visible through desktop scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height });
    await page.goto('/');
    await page.getByRole('button', { name: /冒険をはじめる/ }).click();
    await expect(page.locator('canvas')).toBeVisible();
    await page.locator('[data-cell][aria-disabled="false"]').first().click();

    const panel = page.locator('.command-panel');
    const cast = panel.locator('[data-action="cast"]');
    await expect(cast).toBeEnabled();
    await expect(panel.locator('.cast-controls')).toHaveCount(1);
    // Use normal controls only: no fixture inventory, extra skills, open
    // prediction breakdowns, spacers, or injected page height.
    for (const details of await panel.locator('details').all()) {
      if (await details.getAttribute('open') === null) continue;
      await details.locator(':scope > summary').click();
      await expect(details).not.toHaveAttribute('open', '');
    }
    const before = await savedText(page);
    const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(maxScroll).toBeGreaterThan(0);

    for (const position of ['middle', 'bottom'] as const) {
      await page.evaluate(({ maxScroll, position }) => {
        scrollTo({ top: position === 'middle' ? maxScroll / 2 : maxScroll, behavior: 'instant' });
      }, { maxScroll, position });
      await expect.poll(async () => page.evaluate(() => scrollY)).toBeCloseTo(position === 'middle' ? Math.round(maxScroll / 2) : maxScroll, 0);
      const bounds = (await cast.boundingBox())!;
      expect(bounds, `${position}: cast bounds exist`).not.toBeNull();
      expect(bounds.x, `${position}: left edge`).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width, `${position}: right edge`).toBeLessThanOrEqual(1440);
      expect(bounds.y, `${position}: top edge`).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height, `${position}: bottom edge`).toBeLessThanOrEqual(height);
      expect(await cast.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return [[0.5, 0.5], [0.1, 0.5], [0.9, 0.5]].every(([x, y]) =>
          element.contains(document.elementFromPoint(rect.x + rect.width * x, rect.y + rect.height * y)));
      }), `${position}: cast center and side targets are unobscured`).toBe(true);
      await page.screenshot({ path: `.runtime/screenshots/cast-collapsed-1440x${height}-${position}.png` });
    }
    expect(await savedText(page)).toBe(before);
  });
}
