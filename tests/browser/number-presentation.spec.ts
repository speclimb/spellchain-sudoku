import { expect, test } from '@playwright/test';
import { savedText } from './save-helpers';

for (const viewport of [{ name: 'desktop', width: 1440, height: 1080 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`${viewport.name}: trinity forecast rounds only its displayed multiplier`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const cell = await page.evaluate(async () => {
      const path = '/src/game/engine.ts';
      const { newSave, startRun, legalOrigins, previewAction } = await import(/* @vite-ignore */ path);
      const save = startRun(newSave(), 'fuse', 51);
      save.settings.reducedMotion = true; save.settings.sound = false; save.meta.tutorialDone = true;
      save.run.inventory = ['trinity']; save.run.relicLevels = { trinity: 6 };
      save.run.acquisitionRank = { trinity: 3 }; save.run.tier = { trinity: 1 };
      const root = legalOrigins(save.run).find((cell: number) => previewAction(save.run, cell).forecast?.procs?.some((proc: { id: string }) => proc.id === 'trinity'));
      if (root === undefined) throw new Error('Expected a trinity forecast fixture');
      localStorage.setItem('chain-incantation.save.v1', JSON.stringify(save));
      return root;
    });
    await page.reload();
    await page.getByRole('button', { name: /冒険の続きへ/ }).click();
    const before = await savedText(page);
    await page.locator(`[data-cell="${cell}"]`).click();
    const prediction = page.locator('.chance-forecast [data-proc="trinity"]');
    await expect(prediction).toContainText('73%で発動');
    await expect(prediction).toContainText('通常攻撃 ×1.64');
    await expect(prediction).not.toContainText('1.6400000000000001');
    await page.screenshot({ path: `.runtime/screenshots/${viewport.name}-number-rounding.png`, fullPage: true });
    expect(await savedText(page)).toBe(before);
  });
}
