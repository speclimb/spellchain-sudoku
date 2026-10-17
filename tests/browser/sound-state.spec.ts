import { expect, test, type Page } from '@playwright/test';
import { savedGame } from './save-helpers';

async function expectSoundState(page: Page, enabled: boolean) {
  const button = page.locator('[data-action="sound"]');
  const state = enabled ? '音あり' : '音なし';
  const action = enabled ? '消音する' : '音をオンにする';
  // The accessible name starts with the visible current state for voice
  // control and adds the action. The tooltip describes the action alone.
  await expect(button).toHaveText(state);
  await expect(button.locator('.sound-state-label')).toBeVisible();
  await expect(button).toHaveAccessibleName(`${state}：${action}`);
  await expect(button).toHaveAttribute('title', action);
  await expect(button).toBeEnabled();
  const layout = await button.evaluate(element => {
    const button = element.getBoundingClientRect();
    const label = element.querySelector('.sound-state-label')!.getBoundingClientRect();
    const nav = element.closest('nav')!.getBoundingClientRect();
    const brand = document.querySelector('.brand')!.getBoundingClientRect();
    return {
      textFits: label.left >= button.left && label.right <= button.right
        && label.top >= button.top && label.bottom <= button.bottom,
      headerFits: nav.left >= brand.right && nav.right <= innerWidth,
      contentFits: element.scrollWidth <= element.clientWidth,
      fontSize: parseFloat(getComputedStyle(element).fontSize),
    };
  });
  expect(layout.textFits).toBe(true);
  expect(layout.headerFits).toBe(true);
  expect(layout.contentFits).toBe(true);
  expect(layout.fontSize).toBeGreaterThanOrEqual(12);
}

for (const width of [320, 390, 1440]) {
  test.describe(`Explicit sound state at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });

    test('starts muted and keeps current-state words in sync through toggles, rerenders and reloads', async ({ page }) => {
      const audioRequests: string[] = [];
      page.on('request', request => {
        if (/\.mp3(?:[?#]|$)/.test(request.url())) audioRequests.push(request.url());
      });
      await page.goto('/');
      await expectSoundState(page, false);
      expect((await savedGame(page)).settings.sound).toBe(false);
      expect(audioRequests).toHaveLength(0);

      await page.getByRole('button', { name: '音なし：音をオンにする', exact: true }).click();
      await expectSoundState(page, true);
      expect((await savedGame(page)).settings.sound).toBe(true);
      await page.reload();
      await expectSoundState(page, true);

      await page.locator('[data-action="help"]').click();
      await page.getByRole('button', { name: '閉じる', exact: true }).click();
      await expectSoundState(page, true);
      const sound = page.getByRole('button', { name: '音あり：消音する', exact: true });
      await sound.focus();
      await sound.press('Enter');
      await expectSoundState(page, false);
      await expect(page.locator('[data-action="sound"]')).toBeFocused();
      expect((await savedGame(page)).settings.sound).toBe(false);
      await page.reload();
      await expectSoundState(page, false);
    });

    test('settings and the header show the same persisted state, including with large text', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: '設定', exact: true }).click();
      const setting = page.locator('[data-setting="sound"]');
      await expect(setting).not.toBeChecked();
      await setting.check();
      expect((await savedGame(page)).settings.sound).toBe(true);
      await page.getByRole('button', { name: '閉じる', exact: true }).click();
      await expectSoundState(page, true);
      await page.reload();
      await expectSoundState(page, true);

      await page.getByRole('button', { name: '設定', exact: true }).click();
      await expect(setting).toBeChecked();
      await page.locator('[data-setting="largeText"]').check();
      await expect(setting).toBeEnabled();
      await setting.uncheck();
      expect((await savedGame(page)).settings.sound).toBe(false);
      await page.getByRole('button', { name: '閉じる', exact: true }).click();
      await expectSoundState(page, false);
      await page.reload();
      await expectSoundState(page, false);
      await page.getByRole('button', { name: '設定', exact: true }).click();
      await expect(setting).not.toBeChecked();
      await expect(page.locator('[data-setting="largeText"]')).toBeChecked();
    });
  });
}
