import { savedText } from './save-helpers';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { HistoryCast, PlayHistory } from '../../src/game/history';
import type { Save } from '../../src/game/types';

const key = 'chain-incantation.save.v1';
const saved = (page: Page): Promise<string | null> => savedText(page, key);
const readSave = async (page: Page): Promise<Save> => page.evaluate(async () => {
  const path = '/src/game/history-storage.ts'; const { HistoryStorage } = await import(/* @vite-ignore */ path);
  const store = new HistoryStorage(); const result = await store.load(); store.close(); return result.save;
});
const historyDialog = (page: Page) => page.getByRole('dialog', { name: 'プレイ履歴', exact: true });
async function openHistory(page: Page) { await page.locator('[data-action="history"]').click(); await expect(historyDialog(page)).toBeVisible(); }
async function resume(page: Page) { await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click(); }
async function noOverflow(page: Page) {
  const bounds = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('.history-modal');
    const header = document.querySelector<HTMLElement>('.site-header')!;
    return { page: document.documentElement.scrollWidth, viewport: innerWidth, dialog: dialog?.scrollWidth ?? 0, inner: dialog?.clientWidth ?? 0, header: header.getBoundingClientRect().right };
  });
  expect(bounds.page).toBeLessThanOrEqual(bounds.viewport + 1);
  expect(bounds.dialog).toBeLessThanOrEqual(bounds.inner + 1);
  expect(bounds.header).toBeLessThanOrEqual(bounds.viewport);
}
async function bossReward(page: Page) {
  await page.goto('/');
  await page.evaluate(async key => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ engine);
    const { singles } = await import(/* @vite-ignore */ sudoku);
    let save = startRun(newSave(), 'fuse', 413);
    save.settings.reducedMotion = true; save.settings.sound = false; save.meta.tutorialDone = true;
    save.run.inventory = ['pen', 'stroke']; save.run.relicLevels = { pen: 2, stroke: 1 };
    for (let n = 0; n < 5; n++) {
      save.run.enemyHp = 1;
      save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
      if (n < 4) while (save.run.phase === 'reward') save = dispatch(save, { type: 'reward', relic: save.run.rewards[0], revision: save.run.revision });
    }
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
}

test('empty title history is read-only and supports close, backdrop, Escape and focus return', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const before = await saved(page);
  for (const dismissal of ['escape', 'close', 'backdrop', 'footer']) {
    await openHistory(page);
    await expect(historyDialog(page)).toContainText('まだプレイ履歴がありません');
    await expect(historyDialog(page).getByRole('button', { name: 'JSONを保存' })).toBeDisabled();
    await expect(historyDialog(page).getByRole('button', { name: '履歴を閉じる', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(historyDialog(page).getByRole('button', { name: '元の画面へ戻る' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(historyDialog(page).getByRole('button', { name: '履歴を閉じる', exact: true })).toBeFocused();
    await noOverflow(page);
    if (dismissal === 'escape') await page.keyboard.press('Escape');
    else if (dismissal === 'backdrop') await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } });
    else await historyDialog(page).getByRole('button', { name: dismissal === 'close' ? '履歴を閉じる' : '元の画面へ戻る', exact: true }).click();
    await expect(historyDialog(page)).toHaveCount(0);
    await expect(page.locator('[data-action="history"]')).toBeFocused();
    expect(await saved(page)).toBe(before);
  }
  expect(errors).toEqual([]);
});

test('normal, free and paid skill casts show committed separate metrics, stable previews and retained JSON', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.evaluate(async key => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ engine);
    const { singles } = await import(/* @vite-ignore */ sudoku);
    let save = startRun(newSave(), 'fuse', 45);
    save.meta.tutorialDone = true; save.settings.reducedMotion = true; save.settings.sound = false;
    const enemies = '/src/game/enemies.ts';
    const { enemyForRun } = await import(/* @vite-ignore */ enemies);
    save.run.stage = 4; save.run.stats.kills = 4; save.run.enemyHp = enemyForRun(save.run).hp;
    save.history.runs[0].battles = [];
    save.run.inventory = ['quint', 'sept', 'trinity', 'pen', 'battery'];
    save.run.relicLevels = { quint: 1, sept: 1, trinity: 1, pen: 1, battery: 2 };
    save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
    save.run.freeSkillTokens = 1; save.run.mana = 8; save.run.manaOverflow = 2; save.run.reservedAuto = 7;
    save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: true, skillId: 'fuse', revision: save.run.revision });
    save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: true, skillId: 'fuse', revision: save.run.revision });
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
  const before = await saved(page), data = await readSave(page), casts = data.history!.runs.at(-1)!.battles[0].casts;
  expect(casts).toHaveLength(3); expect(casts[1].freeSkill).toBe(true); expect(casts[2].freeSkill).toBe(false);
  expect(casts[1].charged).toBe(0); expect(casts[1].manaAfter).toBe(8); expect(casts[1].overflowAfter).toBe(2);
  expect(casts[2].charged).toBe(0); expect(casts[2].overflowRestored).toBe(2);
  for (const cell of (await page.locator('[data-cell][aria-disabled="false"]').all()).slice(0, 3)) await cell.click();
  expect(await saved(page)).toBe(before);
  await openHistory(page);
  expect(await saved(page)).toBe(before);
  await page.screenshot({ path: '.runtime/screenshots/mobile-play-history-overview.png', fullPage: true });
  await expect(page.locator('.history-cast')).toHaveCount(0);
  await page.locator('.history-battle>summary').click();
  await expect(page.locator('.history-cast')).toHaveCount(3);
  await expect(page.locator('.history-cast-content .history-metrics')).toHaveCount(0);
  await page.locator('.history-battle-effects>summary').click();
  await expect(page.locator('[data-history-battle-relic="pen"]')).toContainText('発動機会');
  const detail = page.locator(`[data-history-cast="${casts[1].id}"]`);
  await detail.locator('summary').click();
  await expect(detail).toContainText('星火連環 Lv.1');
  await expect(detail).toContainText('詠唱符1枚を消費');
  await expect(detail).toContainText('魔力と蓄電');
  await expect(detail).toContainText('魔力・蓄電の消費なし');
  await expect(detail.locator('.history-metrics>div').filter({ has: page.locator('dt', { hasText: '魔力 前 → 後' }) }).locator('dd')).toHaveText('8 → 8');
  const paid = page.locator(`[data-history-cast="${casts[2].id}"]`);
  await paid.locator('summary').click();
  await expect(paid.locator('.history-metrics>div').filter({ has: page.locator('dt', { hasText: '詠唱に使ったもの' }) }).locator('dd')).toHaveText('魔力8を消費');
  await expect(paid.locator('.history-metrics>div').filter({ has: page.locator('dt', { hasText: '魔力を消費するスキルの詠唱後、蓄電から戻った魔力' }) }).locator('dd')).toHaveText('＋2');
  // Responsive and late board initialization redraws preserve the open tree.
  await page.setViewportSize({ width: 780, height: 1000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(detail).toHaveAttribute('open', '');
  await expect(paid).toHaveAttribute('open', '');
  await expect(paid.getByRole('heading', { name: '魔力と蓄電', exact: true })).toBeVisible();
  await expect(detail).toContainText('詠唱符 獲得 / 使用');
  await expect(detail).toContainText('七の護符の連鎖詠唱数 追加 / 消費');
  await expect(detail).toContainText('合計ダメージ');
  await expect(detail).toContainText('敵HPに与えた分 / 超過');
  await expect(detail).toContainText('受けた反撃 / 実HP減少');
  await expect(detail).toContainText('合計できません');
  for (const proc of casts[1].procs) await expect(detail.locator(`[data-history-proc="${proc.id}"] strong`)).toContainText(proc.triggered ? '発動' : '不発');
  const free = casts[1].relics.quint?.metric;
  await expect(detail.locator('.history-metrics>div').filter({ has: page.locator('dt', { hasText: '詠唱符 獲得 / 使用' }) }).locator('dd')).toHaveText(`${free?.tokensGranted ?? 0} / ${free?.tokensUsed ?? 0}枚`);
  await noOverflow(page);
  await detail.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: '.runtime/screenshots/mobile-play-history-cast.png', fullPage: true });
  await paid.getByRole('heading', { name: '魔力と蓄電', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: '.runtime/screenshots/mobile-play-history-mana.png', fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await historyDialog(page).getByRole('button', { name: 'JSONを保存' }).click();
  const download = await downloadPromise, path = await download.path();
  expect(download.suggestedFilename()).toMatch(/^spellchain-history-.*\.json$/);
  const exported = JSON.parse(await readFile(path!, 'utf-8'));
  expect(exported.history).toEqual(data.history); expect(exported).not.toHaveProperty('run');
  expect(exported.notes.join('')).toContain('省略された記録');
  expect(JSON.stringify(exported)).not.toContain('"cells"');
  expect(await saved(page)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-action="history"]')).toBeFocused();
  await resume(page); await openHistory(page);
  await expect(page.locator('.history-battle-stats')).toContainText('3詠唱');
});

test('boss report history restores its modal, both reward stages and records selected reward text', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await bossReward(page);
  await page.locator('.contribution-details>summary').click();
  await page.locator('[data-report-window="boss"]').click();
  const before = await saved(page);
  await page.locator('[data-action="history-report"]').click();
  await expect(historyDialog(page)).toBeVisible();
  await expect(page.locator('.history-battle').first()).toContainText('第5戦');
  await page.locator('.history-battle>summary').first().click();
  await expect(page.locator('.history-battle').first()).toContainText('勝利');
  await page.locator('.history-battle-effects>summary').click();
  await expect(page.locator('[data-history-battle-relic="pen"]')).toContainText('発動');
  await noOverflow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '成長の選択' })).toBeVisible();
  await expect(page.locator('[data-action="history-report"]')).toBeFocused();
  await expect(page.locator('.contribution-details')).toHaveAttribute('open', '');
  await expect(page.locator('.contribution-report')).toHaveAttribute('data-window', 'boss');
  expect(await saved(page)).toBe(before);
  await page.locator('.reward-card').first().click();
  const first = await readSave(page), firstReward = first.history!.runs.at(-1)!.battles.at(-1)!.rewards[0];
  await expect(page.locator('.reward-progress')).toHaveAttribute('aria-label', 'ボス報酬 2/2 遺物');
  await page.locator('[data-action="history-reward"]').click();
  await page.locator('.history-battle>summary').first().click();
  await expect(page.locator('.history-battle').first()).toHaveAttribute('open', '');
  await expect(page.locator('.history-rewards strong')).toBeVisible();
  await expect(page.locator('.history-rewards')).toContainText(firstReward.name);
  await expect(page.locator('.history-rewards')).toContainText('1/2 スキル');
  await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('[data-action="history-reward"]')).toBeFocused();
  await expect(page.locator('.reward-progress')).toHaveAttribute('aria-label', 'ボス報酬 2/2 遺物');
  await page.locator('.reward-card').first().click();
  const completed = await readSave(page), boss = completed.history!.runs.at(-1)!.battles.find(b => b.stage === 4)!;
  expect(boss.rewards).toHaveLength(2);
  await openHistory(page); await page.locator('[data-history-battle="4"]>summary').click();
  await expect(page.locator('[data-history-battle="4"]')).toHaveAttribute('open', '');
  for (const reward of boss.rewards) await expect(page.locator('.history-rewards strong').filter({ hasText: reward.name })).toBeVisible();
  await expect(page.locator('.history-rewards')).toContainText('2/2 遺物');
  await page.locator('[data-history-battle="4"]>summary').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await expect(page.locator('[data-history-battle="4"]')).toHaveAttribute('open', '');
  await page.screenshot({ path: '.runtime/screenshots/desktop-play-history-boss.png', fullPage: true });
});

test('a loss opens history and returns to the result without resetting the run', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const root = await page.evaluate(async key => {
    const engine = '/src/game/engine.ts';
    const { startRun, newSave, legalOrigins, previewAction } = await import(/* @vite-ignore */ engine);
    const save = startRun(newSave(), 'fuse', 21);
    save.settings.reducedMotion = true; save.settings.sound = false; save.meta.tutorialDone = true;
    const enemies = '/src/game/enemies.ts';
    const { enemyForRun } = await import(/* @vite-ignore */ enemies);
    save.run.stage = 14; save.run.stats.kills = 14; save.run.hp = 1; save.run.enemyHp = enemyForRun(save.run).hp; save.run.turn = 2;
    const root = legalOrigins(save.run).find((cell: number) => previewAction(save.run, cell).received > 0);
    localStorage.setItem(key, JSON.stringify(save)); return root;
  }, key);
  expect(root).toBeDefined(); await resume(page);
  await page.locator(`[data-cell="${root}"]`).click(); await page.locator('[data-action="cast"]').click();
  await expect(page.getByRole('dialog', { name: '冒険の結果' })).toBeVisible();
  const before = await saved(page);
  await page.locator('[data-action="history-result"]').click();
  await expect(page.locator('.history-battle').first()).toContainText('敗北');
  await page.locator('.history-battle>summary').first().click();
  await page.locator('.history-cast>summary').click();
  await expect(page.locator('.history-cast-content')).toContainText('受けた反撃 / 実HP減少');
  await noOverflow(page);
  await historyDialog(page).getByRole('button', { name: '履歴を閉じる', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '冒険の結果' })).toBeVisible();
  await expect(page.locator('[data-action="history-result"]')).toBeFocused();
  expect(await saved(page)).toBe(before);
});

test('legacy saves disclose partial history and never invent pre-update casts', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async key => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts';
    const { startRun, newSave, dispatch } = await import(/* @vite-ignore */ engine);
    const { singles } = await import(/* @vite-ignore */ sudoku);
    let save = startRun(newSave(), 'fuse', 21);
    save.settings.reducedMotion = true; save.settings.sound = false;
    save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
    delete save.history; localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await page.reload(); const before = await saved(page);
  await openHistory(page);
  await expect(historyDialog(page)).toContainText('記録を始めた時点からの部分記録');
  await expect(historyDialog(page)).toContainText('通算2詠唱目');
  await expect(page.locator('.history-cast')).toHaveCount(0);
  expect(await saved(page)).toBe(before);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await page.locator('[data-cell][aria-disabled="false"]').first().click(); await page.locator('[data-action="cast"]').click();
  await expect(page.locator('[data-action="cast"]')).not.toContainText('詠唱中');
  const data = await readSave(page);
  expect(data.history!.runs.at(-1)!.battles[0].casts).toHaveLength(1);
  expect(data.history!.runs.at(-1)!.battles[0].casts[0].id).toBe(2);
});

test('retained adventures, omitted data and 600 casts stay paged and keyboard accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.evaluate(async key => {
    const engine = '/src/game/engine.ts', sudoku = '/src/game/sudoku.ts';
    const { startRun, newSave, dispatch } = await import(/* @vite-ignore */ engine);
    const { singles } = await import(/* @vite-ignore */ sudoku);
    let save = newSave();
    for (let n = 0; n < 11; n++) {
      save = startRun(save, 'fuse', 21 + n);
      if (n === 1) save = dispatch(save, { type: 'play', cell: singles(save.run.cells)[0], skill: false, revision: save.run.revision });
    }
    save.settings.sound = false; save.settings.reducedMotion = true;
    // Synthetic, schema-valid capacity fixture. Retained summaries keep totals
    // for 601 casts while only the newest 600 per-cast records survive.
    const history = save.history as PlayHistory, old = history.runs[0], battle = old.battles[0], first = battle.casts[0];
    battle.stage = 13; battle.ledger.stage = 13; battle.partial = true;
    battle.casts = Array.from({ length: 600 }, (_, i) => ({ ...structuredClone(first), id: i + 2, turn: i + 2 } as HistoryCast));
    for (const field of ['casts', 'damage', 'hpDamage', 'overkill', 'score'] as const) battle.ledger[field] *= 601;
    for (const field of ['received', 'hpLost', 'sheetsCompleted'] as const) battle[field] *= 601;
    old.battles = Array.from({ length: 11 }, (_, i) => ({ ...structuredClone(battle), stage: i + 2, maxChain: 0, received: 0, hpLost: 0, sheetsCompleted: 0, casts: [], ledger: { ...structuredClone(battle.ledger), stage: i + 2, casts: 0, damage: 0, hpDamage: 0, overkill: 0, score: 0, skills: {}, relics: {} } }));
    old.battles.push(battle); old.omittedBattles = 2; history.storageReduced = true;
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await page.reload(); const before = await saved(page), data = await readSave(page);
  await openHistory(page);
  await expect(historyDialog(page)).toContainText('以前の1冒険');
  await expect(historyDialog(page)).toContainText('保存容量に合わせて履歴を縮小');
  await historyDialog(page).getByLabel('冒険を選ぶ').selectOption(data.history!.runs[0].key);
  await expect(page.locator('.history-battle')).toHaveCount(10);
  await expect(historyDialog(page)).toContainText('古い2戦を省略');
  await expect(page.locator('.history-range')).toContainText('第3〜14戦');
  await expect(page.locator('.history-range')).toContainText('通算#2〜#601');
  await expect(historyDialog(page)).toContainText('1詠唱の詳細を省略');
  await page.locator('.history-battle>summary').first().click();
  await expect(page.locator('.history-cast')).toHaveCount(30);
  await expect(page.locator('.history-cast').first()).toContainText('#2');
  await expect(page.locator('.history-cast-content .history-metrics')).toHaveCount(0);
  await page.getByRole('button', { name: '次の詠唱', exact: true }).click();
  await expect(page.locator('.history-cast')).toHaveCount(30);
  await expect(page.locator('.history-cast').first()).toContainText('#32');
  await expect(page.locator('.history-cast>summary').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.history-cast').first()).toHaveAttribute('open', '');
  const openedCast = page.locator('.history-cast[open] .history-cast-content');
  await expect(openedCast.getByRole('heading', { name: '魔力と蓄電', exact: true })).toBeVisible();
  await expect(openedCast.getByRole('heading', { name: '接続の栞', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.history-modal'))).toBe(true);
  await noOverflow(page);
  await page.getByRole('button', { name: '古い戦いへ', exact: true }).click();
  await expect(page.locator('.history-battle')).toHaveCount(2);
  await expect(page.locator('.history-cast')).toHaveCount(0);
  await expect(page.locator('.history-battle').first()).toContainText('第4戦');
  expect(await saved(page)).toBe(before);
});

test('a cross-sheet cast stays one chronological entry with real HP and overkill separated', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const cast = await page.evaluate(async key => {
    const engine = '/src/game/engine.ts';
    const { newSave, startRun, dispatch } = await import(/* @vite-ignore */ engine);
    let save = startRun(newSave(), 'fuse', 103);
    save.settings.reducedMotion = true; save.settings.sound = false;
    const run = save.run, root = run.cells.findIndex((value: number) => value === 0);
    run.cells = run.solution.map((value: number, cell: number) => cell === root ? 0 : value);
    run.inventory = ['wick']; run.relicLevels = { wick: 10 }; run.tier.wick = 2;
    run.spellLevel = 100; run.hp = run.maxHp = 436; run.enemyHp = 1;
    save = dispatch(save, { type: 'play', cell: root, skill: false, revision: run.revision });
    localStorage.setItem(key, JSON.stringify(save));
    return save.history.runs.at(-1).battles[0].casts[0] as HistoryCast;
  }, key);
  expect(cast.sheetTo).toBeGreaterThan(cast.sheetFrom); expect(cast.overkill).toBeGreaterThan(0); expect(cast.hpDamage).toBe(1);
  await page.reload(); const before = await saved(page); await openHistory(page);
  await page.locator('.history-battle>summary').click();
  await expect(page.locator('.history-cast')).toHaveCount(1);
  await expect(page.locator('.history-cast')).toContainText('シート越え');
  await page.locator('.history-cast>summary').click();
  const detail = page.locator('.history-cast-content');
  await expect(detail).toContainText(`${cast.sheetFrom} → ${cast.sheetTo}（シート越え）`);
  await expect(detail).toContainText(`1 / ${cast.overkill.toLocaleString('ja-JP')}`);
  await expect(detail.locator('[data-history-relic="wick"]')).toContainText('Lv.10 · 上位');
  await noOverflow(page); expect(await saved(page)).toBe(before);
});

test('reload during animation, repeated cast clicks and skip never duplicate history; new runs retain it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.evaluate(async key => {
    const engine = '/src/game/engine.ts';
    const { newSave, startRun } = await import(/* @vite-ignore */ engine);
    const save = startRun(newSave(), 'fuse', 45);
    save.settings.sound = false; save.meta.tutorialDone = true;
    localStorage.setItem(key, JSON.stringify(save));
  }, key);
  await resume(page);
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
  });
  expect((await readSave(page)).history!.runs.at(-1)!.battles[0].casts).toHaveLength(1);
  // The reducer commits before the long animation. Reload must not replay it.
  await resume(page);
  expect((await readSave(page)).history!.runs.at(-1)!.battles[0].casts).toHaveLength(1);
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
  });
  await page.locator('[data-action="skip-animation"]').click();
  await expect(page.locator('[data-action="cast"]')).not.toContainText('詠唱中');
  const before = await readSave(page), old = before.history!.runs.at(-1)!;
  expect(old.battles[0].casts.map(cast => cast.id)).toEqual([1, 2]);
  await page.getByRole('button', { name: 'タイトルへ', exact: true }).click();
  await page.locator('[data-action="new"]').click();
  await page.locator('[data-action="restart"]').click();
  await openHistory(page);
  await expect(historyDialog(page).getByLabel('冒険を選ぶ').locator('option')).toHaveCount(2);
  await historyDialog(page).getByLabel('冒険を選ぶ').selectOption(old.key);
  await expect(page.locator('.history-battle')).toContainText('冒険終了');
  await page.locator('.history-battle>summary').click();
  await expect(page.locator('.history-cast')).toHaveCount(2);
  const retained = (await readSave(page)).history!.runs.find(run => run.key === old.key)!;
  expect(retained.battles[0].casts).toEqual(old.battles[0].casts);
  await noOverflow(page);
});
