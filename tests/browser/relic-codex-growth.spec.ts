import { expect, test } from '@playwright/test';
import { savedText } from './save-helpers';

for (const viewport of [{ name: 'desktop', width: 1440, height: 1080 }, { name: 'mobile', width: 390, height: 844 }, { name: 'narrow', width: 320, height: 740 }]) {
  test(`${viewport.name}: catalog growth expands, changes tier and closes without changing save`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto('/');
    const before = await savedText(page);
    await page.getByRole('button', { name: '遺物図鑑', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '遺物図鑑' });
    await expect(dialog.locator('.codex-growth[open]')).toHaveCount(0);
    const card = dialog.locator('[data-codex-relic="amplifier"]');
    await card.locator('summary').click();
    await expect(card.locator('.codex-levels li')).toHaveCount(10);
    await expect(card.locator('[data-level="1"]')).toContainText('1.35倍相当');
    await card.getByRole('combobox').selectOption('3');
    await expect(card.locator('[data-level="10"]')).toContainText('1.81倍相当');
    await expect(card.locator('[data-level="1"]')).toContainText('極位への進化はLv.5以上');
    await card.getByRole('combobox').selectOption('2');
    await card.getByRole('combobox').selectOption('1');
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await card.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.documentElement.classList.add('large-text'));
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const labelSize = await card.locator('.codex-level-label').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(labelSize).toBeGreaterThanOrEqual(18);
    await page.evaluate(() => document.documentElement.classList.remove('large-text'));
    await page.screenshot({ path: `.runtime/screenshots/${viewport.name}-relic-growth.png`, fullPage: true });
    await card.locator('summary').click(); await expect(card.locator('.codex-growth')).not.toHaveAttribute('open');
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '遺物図鑑', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '遺物図鑑', exact: true }).click();
    await expect(dialog.locator('.codex-growth[open]')).toHaveCount(0);
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    expect(await savedText(page)).toBe(before);
  });
}

test('owned current level is highlighted in its tier and tier changes keep keyboard focus', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/game/engine.ts'; const { newSave, startRun } = await import(/* @vite-ignore */ path);
    const save = startRun(newSave(), 'fuse', 51);
    save.run.inventory = ['wick']; save.run.relicLevels = { wick: 5 }; save.run.tier = { wick: 2 }; save.run.acquisitionRank = { wick: 1 };
    localStorage.setItem('chain-incantation.save.v1', JSON.stringify(save));
  });
  await page.reload();
  await page.getByRole('button', { name: '遺物図鑑', exact: true }).click();
  const card = page.locator('[data-codex-relic="wick"]');
  await expect(card).toContainText('所持中：上位 Lv.5');
  await card.locator('summary').click();
  await expect(card.locator('.current-level')).toContainText('Lv.5');
  const select = card.getByRole('combobox'); await select.focus(); await select.selectOption('3');
  await expect(select).toBeFocused(); await expect(card.locator('.current-level')).toHaveCount(0);
  await select.selectOption('2'); await expect(card.locator('.current-level')).toHaveCount(1);
  await page.screenshot({ path: '.runtime/screenshots/current-relic-growth.png', fullPage: true });
});
