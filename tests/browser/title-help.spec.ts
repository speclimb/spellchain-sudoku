import { expect, test, type Page } from '@playwright/test';

const key = 'chain-incantation.save.v1';
const saved = (page: Page) => page.evaluate(key => localStorage.getItem(key), key);
const helpButton = (page: Page) => page.locator('.hero-actions').getByRole('button', { name: '遊び方', exact: true });
const helpDialog = (page: Page) => page.getByRole('dialog', { name: '遊び方', exact: true });

async function expectNoOverflow(page: Page) {
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const bounds = dialog.getBoundingClientRect();
    return { pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
      dialogWidth: dialog.scrollWidth, dialogClientWidth: dialog.clientWidth,
      left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, viewportHeight: innerHeight };
  });
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.dialogWidth).toBeLessThanOrEqual(layout.dialogClientWidth + 1);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
}

test('first title help is read-only, keyboard accessible and returns focus before starting', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const before = await saved(page);
  expect(before).toBeNull();
  await expect(helpButton(page)).toBeVisible();
  await expect(helpButton(page)).toHaveAttribute('aria-haspopup', 'dialog');
  await page.screenshot({ path: '.runtime/screenshots/desktop-title-help-button.png', fullPage: true });
  await helpButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(helpDialog(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'かんたんな遊び方' })).toBeVisible();
  await expect(helpDialog(page).locator('.help-steps > li')).toHaveCount(5);
  await expect(helpDialog(page)).toContainText('魔力8か無料券');
  await expect(helpDialog(page)).toContainText('同じ行・列・3×3区画');
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
  await expect(helpDialog(page).getByRole('button', { name: '閉じる', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(helpDialog(page).getByRole('button', { name: 'タイトルへ戻る' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(helpDialog(page).getByRole('button', { name: '閉じる', exact: true })).toBeFocused();
  await expectNoOverflow(page);
  await page.screenshot({ path: '.runtime/screenshots/desktop-title-help.png', fullPage: true });
  expect(await saved(page)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(helpDialog(page)).toHaveCount(0);
  await expect(helpButton(page)).toBeFocused();
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert', '');
  await expect(page.locator('canvas')).toHaveCount(0);

  // Repeated opening, clicking the content, background dismissal and the footer
  // must never begin a run or mark the first-run tutorial complete.
  for (const dismissal of ['close', 'backdrop', 'footer']) {
    await helpButton(page).click();
    await helpDialog(page).getByRole('heading').click();
    await expect(helpDialog(page)).toBeVisible();
    if (dismissal === 'backdrop') await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } });
    else await helpDialog(page).getByRole('button', { name: dismissal === 'close' ? '閉じる' : 'タイトルへ戻る', exact: true }).click();
    await expect(helpDialog(page)).toHaveCount(0);
    await expect(helpButton(page)).toBeFocused();
    expect(await saved(page)).toBe(before);
  }
  await page.getByRole('button', { name: /冒険をはじめる/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const run = JSON.parse((await saved(page))!);
  expect(run.run.stats.moves).toBe(0);
  expect(run.meta.tutorialDone).toBe(false);
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await expect(page.locator('#prediction-chain')).not.toHaveText('—');
  expect(errors).toEqual([]);
});

test('saved title help preserves the complete save and chosen character, then resumes normally', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts';
    const { newSave, startRun } = await import(/* @vite-ignore */ enginePath);
    const save = newSave();
    save.meta.clears = 20; save.meta.bestScore = 12345;
    save.settings.sound = false; save.settings.reducedMotion = true;
    localStorage.setItem(key, JSON.stringify(startRun(save, 'fuse', 421)));
  }, key);
  await page.reload();
  const before = await saved(page);
  const otherCharacter = page.locator('[data-character]:not([disabled])').nth(1);
  await otherCharacter.click();
  const chosen = await otherCharacter.getAttribute('data-character');
  await helpButton(page).click();
  await helpDialog(page).getByRole('button', { name: 'タイトルへ戻る' }).click();
  expect(await saved(page)).toBe(before);
  await expect(page.locator(`[data-character="${chosen}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /冒険の続きへ/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '新たな冒険をはじめる' })).toBeVisible();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  expect(await saved(page)).toBe(before);
});

test('optional detailed rules remain available and dismiss to the title help button', async ({ page }) => {
  await page.goto('/');
  const before = await saved(page);
  await helpButton(page).click();
  await helpDialog(page).getByRole('button', { name: '詳しいルール' }).click();
  await expect(helpDialog(page).getByRole('heading', { name: '数字をつなぎ、魔法を紡ぐ。' })).toBeVisible();
  await expect(helpDialog(page).getByRole('button', { name: '閉じる', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(helpButton(page)).toBeFocused();
  expect(await saved(page)).toBe(before);
  // The original header help remains the full reference, including in battle.
  await page.locator('.site-header [data-action="help"]').click();
  await expect(helpDialog(page).getByRole('heading', { name: '数字をつなぎ、魔法を紡ぐ。' })).toBeVisible();
  await helpDialog(page).getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.site-header [data-action="help"]')).toBeFocused();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`title help fits ${viewport.width}x${viewport.height} and can close after scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const before = await saved(page);
    if (viewport.height >= 568) await expect(helpButton(page)).toBeInViewport();
    else await expect(helpButton(page)).toBeVisible();
    if (viewport.width === 390) await page.screenshot({ path: '.runtime/screenshots/mobile-title-help-button.png', fullPage: true });
    await helpButton(page).click();
    await expectNoOverflow(page);
    if (viewport.width === 390) await page.screenshot({ path: '.runtime/screenshots/mobile-title-help.png' });
    const back = helpDialog(page).getByRole('button', { name: 'タイトルへ戻る' });
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeInViewport();
    if (viewport.width === 320) await page.screenshot({ path: '.runtime/screenshots/small-mobile-title-help-bottom.png' });
    await back.click();
    await expect(helpDialog(page)).toHaveCount(0);
    await expect(helpButton(page)).toBeFocused();
    expect(await saved(page)).toBe(before);
    await helpButton(page).click();
    await expect(helpDialog(page).getByRole('heading')).toBeInViewport();
    await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } });
    await expect(helpDialog(page)).toHaveCount(0);
    expect(await saved(page)).toBe(before);
  });
}
