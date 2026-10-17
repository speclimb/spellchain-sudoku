import { expect, test, type Page } from '@playwright/test';
import { savedGame, savedText } from './save-helpers';

const key = 'chain-incantation.save.v1';
const rewardDialog = (page: Page) => page.getByRole('dialog', { name: '成長の選択' });
async function resume(page: Page): Promise<void> {
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
}

async function prepareFullReward(page: Page, oldBoss = false) {
  await page.goto('/');
  await page.evaluate(async ({ key, oldBoss }) => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts', content = '/src/game/content.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ engine);
    const { singles } = await import(/* @vite-ignore */ sudoku);
    const { RELICS } = await import(/* @vite-ignore */ content);
    const initial = newSave(); initial.meta.clears = 100; initial.meta.tutorialDone = true;
    initial.settings.reducedMotion = true;
    let save = startRun(initial, 'fuse', 45);
    const run = save.run;
    run.inventory = RELICS.slice(0, 8).map((relic: { id: string }) => relic.id);
    run.relicLevels = Object.fromEntries(run.inventory.map((id: string) => [id, 10]));
    run.acquisitionRank = Object.fromEntries(run.inventory.map((id: string) => [id, 1]));
    run.tier = Object.fromEntries(run.inventory.map((id: string) => [id, 3]));
    run.stage = oldBoss ? 144 : 70; run.stats.kills = run.stage; run.enemyHp = 1;
    if (oldBoss) delete run.endgameBalanceVersion;
    save = dispatch(save, { type: 'play', cell: singles(run.cells)[0], skill: false, revision: run.revision });
    if (oldBoss) {
      // Preserve an already committed menu which predates the new guarantee.
      save.run.rewards = ['skill:fuse', 'skill:bridge', 'skill:pierce'];
      save.run.pendingRelicRewards = ['lens', 'glass', 'afterglow'];
    }
    localStorage.setItem(key, JSON.stringify(save));
  }, { key, oldBoss });
  await resume(page);
  await expect(rewardDialog(page)).toBeVisible();
  return savedGame(page);
}

for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }]) {
  test(`full Lv.10 apex build takes guaranteed training without an exchange at ${viewport.width}px`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    const before = await prepareFullReward(page), run = before.run!, dialog = rewardDialog(page);
    expect(run.inventory).toHaveLength(8); expect(run.pool).toHaveLength(16);
    expect(run.inventory.every(id => run.relicLevels![id] === 10 && run.tier[id] === 3)).toBe(true);
    await expect(dialog.locator('[data-reward]')).toHaveCount(3);
    await expect(dialog.locator('[data-reward="training"]')).toBeVisible();
    await expect(dialog.locator('.reward-slots')).toContainText('8 / 8');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.locator('[data-reward="training"]').scrollIntoViewIfNeeded();
    await expect(dialog.locator('[data-reward="training"]')).toBeInViewport();
    await page.screenshot({ path: `.runtime/screenshots/endgame-guaranteed-training-${viewport.width}.png`, fullPage: true });
    await dialog.locator('[data-reward="training"]').click(); await savedText(page);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '入れ替える遺物を選ぶ' })).toHaveCount(0);
    const after = await savedGame(page);
    expect(after.run!.phase).toBe('battle'); expect(after.run!.stage).toBe(run.stage + 1);
    expect(after.run!.inventory).toEqual(run.inventory); expect(after.run!.relicLevels).toEqual(run.relicLevels);
    expect(after.run!.tier).toEqual(run.tier); expect(after.run!.stowedRelics).toEqual(run.stowedRelics);
    expect(after.run!.spellLevel).toBe(run.spellLevel + 1);
    await resume(page); expect(await savedGame(page)).toEqual(after); expect(errors).toEqual([]);
  });
}

test('old boss menus retain both committed steps through reload and opt into the new encounter only after the final reward', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await prepareFullReward(page, true), dialog = rewardDialog(page);
  expect(before.run!.endgameBalanceVersion).toBeUndefined();
  expect(before.run!.pendingRelicRewards).toEqual(['lens', 'glass', 'afterglow']);
  await expect(dialog.locator('.reward-progress')).toContainText('1/2');
  await resume(page); expect(await savedGame(page)).toEqual(before);
  await dialog.locator('[data-reward="skill:fuse"]').click(); await savedText(page);
  await expect(dialog.locator('.reward-progress')).toContainText('2/2');
  const skillTaken = await savedGame(page);
  expect(skillTaken.run!.rewards).toEqual(before.run!.pendingRelicRewards);
  expect(skillTaken.run!.endgameBalanceVersion).toBeUndefined();
  expect(skillTaken.run!.stage).toBe(144); expect(skillTaken.run!.randomState).toBe(before.run!.randomState);
  await resume(page); expect(await savedGame(page)).toEqual(skillTaken);
  await expect(dialog.locator('[data-reward="training"]')).toHaveCount(0);
  await dialog.locator('[data-reward="lens"]').click();
  await dialog.locator('[data-replace="pen"]').click(); await savedText(page);
  await expect(dialog).toHaveCount(0);
  const after = await savedGame(page);
  expect(after.run!.stage).toBe(145); expect(after.run!.endgameBalanceVersion).toBe(2);
  const enemy = await page.evaluate(async run => {
    const path = '/src/game/enemies.ts'; const { enemyForRun } = await import(/* @vite-ignore */ path);
    return { ...enemyForRun(run), previousAttack: enemyForRun({ ...run, endgameBalanceVersion: 1 }).attack };
  }, after.run);
  expect(enemy.attack).toBeGreaterThan(enemy.previousAttack); expect(after.run!.enemyHp).toBe(enemy.hp);
  await expect(page.locator('.enemy-intent')).toContainText(String(enemy.attack));
  await expect(page.locator('.enemy-health')).toContainText(enemy.hp.toLocaleString('ja-JP'));
  await resume(page); expect(await savedGame(page)).toEqual(after); expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }]) {
  test(`Lv.100 rescue explains its six-point cost and saves the exact prediction at ${viewport.width}px`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport); await page.goto('/');
    const fixture = await page.evaluate(async key => {
      const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts', enemies = '/src/game/enemies.ts';
      const { newSave, startRun, previewAction, dispatch } = await import(/* @vite-ignore */ engine);
      const { PEERS } = await import(/* @vite-ignore */ sudoku);
      const { enemyForRun } = await import(/* @vite-ignore */ enemies);
      const initial = newSave(); initial.meta.clears = 100; initial.meta.tutorialDone = true;
      initial.settings.reducedMotion = true;
      const save = startRun(initial, 'fuse', 71), run = save.run;
      run.endgameBalanceVersion = 1;
      run.stage = 144; run.stats.kills = 144; run.spellLevel = 100; run.hp = run.maxHp = 10000;
      run.enemyHp = enemyForRun(run).hp;
      const root = run.givens.findIndex((given: boolean) => !given);
      const spare = run.givens.findIndex((given: boolean, cell: number) => !given && cell !== root && !PEERS[root].includes(cell));
      if (spare < 0) throw new Error('No isolated rescue target');
      run.cells = [...run.solution]; run.cells[root] = 0; run.cells[spare] = 0;
      const report = previewAction(run, root), expected = dispatch(save, { type: 'play', cell: root, skill: false, revision: run.revision });
      const rescueIndex = report.chain.steps.findIndex((step: { rescue?: boolean }) => step.rescue);
      if (rescueIndex < 0) throw new Error('Fixture did not use rescue');
      localStorage.setItem(key, JSON.stringify(save)); return { root, report, expected, rescueIndex };
    }, key);
    await resume(page); const before = await savedGame(page);
    await expect(page.locator('.skill-description')).toContainText('接続救済');
    await page.locator(`[data-cell="${fixture.root}"]`).click();
    await expect(page.locator('#prediction-chain')).toHaveText(String(fixture.report.path.length));
    await page.locator('[data-action="chain-guide"]').click();
    for (let index = 0; index < fixture.rescueIndex; index++) await page.locator('[data-action="chain-next"]').click();
    await expect(page.locator('#chain-step-title')).toContainText('接続救済');
    await expect(page.locator('#chain-budget')).toContainText('6消費');
    await expect(page.locator('#chain-step-detail')).toContainText('確定マス');
    expect(await savedGame(page)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.runtime/screenshots/endgame-rescue-guide-${viewport.width}.png`, fullPage: true });
    await page.locator('[data-action="chain-close"]').click();
    await page.locator('[data-action="cast"]').click(); await savedText(page);
    const after = await savedGame(page);
    expect(after).toEqual(fixture.expected);
    expect(after.run!.lastReport!.path.filter(event => event.rescue)).toHaveLength(1);
    expect(after.run!.lastReport!.chain!.steps).toEqual(fixture.report.chain.steps);
    await resume(page); expect(await savedGame(page)).toEqual(after);
    await expect(page.locator('.combat-effects')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

async function itemFixture(page: Page, level: number, stock: number) {
  await page.goto('/');
  return page.evaluate(async ({ key, level, stock }) => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts', enemies = '/src/game/enemies.ts';
    const { newSave, startRun, previewAction, dispatch } = await import(/* @vite-ignore */ engine);
    const { PEERS } = await import(/* @vite-ignore */ sudoku);
    const { enemyForRun } = await import(/* @vite-ignore */ enemies);
    const initial = newSave(); initial.meta.clears = 100; initial.meta.tutorialDone = true;
    initial.settings.reducedMotion = true;
    const save = startRun(initial, 'fuse', 71), run = save.run;
    run.stage = 70; run.stats.kills = 70; run.spellLevel = level; run.hp = run.maxHp = 10000;
    run.rescueItems = stock; run.rescueMilestones = level < 200 ? 0 : 1;
    run.enemyHp = level < 200 ? 1 : enemyForRun(run).hp;
    const root = run.givens.findIndex((given: boolean) => !given);
    const spare = run.givens.findIndex((given: boolean, cell: number) => !given && cell !== root && !PEERS[root].includes(cell));
    if (spare < 0) throw new Error('No isolated rescue target');
    run.cells = [...run.solution]; run.cells[root] = 0; run.cells[spare] = 0;
    const report = previewAction(run, root), expected = dispatch(save, { type: 'play', cell: root, skill: false, revision: run.revision });
    localStorage.setItem(key, JSON.stringify(save)); return { root, spare, report, expected };
  }, { key, level, stock });
}

async function checkItemHistory(page: Page, before: number, after: number, granted: number, used: number) {
  const rewardEntry = page.locator('[data-action="history-reward"]');
  if (!await rewardEntry.count()) await expect(page.locator('[data-action="cast"]')).toContainText('起点を選んでください');
  await (await rewardEntry.count() ? rewardEntry : page.locator('[data-action="history"]')).click();
  const battle = page.locator('[data-history-battle="70"]'); await battle.locator('> summary').click();
  const detail = battle.locator('.history-cast'); await detail.locator('summary').click();
  await expect(detail).toContainText('接続の栞');
  const metrics = detail.locator('.history-metrics>div');
  await expect(metrics.filter({ has: page.getByText('所持 前 → 後', { exact: true }) }).locator('dd')).toHaveText(`${before} → ${after}個`);
  await expect(metrics.filter({ has: page.getByText('成長で獲得 / 接続救済で使用', { exact: true }) }).locator('dd')).toHaveText(`${granted} / ${used}個`);
  await page.keyboard.press('Escape');
}

for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }]) {
  test(`Lv.199 earns its first reconnect item after casting and reloads without duplicating it at ${viewport.width}px`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    const fixture = await itemFixture(page, 199, 0);
    expect(fixture.report.path).toHaveLength(1);
    expect(fixture.report).toMatchObject({ spellLevelAfter: 200, rescueItemsBefore: 0, rescueItemsAfter: 1, rescueItemsGranted: 1 });
    await resume(page);
    await expect(page.locator('.skill-description')).toContainText('接続の栞 0個');
    await expect(page.locator('.skill-description')).toContainText('次は術式Lv.200で1個');
    await page.locator(`[data-cell="${fixture.root}"]`).click();
    await expect(page.locator('#prediction-chain')).toHaveText('1');
    await page.locator('[data-action="cast"]').click(); await savedText(page);
    const after = await savedGame(page);
    expect(after).toEqual(fixture.expected);
    await expect(rewardDialog(page).locator('[data-rescue-stock]')).toContainText('接続の栞 1個');
    await expect(rewardDialog(page).locator('[data-rescue-stock]')).toContainText('成長で1個獲得');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.runtime/screenshots/endgame-item-earned-${viewport.width}.png`, fullPage: true });
    await checkItemHistory(page, 0, 1, 1, 0);
    for (let count = 0; count < 2; count++) { await resume(page); expect(await savedGame(page)).toEqual(after); }
    await rewardDialog(page).locator('[data-reward]').first().click(); await savedText(page);
    await expect(page.locator('.skill-description')).toContainText('接続の栞 1個');
    await expect(page.locator('.skill-description')).toContainText('次は術式Lv.300で1個');
    const next = await savedGame(page); expect(next.run!.rescueItems).toBe(1);
    await resume(page); expect(await savedGame(page)).toEqual(next); expect(errors).toEqual([]);
  });

  for (const stock of [0, 1]) {
    test(`Lv.200 item stock ${stock} preserves previews, commits one bounded rescue, and records history at ${viewport.width}px`, async ({ page }) => {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize(viewport);
      const fixture = await itemFixture(page, 200, stock);
      expect(fixture.report.path).toHaveLength(stock ? 2 : 1);
      expect(fixture.report.path.filter((event: { rescue?: boolean }) => event.rescue)).toHaveLength(stock);
      await resume(page); const before = await savedGame(page);
      await expect(page.locator('.skill-description')).toContainText(`接続の栞 ${stock}個`);
      await expect(page.locator('.skill-description')).toContainText('次は術式Lv.300で1個');
      for (let repeat = 0; repeat < 3; repeat++) {
        await page.locator(`[data-cell="${fixture.root}"]`).click();
        await expect(page.locator('#prediction-chain')).toHaveText(String(stock ? 2 : 1));
        await page.locator('[data-action="chain-guide"]').click();
        if (stock) {
          await page.locator('[data-action="chain-next"]').click();
          await expect(page.locator('#chain-step-title')).toContainText('接続救済');
          await expect(page.locator('#chain-budget')).toContainText('6消費');
          await expect(page.locator('#chain-guide .chain-note')).toContainText('接続の栞を1個消費');
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (!repeat) await page.screenshot({ path: `.runtime/screenshots/endgame-item-guide-${viewport.width}.png`, fullPage: true });
        }
        await page.locator('[data-action="chain-close"]').click();
        expect(await savedGame(page)).toEqual(before);
      }
      await page.locator('[data-action="cast"]').click(); await savedText(page);
      const after = await savedGame(page);
      expect(after).toEqual(fixture.expected);
      expect(after.run).toMatchObject({ rescueItems: 0, rescueMilestones: 1 });
      expect(after.run!.lastReport).toMatchObject({ rescueItemsBefore: stock, rescueItemsAfter: 0, rescueItemsGranted: 0 });
      expect(after.run!.lastReport!.chain).toEqual(fixture.report.chain);
      if (stock) {
        const step = after.run!.lastReport!.chain!.steps.find(item => item.rescue)!;
        expect(step.remainingBefore - step.remainingAfter + step.addedAuto).toBe(6);
      }
      await expect(page.locator('.skill-description')).toContainText('接続の栞 0個');
      await checkItemHistory(page, stock, 0, 0, stock);
      expect(await savedGame(page)).toEqual(after);
      await resume(page); expect(await savedGame(page)).toEqual(after);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
