import { expect, test, type Page } from '@playwright/test';
import { savedGame } from './save-helpers';
import type { Report, Run, SkillId } from '../../src/game/types';

const key = 'chain-incantation.save.v1';
type ExtraSkill = Extract<SkillId, 'bridge' | 'pierce' | 'bastion'>;
const conditions: Record<ExtraSkill, string> = {
  bridge: '最初の再接続先から3マス以上埋めると',
  pierce: '弱点から始め、弱点2マス以上かつ全入力の4分の1以上が弱点なら',
  bastion: '詠唱前のシート守護が12以上で、守護マスから始めると',
};

/** Find ordinary generated boards where the selected specialty really applies.
 * The bastion fixture represents the two other shield marks already filled. */
async function prepare(page: Page, skillId: ExtraSkill): Promise<{ cell: number; report: Report }> {
  await page.goto('/');
  const fixture = await page.evaluate(async ({ key, skillId }) => {
    const enginePath = '/src/game/engine.ts';
    const { newSave, startRun, legalOrigins, previewAction, sheetShield } = await import(/* @vite-ignore */ enginePath);
    for (let seed = 1; seed <= 120; seed++) {
      const save = startRun(newSave(), 'fuse', seed), run = save.run as Run;
      save.meta.tutorialDone = true;
      save.settings.sound = false; save.settings.reducedMotion = true;
      run.mana = 8;
      run.skillLevels = { fuse: 5, bridge: 5, pierce: 5, bastion: 5 };
      run.equippedSkills = [skillId, skillId === 'bridge' ? 'pierce' : 'bridge'];
      if (skillId === 'bastion') {
        const earned = run.marks.flatMap((mark, cell) => mark === 'shield' ? [cell] : []).slice(0, 2);
        for (const cell of earned) run.cells[cell] = run.solution[cell];
        run.stats.filled = earned.length;
      }
      for (const cell of legalOrigins(run, true, skillId)) {
        const report = previewAction(run, cell, true, skillId) as Report;
        const reconnect = report.path.findIndex(fill => fill.bridge);
        const favorable = skillId === 'bridge' ? reconnect >= 0 && report.path.length - reconnect >= 3
          : skillId === 'pierce' ? run.marks[cell] === 'weak' && report.weak >= 2 && report.weak * 4 >= report.path.length
          : run.marks[cell] === 'shield' && sheetShield(run) >= 12;
        if (!favorable || report.defeated || report.fullClear) continue;
        localStorage.setItem(key, JSON.stringify(save));
        return { cell, report };
      }
    }
    throw new Error(`No favorable ${skillId} fixture found`);
  }, { key, skillId });
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  return fixture;
}

async function unobstructedLayout(page: Page, mobile: boolean): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const board = await page.locator('.board-surface').boundingBox();
  const description = await page.locator('.skill-description').boundingBox();
  const cast = await page.locator('[data-action="cast"]').boundingBox();
  expect(board).not.toBeNull(); expect(description).not.toBeNull(); expect(cast).not.toBeNull();
  const noOverlap = (a: NonNullable<typeof board>, b: NonNullable<typeof board>) =>
    a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
  expect(noOverlap(board!, description!)).toBe(true);
  expect(noOverlap(board!, cast!)).toBe(true);
  expect(await page.locator('.skill-description').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  expect(await page.locator('.skill-description').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  if (mobile) expect(cast!.y).toBeGreaterThanOrEqual(board!.y + board!.height - 1);
}

for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
  for (const skillId of ['bridge', 'pierce', 'bastion'] as const) {
    test(`${viewport.name}: ${skillId} specialty description, forecast, cast and reload agree`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      const fixture = await prepare(page, skillId);
      const before = (await savedGame(page)).run!;
      await page.locator(`[data-select-skill="${skillId}"]`).click();
      await expect(page.locator(`[data-select-skill="${skillId}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.skill-description')).toContainText(conditions[skillId]);
      await expect(page.locator('.skill-description')).toContainText('通常攻撃の5倍を1回追撃');
      await page.locator(`[data-cell="${fixture.cell}"]`).click();
      await expect(page.locator('#prediction-damage')).toHaveText(fixture.report.damage.toLocaleString('ja-JP'));
      await expect(page.locator('[data-action="cast"]')).toBeEnabled();
      // These fixtures exercise the new specialty bonus, beyond the fixed extra attack.
      expect(fixture.report.extraDamage).toBeGreaterThanOrEqual(fixture.report.baseDamage! * 5);
      expect((await savedGame(page)).run).toEqual(before);
      await page.evaluate(() => scrollTo(0, 0));
      await unobstructedLayout(page, viewport.name === 'mobile');
      await page.screenshot({ path: `.runtime/screenshots/skill-balance-${skillId}-${viewport.name}.png`, fullPage: true, animations: 'disabled' });
      await page.locator('[data-action="cast"]').click();
      await expect(page.locator('[data-action="cast"]')).not.toContainText('詠唱中');
      const committed = (await savedGame(page)).run!;
      expect(committed.lastReport?.skillId).toBe(skillId);
      expect(committed.lastReport?.damage).toBe(fixture.report.damage);
      expect(committed.lastReport?.extraDamage).toBe(fixture.report.extraDamage);
      expect(committed.stats.skills).toBe(before.stats.skills + 1);
      expect(committed.mana).toBe(0);
      await page.reload();
      await page.getByRole('button', { name: /冒険の続きへ/ }).click();
      expect((await savedGame(page)).run).toEqual(committed);
      await expect(page.locator('.last-spell')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}
