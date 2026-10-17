import { expect, test, type Page } from '@playwright/test';
import type { Report, RewardId, Run } from '../../src/game/types';
import { savedGame, savedText } from './save-helpers';

const key = 'chain-incantation.save.v1';
const auto = (page: Page) => page.locator('[data-action="autoplay"]');
const rewardDialog = (page: Page) => page.getByRole('dialog', { name: '成長の選択' });
type FixtureKind = 'normal' | 'boss' | 'rescue' | 'defeat' | 'blocked';
interface Fixture { expected: Run[]; firstCell: number; firstReport: Report | null; skillReward?: RewardId; relicReward?: RewardId }

/** Each Playwright context owns its synthetic save; the player's open save is untouched. */
async function prepare(page: Page, kind: FixtureKind = 'normal', reducedMotion = true): Promise<Fixture> {
  await page.goto('/');
  const fixture = await page.evaluate(async ({ key, kind, reducedMotion }) => {
    const enginePath = '/src/game/engine.ts', enemiesPath = '/src/game/enemies.ts', contentPath = '/src/game/content.ts';
    const { newSave, startRun, dispatch, legalOrigins, longestOrigins, previewAction } = await import(/* @vite-ignore */ enginePath);
    const { enemyForRun } = await import(/* @vite-ignore */ enemiesPath);
    const { RELICS } = await import(/* @vite-ignore */ contentPath);
    for (let seed = 45; seed < 100; seed++) {
      const initial = newSave(); initial.meta.clears = 100; initial.meta.tutorialDone = true;
      initial.settings.sound = false; initial.settings.fast = true; initial.settings.reducedMotion = reducedMotion;
      const save = startRun(initial, 'fuse', seed), run = save.run;
      run.mana = 8; run.inventory = ['lens', 'quint']; run.relicLevels = { lens: 1, quint: 1 }; run.freeSkillTokens = 1;
      if (kind === 'boss') {
        run.stage = 4; run.stats.kills = 4; run.enemyHp = 1;
        run.inventory = ['glass', 'ward', 'pen', 'battery', 'afterglow', 'trinity', 'quint', 'sept'];
        run.relicLevels = Object.fromEntries(run.inventory.map((id: string) => [id, 1]));
        save.history.runs[0].battles = [];
      } else if (kind === 'rescue') {
        run.stage = 100; run.stats.kills = 100; run.spellLevel = 200;
        run.rescueItems = 1; run.rescueMilestones = 1; run.hp = run.maxHp = 10000;
        run.enemyHp = enemyForRun(run).hp; save.history.runs[0].battles = [];
      } else if (kind === 'defeat') {
        run.hp = 1; run.inventory = []; run.relicLevels = {}; run.freeSkillTokens = 0;
        // Put the three shield marks on filled cells, so every legal opening receives retaliation.
        run.marks = Array(81).fill(null);
        const filled = run.cells.flatMap((value: number, cell: number) => value ? [cell] : []);
        filled.slice(0, 3).forEach((cell: number) => { run.marks[cell] = 'shield'; });
        filled.slice(3, 6).forEach((cell: number) => { run.marks[cell] = 'weak'; });
      } else if (kind === 'blocked') {
        // A valid partial board with both 1 and 2 missing has no ordinary single.
        run.cells = run.solution.map((value: number) => value === 1 || value === 2 ? 0 : value);
        const clues = new Set(run.cells.flatMap((value: number, cell: number) => value ? [cell] : []).slice(0, 45));
        run.givens = run.cells.map((_value: number, cell: number) => clues.has(cell));
      }
      const rank = (current: Run) => longestOrigins(current, false, undefined, false).cells
        .map((cell: number) => ({ cell, report: previewAction(current, cell, false, undefined, false) }))
        .sort((a: { cell: number; report: Report }, b: { cell: number; report: Report }) => b.report.damage - a.report.damage || a.cell - b.cell);
      const first = rank(run)[0];
      if (kind === 'blocked') {
        if (legalOrigins(run).length) throw new Error('Blocked fixture unexpectedly has a normal origin');
        localStorage.setItem(key, JSON.stringify(save));
        return { expected: [], firstCell: -1, firstReport: null };
      }
      if (!first) continue;
      let current = save;
      const expected: Run[] = [];
      for (let index = 0; index < (kind === 'normal' ? 3 : 1); index++) {
        if (current.run.phase !== 'battle') break;
        const next = rank(current.run)[0];
        if (!next) break;
        current = dispatch(current, { type: 'play', cell: next.cell, skill: false, useRescue: false, revision: current.run.revision });
        expected.push(structuredClone(current.run));
      }
      if (kind === 'normal' && (expected.length !== 3 || expected.some(current => current.phase !== 'battle'))) continue;
      if (kind === 'defeat' && expected[0].phase !== 'lost') continue;
      if (kind === 'boss') {
        const result = expected[0];
        const relicReward = result.pendingRelicRewards?.find((id: string) => RELICS.some((relic: { id: string }) => relic.id === id) && !run.inventory.includes(id));
        if (!relicReward) continue;
        localStorage.setItem(key, JSON.stringify(save));
        return { expected, firstCell: first.cell, firstReport: first.report, skillReward: result.rewards[0], relicReward };
      }
      localStorage.setItem(key, JSON.stringify(save));
      return { expected, firstCell: first.cell, firstReport: first.report };
    }
    throw new Error(`No stable autoplay fixture found: ${kind}`);
  }, { key, kind, reducedMotion });
  await page.reload();
  await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'false');
  return fixture;
}

async function finished(page: Page): Promise<void> {
  await expect(page.locator('[data-action="skip-animation"]')).toHaveCount(0);
  await expect(page.locator('.combat-effects, .completion-cutin')).toHaveCount(0);
  await savedText(page);
}

async function committed(page: Page, casts: number): Promise<void> {
  await page.waitForFunction(({ key, casts }) => JSON.parse(localStorage.getItem(key) ?? '{}').run?.castCounter >= casts, { key, casts });
}

async function unchangedForOneTurn(page: Page, before: string | null): Promise<void> {
  // Longer than the selection delay: a leaked queued action would be committed by now.
  await page.waitForTimeout(650);
  expect(await savedText(page)).toBe(before);
}

test('continuous autoplay commits the best ordinary origin once per completed cast', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = await prepare(page);
  await page.keyboard.press('a');
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'true');
  await committed(page, 3);
  await page.keyboard.press('a');
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'false');
  await finished(page);
  const after = await savedGame(page);
  expect(after.run).toEqual(fixture.expected[2]);
  expect(after.run!.stats.skills).toBe(0);
  expect(after.run!.freeSkillTokens).toBe(1);
  const casts = after.history!.runs.at(-1)!.battles.flatMap(battle => battle.casts);
  expect(casts.map(cast => cast.id)).toEqual([1, 2, 3]);
  expect(casts.every(cast => !cast.skillId && cast.rescueRequested === false)).toBe(true);
  await unchangedForOneTurn(page, await savedText(page));
  expect(errors).toEqual([]);
});

for (const stop of ['keyboard', 'button'] as const) {
  test(`${stop}: stopping during committed animation finishes that cast and cancels the next`, async ({ page }) => {
    const fixture = await prepare(page, 'normal', false);
    await page.keyboard.press('a');
    await expect(page.locator('[data-action="skip-animation"]')).toBeVisible();
    await expect(auto(page)).toBeEnabled();
    if (stop === 'keyboard') await page.keyboard.press('a');
    else await auto(page).click();
    await expect(auto(page)).toHaveAttribute('aria-pressed', 'false');
    await finished(page);
    expect((await savedGame(page)).run).toEqual(fixture.expected[0]);
    await unchangedForOneTurn(page, await savedText(page));
  });
}

test('starting autoplay clears selected skill and bookmark and blocks manual combat input', async ({ page }) => {
  const fixture = await prepare(page, 'rescue', false);
  await page.locator('[data-action="skill"]').click();
  await page.locator('[data-action="rescue-toggle"]').click();
  await expect(page.locator('[data-action="skill"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-action="rescue-toggle"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('a');
  await expect(page.locator('[data-action="skill"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-action="rescue-toggle"]')).toHaveAttribute('aria-pressed', 'false');
  for (const selector of ['[data-action="cast"]', '[data-action="skill"]', '[data-action="rescue-toggle"]']) await expect(page.locator(selector)).toBeDisabled();
  await page.locator('[data-cell]').first().dispatchEvent('click');
  await page.keyboard.press('c');
  await expect(page.locator('[data-action="skip-animation"]')).toBeVisible();
  await page.keyboard.press('a');
  await page.locator('[data-action="skip-animation"]').click();
  await finished(page);
  const run = (await savedGame(page)).run!;
  expect(run).toEqual(fixture.expected[0]);
  expect(run.lastReport!.skill).toBe(false);
  expect(run.lastReport!.rescueRequested).toBe(false);
  expect(run.lastReport!.path.some(event => event.rescue)).toBe(false);
  expect(run.freeSkillTokens).toBe(1); expect(run.rescueItems).toBe(1);
});

test('boss rewards and relic exchange wait for the user, then autoplay resumes', async ({ page }) => {
  const fixture = await prepare(page, 'boss');
  await page.keyboard.press('a');
  await expect(rewardDialog(page)).toBeVisible();
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'true');
  await unchangedForOneTurn(page, await savedText(page));
  await rewardDialog(page).locator(`[data-reward="${fixture.skillReward}"]`).click();
  await savedText(page);
  await expect(rewardDialog(page).locator('.reward-progress')).toContainText('2/2');
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'true');
  await unchangedForOneTurn(page, await savedText(page));
  await rewardDialog(page).locator(`[data-reward="${fixture.relicReward}"]`).click();
  await expect(rewardDialog(page).locator('[data-replace]')).toHaveCount(8);
  await unchangedForOneTurn(page, await savedText(page));
  await rewardDialog(page).locator('[data-replace="glass"]').click();
  await expect(rewardDialog(page)).toHaveCount(0);
  await committed(page, 2);
  await page.keyboard.press('a');
  await finished(page);
  const save = await savedGame(page);
  expect(save.run!.stage).toBe(5); expect(save.run!.castCounter).toBe(2);
  expect(save.run!.inventory).toContain(fixture.relicReward);
  expect(save.run!.inventory).not.toContain('glass');
  expect(save.history!.runs.at(-1)!.battles.find(battle => battle.stage === 4)!.rewards).toHaveLength(2);
});

test('dialogs and chain inspection pause the pending cast and closing them resumes it', async ({ page }) => {
  await prepare(page);
  await page.keyboard.press('a');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '設定', exact: true })).toBeVisible();
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'true');
  await unchangedForOneTurn(page, await savedText(page));
  // A in a dialog does not alter the remembered mode.
  await page.keyboard.press('a'); await expect(auto(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="chain-guide"]').click();
  await expect(page.locator('[data-action="chain-guide"]')).toHaveAttribute('aria-expanded', 'true');
  await unchangedForOneTurn(page, await savedText(page));
  await page.locator('[data-action="chain-close"]').click();
  await committed(page, 1); await page.keyboard.press('a'); await finished(page);
  expect((await savedGame(page)).run!.castCounter).toBe(1);
});

test('hidden tab and title screen pause autoplay while reload resets it to off', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    // Hide in the same task as activation, before the pending selection timer can run.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'true');
  await unchangedForOneTurn(page, await savedText(page));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('[data-action="home"]').first().click();
  await expect(page.locator('[data-action="resume"]')).toBeVisible();
  await unchangedForOneTurn(page, await savedText(page));
  await page.locator('[data-action="resume"]').click();
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'true');
  await committed(page, 1); await page.keyboard.press('a'); await finished(page);
  expect((await savedGame(page)).run!.castCounter).toBe(1);
  await page.keyboard.press('a');
  await page.reload(); await page.locator('[data-action="resume"]').click();
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'false');
  await unchangedForOneTurn(page, await savedText(page));
});

test('A ignores modifiers, repeated/composing keys and editable controls', async ({ page }) => {
  await prepare(page);
  const before = await savedText(page);
  for (const combination of ['Control+a', 'Alt+a', 'Meta+a', 'Shift+a']) await page.keyboard.press(combination);
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, repeat: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, isComposing: true }));
  });
  for (const markup of ['<input>', '<textarea></textarea>', '<select><option>a</option></select>', '<div contenteditable="true"><span>入力中</span></div>']) {
    await page.evaluate(markup => {
      const host = document.createElement('div'); host.dataset.shortcutEditable = ''; host.innerHTML = markup;
      document.querySelector('.command-panel')!.append(host);
      const editable = host.firstElementChild as HTMLElement; editable.focus();
      (editable.firstElementChild ?? editable).dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    }, markup);
    await expect(auto(page)).toHaveAttribute('aria-pressed', 'false');
    await page.locator('[data-shortcut-editable]').evaluate(element => element.remove());
  }
  await unchangedForOneTurn(page, before);
  await page.keyboard.press('a'); await expect(auto(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('a'); await expect(auto(page)).toHaveAttribute('aria-pressed', 'false');
  await unchangedForOneTurn(page, before);
});

for (const kind of ['defeat', 'blocked'] as const) {
  test(`${kind}: autoplay stops instead of queuing another cast`, async ({ page }) => {
    const fixture = await prepare(page, kind);
    await page.keyboard.press('a');
    if (kind === 'defeat') {
      await expect(page.getByRole('dialog', { name: '冒険の結果' })).toBeVisible();
      await expect(auto(page)).toHaveCount(0);
      await page.keyboard.press('a');
      await expect(auto(page)).toHaveCount(0);
    } else await expect(auto(page)).toHaveAttribute('aria-pressed', 'false');
    await finished(page);
    const save = await savedGame(page);
    expect(save.run!.castCounter).toBe(kind === 'defeat' ? 1 : 0);
    if (kind === 'defeat') expect(save.run).toEqual(fixture.expected[0]);
    await unchangedForOneTurn(page, await savedText(page));
  });
}

test('failed durable saving turns autoplay off and preserves the last saved turn', async ({ page }) => {
  await prepare(page);
  const before = await savedText(page);
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      const tx = transaction.apply(this, args);
      if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());
      return tx;
    };
    Storage.prototype.setItem = function() { throw new DOMException('Fixture quota exhausted', 'QuotaExceededError'); };
  });
  await page.keyboard.press('a');
  await expect(page.locator('[role="alert"]')).toContainText('保存');
  await expect(auto(page)).toHaveAttribute('aria-pressed', 'false');
  await finished(page);
  await unchangedForOneTurn(page, before);
});

for (const stop of ['keyboard', 'button'] as const) {
  test(`${stop}: autoplay remains stoppable while durable saving is pending`, async ({ page }) => {
    const fixture = await prepare(page, 'normal', false);
    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      if (!descriptor?.set) throw new Error('IndexedDB completion event cannot be deferred');
      const scope = window as Window & { releaseAutoplaySave?: () => void };
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
        configurable: true, enumerable: descriptor.enumerable, get: descriptor.get,
        set(this: IDBTransaction, handler: ((this: IDBTransaction, event: Event) => unknown) | null) {
          const transaction = this;
          if (transaction.mode !== 'readwrite' || !handler) { descriptor.set!.call(transaction, handler); return; }
          descriptor.set!.call(transaction, (event: Event) => { scope.releaseAutoplaySave = () => handler.call(transaction, event); });
        },
      });
    });
    await page.keyboard.press('a');
    await page.waitForFunction(() => !!(window as Window & { releaseAutoplaySave?: () => void }).releaseAutoplaySave);
    await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'true');
    await expect(auto(page)).toBeEnabled();
    if (stop === 'keyboard') await page.keyboard.press('a');
    else await auto(page).click();
    await expect(auto(page)).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => (window as Window & { releaseAutoplaySave?: () => void }).releaseAutoplaySave!());
    await expect(page.locator('[data-action="skip-animation"]')).toBeVisible();
    await page.locator('[data-action="skip-animation"]').click();
    await finished(page);
    expect((await savedGame(page)).run).toEqual(fixture.expected[0]);
    await unchangedForOneTurn(page, await savedText(page));
  });
}

for (const viewport of [{ name: 'desktop', width: 1440, height: 1080 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`${viewport.name}: autoplay is visible, operable and fits the combat controls`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await prepare(page);
    await page.clock.install({ time: new Date('2026-10-17T03:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-17T03:00:01Z'));
    const button = auto(page);
    if (viewport.name === 'desktop') await page.keyboard.press('a');
    else await button.click();
    // Run the queued selection, then hold the 350 ms forecast on screen for visual QA.
    await page.clock.runFor(20);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toBeEnabled();
    await expect(page.locator(`[data-cell="${fixture.firstCell}"]`)).toHaveAttribute('aria-selected', 'true');
    await button.scrollIntoViewIfNeeded();
    const bounds = (await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.runtime/screenshots/autoplay-${viewport.name}.png`, fullPage: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    expect((await savedGame(page)).run!.castCounter).toBe(0);
  });
}
