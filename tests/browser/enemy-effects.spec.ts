import { expect, test, type Page } from '@playwright/test';

type AttackFixture = { stage: number; turn?: number; fast?: boolean; reducedMotion?: boolean };
async function showAttack(page: Page, fixture: AttackFixture) {
  await page.evaluate(async options => {
    const effectsPath = '/src/ui/combat-effects.ts', audioPath = '/src/ui/audio.ts';
    const enginePath = '/src/game/engine.ts', enemiesPath = '/src/game/enemies.ts';
    const [{ CombatEffects }, { IncantationAudio }, { newSave, startRun }, { enemyForRun, enemyIncoming }] = await Promise.all([
      import(/* @vite-ignore */ effectsPath), import(/* @vite-ignore */ audioPath),
      import(/* @vite-ignore */ enginePath), import(/* @vite-ignore */ enemiesPath),
    ]);
    const before = startRun(newSave(), 'fuse', 21).run;
    before.stage = options.stage; before.turn = options.turn ?? 0; before.enemyRulesVersion = 1;
    before.enemyHp = enemyForRun(before).hp;
    const incoming = enemyIncoming(before);
    const report = { path: [], damage: 100, attackScore: 100, incoming, received: incoming, shield: 0, defeated: false, skill: false, sheetAdvanced: false, levelsGained: 0 };
    const after = structuredClone(before); after.hp -= incoming; after.enemyHp -= 100;
    const effects = new CombatEffects({ sound: false, fast: options.fast ?? false, reducedMotion: options.reducedMotion ?? false }, new IncantationAudio());
    const state = window as unknown as { attackFx: typeof effects; attackDone: Promise<void> };
    state.attackFx = effects; state.attackDone = effects.finish(before, after, report);
  }, fixture);
}
async function endAttack(page: Page) {
  await page.evaluate(async () => {
    const state = window as unknown as { attackFx: { destroy(): void }; attackDone: Promise<void> };
    await state.attackDone; state.attackFx.destroy();
  });
}

test('all eight enemies use distinct attack silhouettes and exact damage without altering saved simulation', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /冒険をはじめる/ }).click();
  const saved = await page.evaluate(() => localStorage.getItem('chain-incantation.save.v1'));
  for (const [stage, style] of [[0, 'fireball'], [1, 'feathers'], [2, 'pillars'], [3, 'ray'], [4, 'absorption'], [9, 'breath'], [5, 'frost'], [6, 'mirror']] as const) {
    await showAttack(page, { stage, turn: 1 });
    const effect = page.locator(`.combat-effects[data-phase="counter"][data-enemy-style="${style}"]`);
    await expect(effect).toBeVisible();
    await expect(effect.locator(`[data-attack-art="${style}"]`)).toBeVisible();
    await expect(effect.locator('.combat-slash')).toBeHidden();
    await expect(effect.locator('.combat-number')).toContainText('−');
    if (style === 'pillars' || style === 'breath' || style === 'frost') await page.screenshot({ path: `.runtime/screenshots/enemy-attack-${style}.png` });
    await endAttack(page);
    expect(await page.evaluate(() => localStorage.getItem('chain-incantation.save.v1'))).toBe(saved);
  }
});

test('frost charge is harmless, explicit, static with reduced motion, and skippable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /冒険をはじめる/ }).click();
  const saved = await page.evaluate(() => localStorage.getItem('chain-incantation.save.v1'));
  await showAttack(page, { stage: 5 });
  const charge = page.locator('.combat-effects[data-phase="charge"]');
  await expect(charge).toBeVisible();
  await expect(charge.locator('.combat-caption')).toContainText('力を溜める');
  await expect(charge.locator('.combat-number')).toHaveText('0');
  await expect(charge.locator('.combat-shield')).toContainText('10 の突進');
  await expect(page.locator('.app-shell')).not.toHaveClass(/player-struck|player-blocked/);
  await page.screenshot({ path: '.runtime/screenshots/enemy-frost-charge-mobile.png' });
  await endAttack(page);
  await showAttack(page, { stage: 6, reducedMotion: true });
  const still = page.locator('.combat-effects[data-phase="counter"].fx-still');
  await expect(still).toBeVisible();
  expect(await still.locator('.enemy-mirror-shards').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await endAttack(page);
  await showAttack(page, { stage: 9, fast: true });
  await page.evaluate(() => (window as unknown as { attackFx: { skip(): void } }).attackFx.skip());
  await expect(page.locator('.combat-effects')).toBeHidden();
  await endAttack(page);
  expect(await page.evaluate(() => localStorage.getItem('chain-incantation.save.v1'))).toBe(saved);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
