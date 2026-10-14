import { test, expect } from '@playwright/test';

// Every test gets a new browser context. All storage is synthetic and local.
async function prepare(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'プレイ履歴', exact: true }).waitFor();
  await page.evaluate(async () => {
    const storagePath = '/src/game/history-storage.ts', enginePath = '/src/game/engine.ts';
    const { HistoryStorage } = await import(/* @vite-ignore */ storagePath);
    const { newSave, startRun, dispatch, legalOrigins } = await import(/* @vite-ignore */ enginePath);
    (window as any).review = { HistoryStorage, newSave, startRun,
      play: (save: any) => dispatch(save, { type: 'play', cell: legalOrigins(save.run)[0], skill: false, revision: save.run.revision }),
      key: 'chain-incantation.save.v1' };
  });
}

test('migration is read-only until commit and reload restores exact core and history', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play, key } = (window as any).review;
    const save = play(startRun(newSave(), 'fuse', 51)), raw = JSON.stringify(save);
    localStorage.setItem(key, raw);
    const a = new HistoryStorage(), loaded = await a.load();
    const untouched = localStorage.getItem(key) === raw;
    const committed = await a.persist(loaded.save); a.close();
    const b = new HistoryStorage(), restored = await b.load(); b.close();
    return { untouched, committed, core: JSON.stringify(restored.save.run) === JSON.stringify(save.run), history: JSON.stringify(restored.save.history) === JSON.stringify(save.history), mirrorHasHistory: 'history' in JSON.parse(localStorage.getItem(key)!) };
  });
  expect(result).toMatchObject({ untouched: true, committed: { saved: true, warning: '' }, core: true, history: true, mirrorHasHistory: false });
});

test('a stale second session cannot overwrite committed core or history', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play } = (window as any).review;
    const a = new HistoryStorage(), b = new HistoryStorage(); await a.load(); await b.load();
    const winner = play(startRun(newSave(), 'fuse', 51));
    const first = await a.persist(winner), second = await b.persist(startRun(newSave(), 'fuse', 52));
    a.close(); b.close(); const c = new HistoryStorage(), restored = await c.load(); c.close();
    return { first, second, exact: JSON.stringify(restored.save.run) === JSON.stringify(winner.run) };
  });
  expect(result.first.saved).toBe(true); expect(result.second).toMatchObject({ saved: false, conflict: true }); expect(result.exact).toBe(true);
});

test('transaction abort preserves old DB and reload honors fallback core', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play, key } = (window as any).review;
    const a = new HistoryStorage(); await a.load(); const initial = startRun(newSave(), 'fuse', 51); await a.persist(initial);
    const next = play(initial), original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, ...args: any[]) { const tx = original.apply(this, args as any); if (args[1] === 'readwrite') queueMicrotask(() => tx.abort()); return tx; } as any;
    const failed = await a.persist(next); IDBDatabase.prototype.transaction = original; a.close();
    const marker = JSON.parse(localStorage.getItem(key)!).historyStorage.mode;
    const b = new HistoryStorage(), restored = await b.load(); b.close();
    return { failed, marker, exact: JSON.stringify(restored.save.run) === JSON.stringify(next.run), casts: restored.save.history.runs[0].battles[0].casts.length };
  });
  expect(result.failed.saved).toBe(true); expect(result.failed.warning).toContain('予備保存'); expect(result.marker).toBe('fallback'); expect(result.exact).toBe(true); expect(result.casts).toBe(1);
});

test('disabled IndexedDB falls back without changing the board or rolled reward', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play, key } = (window as any).review;
    const source = startRun(newSave(), 'fuse', 51); source.run.enemyHp = 1; const reward = play(source);
    localStorage.setItem(key, JSON.stringify(reward));
    const original = IDBFactory.prototype.open; IDBFactory.prototype.open = function() { throw new DOMException('Disabled', 'SecurityError'); };
    const a = new HistoryStorage(), loaded = await a.load(), persisted = await a.persist(loaded.save); a.close(); IDBFactory.prototype.open = original;
    return { persisted, exact: JSON.stringify(JSON.parse(localStorage.getItem(key)!).run) === JSON.stringify(reward.run), phase: loaded.save.run.phase };
  });
  expect(result.persisted.saved).toBe(true); expect(result.persisted.warning).toContain('予備保存'); expect(result.exact).toBe(true); expect(result.phase).toBe('reward');
});

test('total write failure leaves previous save byte-for-byte intact', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play, key } = (window as any).review;
    const source = startRun(newSave(), 'fuse', 51), raw = JSON.stringify(source); localStorage.setItem(key, raw);
    const open = IDBFactory.prototype.open, set = Storage.prototype.setItem;
    IDBFactory.prototype.open = function() { throw new DOMException('Disabled', 'SecurityError'); };
    const a = new HistoryStorage(); await a.load();
    Storage.prototype.setItem = function() { throw new DOMException('Full', 'QuotaExceededError'); };
    const failed = await a.persist(play(source)); Storage.prototype.setItem = set; IDBFactory.prototype.open = open; a.close();
    return { failed, unchanged: localStorage.getItem(key) === raw };
  });
  expect(result.failed.saved).toBe(false); expect(result.failed.warning).toContain('以前の保存は消していません'); expect(result.unchanged).toBe(true);
});

test('legacy writer inheriting an IndexedDB marker must not lose newer progress on reload', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play, key } = (window as any).review;
    const a = new HistoryStorage(); await a.load(); await a.persist(startRun(newSave(), 'fuse', 51)); a.close();
    // The released v1 parseSave retains unknown top-level fields, including this marker.
    const legacy = play(JSON.parse(localStorage.getItem(key)!)); localStorage.setItem(key, JSON.stringify(legacy));
    const b = new HistoryStorage(), restored = await b.load(); b.close();
    return { expected: legacy.run.castCounter, actual: restored.save.run.castCounter, exact: JSON.stringify(restored.save.run) === JSON.stringify(legacy.run) };
  });
  expect(result.actual).toBe(result.expected); expect(result.exact).toBe(true);
});

test('fallback recovery preserves old battles from the same long-running adventure', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play, key } = (window as any).review;
    const enemiesPath = '/src/game/enemies.ts'; const { enemyForRun } = await import(/* @vite-ignore */ enemiesPath);
    const base = startRun(newSave(), 'fuse', 51), played = play(base), battle = played.history.runs[0].battles[0];
    const save = structuredClone(base); save.run.stage = 300; save.run.stats.kills = 300; save.run.castCounter = save.run.stats.moves = 300; save.run.enemyHp = enemyForRun(save.run).hp;
    save.history.runs[0].battles = Array.from({ length: 300 }, (_, stage) => ({ ...structuredClone(battle), stage, status: 'victory', ledger: { ...structuredClone(battle.ledger), stage }, casts: battle.casts.map((cast: any) => ({ ...cast, id: stage + 1 })) }));
    const a = new HistoryStorage(); await a.load(); await a.persist(save);
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, ...args: any[]) { const tx = original.apply(this, args as any); if (args[1] === 'readwrite') queueMicrotask(() => tx.abort()); return tx; } as any;
    save.settings.sound = !save.settings.sound;
    const fallback = await a.persist(save); IDBDatabase.prototype.transaction = original; a.close();
    const reduced = JSON.parse(localStorage.getItem(key)!).history.runs[0].battles.length;
    const b = new HistoryStorage(), restored = await b.load(); const count = restored.save.history.runs[0].battles.length;
    const recommit = await b.persist(restored.save); b.close();
    const c = new HistoryStorage(), again = await c.load(); c.close();
    return { fallback, reduced, count, recommit, again: again.save.history.runs[0].battles.length, restoredCasts: again.save.history.runs[0].battles.reduce((n: number, b: any) => n + b.casts.length, 0), core: JSON.stringify(restored.save.run) === JSON.stringify(save.run) };
  });
  expect(result.fallback.warning).toContain('予備保存'); expect(result.reduced).toBeLessThan(300);
  expect(result.count).toBe(300); expect(result.again).toBe(300); expect(result.restoredCasts).toBe(300); expect(result.core).toBe(true); expect(result.recommit.saved).toBe(true);
});

test('committed IndexedDB remains authoritative when mirror writes fail', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play, key } = (window as any).review;
    const initial = startRun(newSave(), 'fuse', 51), raw = JSON.stringify(initial); localStorage.setItem(key, raw);
    const a = new HistoryStorage(); await a.load();
    const set = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new DOMException('Full', 'QuotaExceededError'); };
    const next = play(initial), committed = await a.persist(next); Storage.prototype.setItem = set; a.close();
    const unchangedMirror = localStorage.getItem(key) === raw;
    const b = new HistoryStorage(), restored = await b.load(); b.close();
    return { committed, unchangedMirror, exact: JSON.stringify(restored.save.run) === JSON.stringify(next.run), casts: restored.save.history.runs[0].battles[0].casts.length };
  });
  expect(result.committed).toMatchObject({ saved: true, warning: '' }); expect(result.unchangedMirror).toBe(true); expect(result.exact).toBe(true); expect(result.casts).toBe(1);
});

test('simultaneous writers are serialized by database generation even without mirrors', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun } = (window as any).review;
    const a = new HistoryStorage(), b = new HistoryStorage(); await a.load(); await b.load();
    const set = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new DOMException('Full', 'QuotaExceededError'); };
    const results = await Promise.all([a.persist(startRun(newSave(), 'fuse', 51)), b.persist(startRun(newSave(), 'fuse', 52))]);
    Storage.prototype.setItem = set; a.close(); b.close();
    return results;
  });
  expect(result.filter(r => r.saved)).toHaveLength(1); expect(result.filter(r => r.conflict)).toHaveLength(1);
});

test('reload immediately after starting a write cannot split the core and history', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play } = (window as any).review;
    const a = new HistoryStorage(); await a.load(); const initial = startRun(newSave(), 'fuse', 51); await a.persist(initial);
    void a.persist(play(initial)); location.reload();
  }).catch(error => { if (!String(error).includes('Execution context was destroyed')) throw error; });
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'プレイ履歴', exact: true }).waitFor();
  const result = await page.evaluate(async () => {
    const path = '/src/game/history-storage.ts'; const { HistoryStorage } = await import(/* @vite-ignore */ path);
    const storage = new HistoryStorage(), loaded = await storage.load(); storage.close();
    return { counter: loaded.save.run.castCounter, recorded: loaded.save.history.runs[0].battles[0].casts.length, warning: loaded.warning };
  });
  expect([0, 1]).toContain(result.counter); expect(result.recorded).toBe(result.counter); expect(result.warning).toBe('');
});

test('fallback restores archived cast IDs beyond the new adventures cast counter', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play } = (window as any).review;
    const enemiesPath = '/src/game/enemies.ts'; const { enemyForRun } = await import(/* @vite-ignore */ enemiesPath);
    const base = startRun(newSave(), 'fuse', 51), battle = play(base).history.runs[0].battles[0];
    const long = structuredClone(base); long.run.stage = 300; long.run.stats.kills = 300; long.run.castCounter = long.run.stats.moves = 300; long.run.enemyHp = enemyForRun(long.run).hp;
    long.history.runs[0].battles = Array.from({ length: 300 }, (_, stage) => ({ ...structuredClone(battle), stage, status: 'victory', ledger: { ...structuredClone(battle.ledger), stage }, casts: battle.casts.map((cast: any) => ({ ...cast, id: stage + 1 })) }));
    const save = startRun(long, 'fuse', 52);
    const a = new HistoryStorage(); await a.load(); await a.persist(save);
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, ...args: any[]) { const tx = original.apply(this, args as any); if (args[1] === 'readwrite') queueMicrotask(() => tx.abort()); return tx; } as any;
    await a.persist(save); IDBDatabase.prototype.transaction = original; a.close();
    const b = new HistoryStorage(), restored = await b.load(); b.close();
    const old = restored.save.history.runs.find((run: any) => run.number === 1);
    return { currentCasts: restored.save.run.castCounter, archivedCasts: old.battles.reduce((n: number, item: any) => n + item.casts.length, 0) };
  });
  expect(result.currentCasts).toBe(0); expect(result.archivedCasts).toBe(300);
});

for (const kind of ['blocked', 'stalled'] as const) test(`database open ${kind} falls back without deleting migration source`, async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async (kind) => {
    const { HistoryStorage, newSave, startRun, key } = (window as any).review;
    const source = startRun(newSave(), 'fuse', 51), raw = JSON.stringify(source); localStorage.setItem(key, raw);
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function() {
      const request: any = {};
      Object.defineProperty(request, 'error', { get() { throw new DOMException('Request pending', 'InvalidStateError'); } });
      if (kind === 'blocked') queueMicrotask(() => request.onblocked?.());
      return request;
    };
    const started = performance.now(), a = new HistoryStorage(), loaded = await a.load();
    IDBFactory.prototype.open = original; a.close();
    return { elapsed: performance.now() - started, warning: loaded.warning, unchanged: localStorage.getItem(key) === raw, exact: JSON.stringify(loaded.save.run) === JSON.stringify(source.run) };
  }, kind);
  expect(result.warning).toContain('大容量の履歴保存を利用できません'); expect(result.unchanged).toBe(true); expect(result.exact).toBe(true); expect(result.elapsed).toBeLessThan(8000);
});

test('steady-state writes no archived battles and only the changed active battle', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play } = (window as any).review;
    let save = play(startRun(play(startRun(newSave(), 'fuse', 51)), 'fuse', 52));
    const a = new HistoryStorage(); await a.load(); await a.persist(save);
    const original = IDBObjectStore.prototype.put; let battlePuts = 0, rootPuts = 0;
    IDBObjectStore.prototype.put = function(this: IDBObjectStore, ...args: any[]) {
      if (this.name === 'battles') battlePuts++;
      if (this.name === 'root') rootPuts++;
      return original.apply(this, args as any);
    } as any;
    save.settings.sound = !save.settings.sound; const settingsResult = await a.persist(save);
    const settingsBattlePuts = battlePuts, settingsRootPuts = rootPuts; battlePuts = 0; rootPuts = 0;
    save = play(save); const castResult = await a.persist(save);
    IDBObjectStore.prototype.put = original; a.close();
    return { settingsResult, castResult, settingsBattlePuts, settingsRootPuts, castBattlePuts: battlePuts, castRootPuts: rootPuts };
  });
  expect(result.settingsResult.saved).toBe(true); expect(result.castResult.saved).toBe(true);
  expect(result.settingsBattlePuts).toBe(0); expect(result.settingsRootPuts).toBe(1);
  expect(result.castBattlePuts).toBe(1); expect(result.castRootPuts).toBe(1);
});

test('reward fallback warning is visible inside the active dialog and exact progress is saved', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const { newSave, startRun, play, key } = (window as any).review;
    const source = startRun(newSave(), 'fuse', 51); source.run.stage = 4; source.run.stats.kills = 4; source.run.enemyHp = 1;
    source.meta.tutorialDone = true; source.settings.sound = false; source.settings.reducedMotion = true;
    localStorage.setItem(key, JSON.stringify(play(source)));
  });
  await page.reload(); await page.getByRole('button', { name: /冒険の続きへ/ }).click();
  const dialog = page.getByRole('dialog', { name: '成長の選択' }); await expect(dialog).toBeVisible();
  const expected = await page.evaluate(async () => {
    const path = '/src/game/engine.ts'; const { dispatch } = await import(/* @vite-ignore */ path);
    const save = JSON.parse(localStorage.getItem('chain-incantation.save.v1')!);
    const next = dispatch(save, { type: 'reward', relic: save.run.rewards[0], revision: save.run.revision });
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, ...args: any[]) { const tx = original.apply(this, args as any); if (args[1] === 'readwrite') queueMicrotask(() => tx.abort()); return tx; } as any;
    return next.run;
  });
  await dialog.locator('[data-reward]').first().click();
  await expect(dialog.getByRole('alert')).toContainText('予備保存');
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await dialog.getByRole('alert').evaluate(element => !!element.closest('[inert]'))).toBe(false);
  const actual = await page.evaluate(() => JSON.parse(localStorage.getItem('chain-incantation.save.v1')!).run);
  expect(actual).toEqual(expected); expect(actual.rewardStep).toBe('relic');
});

test('restored adventures are removed from the omitted count after a minimal fallback', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play, key } = (window as any).review;
    const save = play(startRun(play(startRun(newSave(), 'fuse', 51)), 'fuse', 52));
    const a = new HistoryStorage(); await a.load(); await a.persist(save);
    const original = IDBDatabase.prototype.transaction, set = Storage.prototype.setItem;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, ...args: any[]) { const tx = original.apply(this, args as any); if (args[1] === 'readwrite') queueMicrotask(() => tx.abort()); return tx; } as any;
    Storage.prototype.setItem = function(this: Storage, name: string, raw: string) {
      if (name === key && JSON.parse(raw).history?.runs.length) throw new DOMException('Full', 'QuotaExceededError');
      return set.call(this, name, raw);
    };
    const fallback = await a.persist(save); IDBDatabase.prototype.transaction = original; Storage.prototype.setItem = set; a.close();
    const fallbackHistory = JSON.parse(localStorage.getItem(key)!).history;
    const b = new HistoryStorage(), restored = await b.load(); await b.persist(restored.save); b.close();
    const c = new HistoryStorage(), again = await c.load(); c.close();
    return { fallback, fallbackRuns: fallbackHistory.runs.length, fallbackOmitted: fallbackHistory.omittedRuns, restoredRuns: restored.save.history.runs.length, restoredOmitted: restored.save.history.omittedRuns, originalOmitted: save.history.omittedRuns, againRuns: again.save.history.runs.length, currentCasts: again.save.history.runs.at(-1).battles.reduce((n: number, battle: any) => n + battle.casts.length, 0), againWarning: again.warning };
  });
  expect(result.fallback.saved).toBe(true); expect(result.fallbackRuns).toBe(0); expect(result.fallbackOmitted).toBe(2);
  expect(result.againRuns).toBe(2); expect(result.currentCasts).toBe(1); expect(result.againWarning).toBe('');
  expect(result.restoredRuns).toBe(2); expect(result.restoredOmitted).toBe(result.originalOmitted);
});

test('an older legacy tab cannot roll back a higher-revision database adventure', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { HistoryStorage, newSave, startRun, play, key } = (window as any).review;
    const initial = startRun(newSave(), 'fuse', 51);
    const a = new HistoryStorage(); await a.load(); await a.persist(initial);
    const stale = JSON.parse(localStorage.getItem(key)!); stale.settings.sound = !stale.settings.sound;
    const advanced = play(initial); await a.persist(advanced); a.close();
    // The old version retains unknown marker fields but writes its stale core.
    localStorage.setItem(key, JSON.stringify(stale));
    const b = new HistoryStorage(), restored = await b.load();
    const saved = await b.persist(restored.save); b.close();
    const c = new HistoryStorage(), again = await c.load(); c.close();
    return { warning: restored.warning, revision: restored.save.run.revision, expectedRevision: advanced.run.revision,
      exact: JSON.stringify(restored.save.run) === JSON.stringify(advanced.run), saved,
      againRevision: again.save.run.revision, casts: again.save.history.runs[0].battles[0].casts.length };
  });
  expect(result.warning).toContain('古いタブ'); expect(result.exact).toBe(true);
  expect(result.revision).toBe(result.expectedRevision); expect(result.againRevision).toBe(result.expectedRevision);
  expect(result.saved.saved).toBe(true); expect(result.casts).toBe(1);
});
