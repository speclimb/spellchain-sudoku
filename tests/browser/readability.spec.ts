import { expect, test, type Locator, type Page } from '@playwright/test';
import { savedGame, savedText } from './save-helpers';

const key = 'chain-incantation.save.v1';
test.use({ viewport: { width: 1920, height: 1080 } });

async function minimumFont(locator: Locator, size: number) {
  expect(await locator.count()).toBeGreaterThan(0);
  const smallest = await locator.evaluateAll(elements => Math.min(...elements.map(element => parseFloat(getComputedStyle(element).fontSize))));
  expect(smallest).toBeGreaterThanOrEqual(size);
}

async function noHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const bounds = dialog?.getBoundingClientRect();
    return { width: document.documentElement.scrollWidth, viewport: innerWidth,
      dialogWidth: dialog?.scrollWidth ?? 0, dialogClient: dialog?.clientWidth ?? 0,
      left: bounds?.left ?? 0, right: bounds?.right ?? innerWidth,
      top: bounds?.top ?? 0, bottom: bounds?.bottom ?? innerHeight, height: innerHeight };
  });
  expect(layout.width).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.dialogWidth).toBeLessThanOrEqual(layout.dialogClient + 1);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.height + 1);
}

async function firstViewport(page: Page) {
  await page.evaluate(() => scrollTo(0, 0));
  for (const selector of ['.board-surface', '[data-action="cast"]']) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1081);
  }
  const board = await page.locator('.board-surface').boundingBox();
  expect(board!.width).toBeGreaterThanOrEqual(590);
  await noHorizontalOverflow(page);
}

async function closeModal(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('Full HD uses readable default prose and keeps the full board and cast in the first viewport', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.hero-description')).toBeVisible();
  await minimumFont(page.locator('.hero-description'), 16);
  await minimumFont(page.locator('.character-info > span:last-child, .chosen-skill'), 14);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: '.runtime/screenshots/readability-fhd-title.png', fullPage: false });

  await page.getByRole('button', { name: /冒険をはじめる/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await expect(page.locator('#prediction-chain')).not.toHaveText('—');
  await minimumFont(page.locator('.tutorial p, .skill-description, .prediction-detail'), 16);
  await minimumFont(page.locator('.enemy-behavior, .prediction-numbers span, .prediction-card .section-label, .endless-track small'), 14);
  await firstViewport(page);
  await page.screenshot({ path: '.runtime/screenshots/readability-fhd-battle.png', fullPage: false });
  expect(errors).toEqual([]);
});

test('larger text changes immediately without replacing the focused checkbox and survives reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const largerText = page.getByLabel('文字を大きく');
  await expect(largerText).not.toBeChecked();
  const fontBefore = await page.locator('.hero-description').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(fontBefore).toBeGreaterThanOrEqual(16);
  const originalCheckbox = await largerText.elementHandle();
  await largerText.focus();
  await largerText.check();
  await expect(largerText).toBeEnabled();
  await expect(largerText).toBeChecked();
  await expect(largerText).toBeFocused();
  expect(await originalCheckbox!.evaluate(element => element.isConnected)).toBe(true);
  await expect.poll(() => page.locator('.hero-description').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(fontBefore);
  await minimumFont(page.locator('.hero-description, .settings-list small'), 18);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: '.runtime/screenshots/readability-large-settings.png', fullPage: false });
  expect((await savedGame(page)).settings.largeText).toBe(true);

  await page.reload();
  await minimumFont(page.locator('.hero-description'), 18);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(largerText).toBeChecked();
  await closeModal(page);
  await page.getByRole('button', { name: /冒険をはじめる/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await minimumFont(page.locator('.tutorial p, .skill-description, .prediction-detail'), 18);
  await firstViewport(page);
  await page.screenshot({ path: '.runtime/screenshots/readability-large-battle.png', fullPage: false });
});

test('Full HD help and codex remain readable and fit their dialogs with larger text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('文字を大きく').check();
  await savedText(page);
  await closeModal(page);

  await page.locator('.hero-actions').getByRole('button', { name: '遊び方', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'かんたんな遊び方' })).toBeVisible();
  await minimumFont(page.locator('.help-steps p'), 18);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: '.runtime/screenshots/readability-large-help.png', fullPage: false });
  await page.getByRole('button', { name: '詳しいルール' }).click();
  await minimumFont(page.locator('.help-steps p, .help-note'), 18);
  await noHorizontalOverflow(page);
  await closeModal(page);

  await page.getByRole('button', { name: '遺物図鑑', exact: true }).click();
  await expect(page.locator('.codex-item')).toHaveCount(16);
  await minimumFont(page.locator('.codex-item p'), 18);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: '.runtime/screenshots/readability-large-codex.png', fullPage: false });
  await closeModal(page);
});

test('legacy saves retain the pending reward while reward reports and expanded history use readable text', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async key => {
    const enginePath = '/src/game/engine.ts', sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ enginePath);
    const { singles } = await import(/* @vite-ignore */ sudokuPath);
    let save = startRun(newSave(), 'fuse', 413);
    save.settings.reducedMotion = true;
    save.meta.tutorialDone = true;
    delete save.settings.largeText;
    for (let battle = 0; battle < 5; battle++) {
      save.run.enemyHp = 1;
      save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
      if (battle < 4) while (save.run.phase === 'reward') save = dispatch(save, { type: 'reward', relic: save.run.rewards[0], revision: save.run.revision });
    }
    localStorage.setItem(key, JSON.stringify(save));
    return { id: save.run.id, revision: save.run.revision, rewards: save.run.rewards };
  }, key);
  await page.reload();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByLabel('文字を大きく')).not.toBeChecked();
  await closeModal(page);
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toBeVisible();
  await minimumFont(page.locator('.reward-card > p, .modal-intro'), 16);
  await minimumFont(page.locator('.report-sample, .report-caution, .report-highlights small'), 14);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: '.runtime/screenshots/readability-fhd-reward.png', fullPage: false, animations: 'disabled' });
  await page.locator('[data-action="history-report"]').click();
  await expect(page.getByRole('dialog', { name: 'プレイ履歴', exact: true })).toBeVisible();
  await minimumFont(page.locator('.history-scope, .history-battle-stats, .history-toolbar label'), 14);
  await page.locator('.history-battle > summary').first().click();
  await expect(page.locator('.history-battle-content .history-metrics').first()).toBeVisible();
  await minimumFont(page.locator('.history-battle-content .history-metrics').first(), 14);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: '.runtime/screenshots/readability-fhd-history.png', fullPage: false, animations: 'disabled' });
  const restored = await savedGame(page);
  expect(restored.run!.id).toBe(fixture.id);
  expect(restored.run!.revision).toBe(fixture.revision);
  expect(restored.run!.rewards).toEqual(fixture.rewards);
});
