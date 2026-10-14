import { savedText } from './save-helpers';
import { expect, test, type Page } from '@playwright/test';
import type { Report } from '../../src/game/types';

const key = 'chain-incantation.save.v1';

/** Each Playwright context has its own storage; this never changes the player's save. */
async function prepareGuide(page: Page, skill = false): Promise<{ cell: number; report: Report }> {
  await page.goto('/');
  const fixture = await page.evaluate(async ({ key, skill }) => {
    const enginePath = '/src/game/engine.ts';
    const sudokuPath = '/src/game/sudoku.ts';
    const { newSave, startRun, previewAction } = await import(/* @vite-ignore */ enginePath);
    const { candidates } = await import(/* @vite-ignore */ sudokuPath);
    for (let seed = 21; seed < 80; seed++) {
      const save = startRun(newSave(), 'fuse', seed);
      save.meta.tutorialDone = true;
      save.settings.reducedMotion = true;
      if (skill) save.run.mana = 8;
      for (let cell = 0; cell < 81; cell++) {
        if (save.run.cells[cell] || (!skill && candidates(save.run.cells, cell).length !== 1)) continue;
        const report = previewAction(save.run, cell, skill);
        if (report.path.length !== (skill ? 9 : 5) || report.chain?.stopReason !== 'limit') continue;
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report };
      }
    }
    throw new Error('No full-length fuse preview fixture found');
  }, { key, skill });
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  if (skill) await page.locator('[data-action="skill"]').click();
  await page.locator(`[data-cell="${fixture.cell}"]`).click();
  await expect(page.locator('#prediction-chain')).toHaveText(String(fixture.report.path.length));
  return fixture;
}

async function saved(page: Page) {
  return savedText(page, key);
}

test('desktop: inspect every chain step and stop without spending a turn, then cast the same prediction', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  const { cell, report } = await prepareGuide(page);
  const before = await saved(page);
  const toggle = page.locator('[data-action="chain-guide"]');
  const surface = page.locator('.board-surface');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.chain-stop')).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#chain-guide')).toBeVisible();
  await expect(page.locator('[data-action="chain-prev"]')).toBeDisabled();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  for (const selector of ['#chain-step-title', '[data-action="chain-next"]']) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
  }
  for (let index = 0; index < report.path.length; index++) {
    await expect(surface).toHaveAttribute('data-inspect-step', String(index));
    await expect(page.locator('.chain-position')).toHaveText(new RegExp(`${index + 1}\\s*/\\s*${report.path.length}`));
    await expect(page.locator('#chain-step-title')).not.toBeEmpty();
    await expect(page.locator('#chain-step-detail')).not.toBeEmpty();
    await expect(page.locator('#chain-budget')).toContainText(String(report.chain!.steps[index].remainingAfter));
    await expect(page.locator(`[data-cell="${cell}"]`)).toHaveAttribute('aria-selected', 'true');
    expect(await saved(page)).toBe(before);
    if (index === 1) {
      await expect(page.locator('#chain-step-title')).toContainText(/行|列|区画/);
      await page.screenshot({ path: '.runtime/screenshots/desktop-chain-guide.png', fullPage: false });
    }
    if (index === report.path.length - 1) {
      await page.locator('[data-action="chain-next"]').focus();
      await page.keyboard.press('Enter');
    } else {
      await page.locator('[data-action="chain-next"]').click();
    }
  }
  await expect(surface).toHaveAttribute('data-inspect-step', String(report.path.length));
  await expect(page.locator('.chain-position')).toHaveText('連鎖終了');
  await expect(page.locator('[data-action="chain-next"]')).toBeDisabled();
  await expect(page.locator('[data-action="chain-prev"]')).toBeFocused();
  await expect(page.locator('#chain-step-detail')).toContainText(/使い切|上限|0回/);
  expect(await saved(page)).toBe(before);
  for (let index = report.path.length - 1; index >= 0; index--) {
    await page.keyboard.press('Enter');
    await expect(surface).toHaveAttribute('data-inspect-step', String(index));
    await expect(page.locator(`[data-action="${index === 0 ? 'chain-next' : 'chain-prev'}"]`)).toBeFocused();
  }
  await page.locator('[data-action="chain-close"]').focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await expect(page.locator('#chain-guide')).toHaveCount(0);
  expect(await surface.getAttribute('data-inspect-step')).toBeFalsy();
  await expect(page.locator('#prediction-damage')).toHaveText(report.damage.toLocaleString('ja-JP'));
  expect(await saved(page)).toBe(before);
  await page.locator('[data-action="cast"]').click();
  await expect.poll(() => savedText(page, key).then(raw => JSON.parse(raw!).run.stats.moves)).toBe(1);
  await expect(page.locator('[data-action="cast"]')).not.toHaveText('詠唱中…');
  const actual = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run.lastReport, key);
  expect(actual).toEqual(report);
  expect(errors).toEqual([]);
});

test('mobile: chain guide keeps the board readable and step controls reachable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { cell } = await prepareGuide(page);
  const before = await saved(page);
  await page.locator('[data-action="chain-guide"]').click();
  await page.locator('[data-action="chain-next"]').click();
  await expect(page.locator('.board-surface')).toHaveAttribute('data-inspect-step', '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const board = await page.locator('.board-surface').boundingBox();
  expect(board!.width).toBeGreaterThan(340);
  const target = await page.locator(`[data-cell="${cell}"]`).boundingBox();
  expect(target!.width).toBeGreaterThan(35);
  for (const action of ['chain-prev', 'chain-next']) {
    const button = page.locator(`[data-action="${action}"]`);
    await button.scrollIntoViewIfNeeded();
    const bounds = await button.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(40);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: '.runtime/screenshots/mobile-chain-guide.png', fullPage: true });
  await page.locator('[data-action="chain-prev"]').click();
  await expect(page.locator('.chain-position')).toHaveText(/1\s*\/\s*5/);
  expect(await saved(page)).toBe(before);
});

test('fuse skill: explains eight automatic fills and nine total links before mana is consumed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const { report } = await prepareGuide(page, true);
  expect(report.path).toHaveLength(9);
  expect(report.chain!.initialAuto).toBe(8);
  const before = await saved(page);
  await page.locator('[data-action="chain-guide"]').click();
  await expect(page.locator('.chain-position')).toHaveText(/1\s*\/\s*9/);
  await expect(page.locator('#chain-budget')).toContainText('8');
  await expect(page.locator('#chain-step-title')).toContainText(/スキル|起点/);
  for (let index = 0; index < report.path.length; index++) await page.locator('[data-action="chain-next"]').click();
  await expect(page.locator('.chain-position')).toHaveText('連鎖終了');
  expect(await saved(page)).toBe(before);
  await page.locator('[data-action="cast"]').click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run.mana, key)).toBe(0);
  const actual = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run.lastReport, key);
  expect(actual).toEqual(report);
  expect(actual.charge).toBe(0);
});
