import type { Save } from './types';
import { boundHistory, emptyHistory, ensureHistoryRun, forkHistory, historyKey, HISTORY_LIMITS, type HistoryBattle, type PlayHistory } from './history';
import { loadSave, parseSaveData, SAVE_KEY } from './storage';

export const HISTORY_DB = 'chain-incantation.history.v1';
const ROOT = 'root', BATTLES = 'battles';
const LIMITED = '大容量の履歴保存を利用できません。冒険の進行と直近の履歴を予備保存しました。履歴はこの画面からJSON保存できます。';
const FAILED = 'このブラウザでは保存できません。以前の保存は消していません。ページを閉じると今回の進行が失われる可能性があります。';
const CONFLICT = '別のタブで保存が更新されました。上書きを止めました。このページを再読み込みしてから続けてください。';
type Marker = { mode: 'indexeddb' | 'fallback'; token: string };
type Core = Save & { historyStorage?: Marker };
type Catalog = Omit<PlayHistory, 'runs'> & { runs: (Omit<PlayHistory['runs'][number], 'battles'> & { battles: string[] })[] };
type Root = { token: string; core: Save; history: Catalog; sourceLocal: string | null };
type Row = { key: string; battle: HistoryBattle };
export interface SaveResult { warning: string; saved: boolean; conflict?: boolean; history?: PlayHistory }
const battleKey = (runKey: string, stage: number) => `${runKey}:${stage}`;
function readLocal(): string | null { return localStorage.getItem(SAVE_KEY); }
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(HISTORY_DB, 1);
    const timer = setTimeout(() => { settled = true; reject(new Error('Database timeout')); }, 4000);
    request.onupgradeneeded = () => { const db = request.result; db.createObjectStore(ROOT); db.createObjectStore(BATTLES, { keyPath: 'key' }); };
    request.onsuccess = () => { clearTimeout(timer); if (settled) { request.result.close(); return; } settled = true; request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); settled = true; reject(request.error ?? new Error('Database open failed')); };
    // A blocked open request is still pending; reading its .error throws.
    request.onblocked = () => { clearTimeout(timer); settled = true; reject(new Error('Database blocked')); };
  });
}
function readDatabase(db: IDBDatabase): Promise<{ root?: Root; rows: Row[] }> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ROOT, BATTLES], 'readonly');
    const root = tx.objectStore(ROOT).get('save'), rows = tx.objectStore(BATTLES).getAll();
    tx.oncomplete = () => resolve({ root: root.result, rows: rows.result });
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Database read failed'));
  });
}
function joinHistory(root: Root, rows: Row[]): PlayHistory {
  const byKey = new Map(rows.map(row => [row.key, row.battle]));
  return { ...root.history, runs: root.history.runs.map(run => ({ ...run, battles: run.battles.map(key => byKey.get(key)!) })) };
}
/** Restoring a small fallback must not discard archived adventures in the DB. */
function mergeArchive(save: Save, archived: PlayHistory | undefined, sameLineage = false, recreatedCurrent = false): void {
  if (!archived) return;
  const history = save.history ?? emptyHistory();
  const numbers = new Set(history.runs.map(run => run.number));
  for (const run of history.runs) {
    const old = archived.runs.find(item => item.key === run.key);
    if (!old) continue;
    if (sameLineage && run.sinceCast === old.sinceCast) {
      run.battles = run.battles.map(battle => {
        const previous = old.battles.find(item => item.stage === battle.stage);
        if (!previous || previous.ledger.casts > battle.ledger.casts) return battle;
        const firstId = battle.casts[0]?.id ?? Infinity;
        const prefix = previous.casts.filter(cast => cast.id < firstId && cast.id <= (run.key === historyKey(save) ? save.run?.castCounter ?? Infinity : Infinity));
        return prefix.length && prefix.length + battle.casts.length <= battle.ledger.casts ? { ...battle, casts: [...prefix, ...battle.casts] } : battle;
      });
    }
    const first = run.battles[0]?.stage ?? Infinity;
    const prior = old.battles.filter(battle => battle.stage < first && (run.key !== historyKey(save) || !save.run || battle.stage < save.run.stage || (sameLineage && !run.battles.length && battle.stage === save.run.stage)));
    if (prior.length) { run.battles = [...prior, ...run.battles]; run.sinceCast = Math.min(run.sinceCast, old.sinceCast); run.partial = true; run.omittedBattles = old.omittedBattles; }
  }
  const restoredRuns = archived.runs.filter(run => run.number < save.meta.runs && !numbers.has(run.number));
  history.runs = [...restoredRuns, ...history.runs].sort((a, b) => a.number - b.number);
  history.omittedRuns = Math.max(history.omittedRuns - restoredRuns.length - Number(recreatedCurrent), archived.omittedRuns);
  boundHistory(history); save.history = history;
}

/** One session. A DB transaction commits core, catalog, changed battles and pruning
 * together. The small localStorage mirror is a recovery/old-version aid, never
 * the large archive. Neither successful migration nor failures delete old saves. */
export class HistoryStorage {
  private db?: IDBDatabase;
  private token?: string;
  private local: string | null = null;
  private rows = new Map<string, HistoryBattle>();
  private sizes = new WeakMap<HistoryBattle, number>();
  private disabled = false;
  private queue: Promise<unknown> = Promise.resolve();
  private loaded = false;

  async load(): Promise<{ save: Save; warning: string }> {
    const legacy = loadSave();
    try { this.local = readLocal(); } catch { /* The DB may still be available. */ }
    try {
      this.db = await openDatabase();
      const { root, rows } = await readDatabase(this.db);
      this.token = root?.token;
      if (root) {
        const history = joinHistory(root, rows);
        const stored = parseSaveData({ ...root.core, history });
        const expectedMirror = JSON.stringify({ ...root.core, historyStorage: { mode: 'indexeddb', token: root.token } satisfies Marker });
        const sameRun = !!stored.run && !!legacy.save.run && historyKey(stored) === historyKey(legacy.save)
          && stored.run.seed === legacy.save.run.seed && stored.run.character === legacy.save.run.character;
        const staleLegacy = sameRun && stored.run!.revision > legacy.save.run!.revision;
        const useDatabase = this.local === root.sourceLocal || this.local === expectedMirror || this.local === null || staleLegacy;
        if (useDatabase) {
          for (const run of stored.history?.runs ?? []) for (const battle of run.battles) this.rows.set(battleKey(run.key, battle.stage), battle);
          const validHistory = !!stored.history;
          ensureHistoryRun(stored); this.loaded = true;
          return { save: stored, warning: staleLegacy ? '古い予備保存より新しい冒険の進行を復元しました。古いタブが残っている場合は閉じてから続けてください。' : validHistory ? '' : 'プレイ履歴を読み込めませんでした。冒険の進行は保持しています。' };
        }
        const marker = (legacy.save as Core).historyStorage;
        const sameLineage = marker?.mode === 'fallback' && marker.token === root.token;
        // loadSave recreates the current adventure even when the smallest
        // fallback omitted every run. Count that recovery once, too.
        const rawRuns = sameLineage && this.local ? JSON.parse(this.local).history?.runs : undefined;
        const recreatedCurrent = sameLineage && !!legacy.save.run && Array.isArray(rawRuns) && !rawRuns.some((run: { key: string }) => run.key === historyKey(legacy.save));
        mergeArchive(legacy.save, stored.history, sameLineage, recreatedCurrent);
      }
      this.loaded = true;
      // Migration is performed by the next explicit save. Until then the exact
      // legacy file is left untouched, including on reload or interrupted open.
      return legacy;
    } catch {
      this.disabled = true; this.loaded = true;
      return { save: legacy.save, warning: legacy.warning || '大容量の履歴保存を利用できません。直近の予備保存から再開します。保存容量とブラウザの設定を確認してください。' };
    }
  }

  persist(save: Save): Promise<SaveResult> {
    // Snapshot the small core now; archived battle objects are immutable.
    const snapshot: Save = { ...structuredClone({ ...save, history: undefined }), history: forkHistory(save.history) };
    const result = this.queue.then(() => this.write(snapshot));
    this.queue = result.catch(() => {});
    return result;
  }

  private localChanged(): boolean {
    try { return readLocal() !== this.local; } catch { return false; }
  }
  private async write(save: Save): Promise<SaveResult> {
    if (!this.loaded) throw new Error('Load before saving');
    if (this.localChanged()) return { saved: false, conflict: true, warning: CONFLICT };
    delete (save as Core).historyStorage;
    if (this.disabled || !this.db) return this.fallback(save);
    const history = save.history ?? emptyHistory();
    boundHistory(history, Infinity);
    // Cache serialized size per immutable battle; no full-history stringify or
    // structuredClone occurs during a normal committed turn.
    let bytes = 0;
    for (const run of history.runs) for (const battle of run.battles) {
      let size = this.sizes.get(battle);
      if (size === undefined) { size = JSON.stringify(battle).length * 2; this.sizes.set(battle, size); }
      bytes += size;
    }
    if (bytes > HISTORY_LIMITS.bytes - 1024 * 1024) { boundHistory(history); history.storageReduced = true; }
    save.history = history;
    try {
      await this.commit(save);
      return { saved: true, history, warning: history.storageReduced ? '保存容量に合わせて古い履歴を整理しました。冒険の進行は保存済みです。' : '' };
    } catch (error) {
      if (error instanceof Error && error.message === CONFLICT) return { saved: false, conflict: true, warning: CONFLICT };
      // A failed IDB transaction left the previous complete archive intact. Keep
      // it intact, and checkpoint the new core separately with a fallback marker.
      this.disabled = true;
      return this.fallback(save);
    }
  }

  private commit(save: Save): Promise<void> {
    const history = save.history!, core = { ...save }; delete core.history;
    const currentRows = new Map<string, HistoryBattle>();
    const catalog: Catalog = { ...history, runs: history.runs.map(run => ({ ...run, battles: run.battles.map(battle => { const key = battleKey(run.key, battle.stage); currentRows.set(key, battle); return key; }) })) };
    const nextToken = crypto.randomUUID(), sourceLocal = this.local;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([ROOT, BATTLES], 'readwrite');
      let conflict = false;
      const rootStore = tx.objectStore(ROOT), battleStore = tx.objectStore(BATTLES);
      const current = rootStore.get('save');
      current.onsuccess = () => {
        if (current.result?.token !== this.token || this.localChanged()) { conflict = true; tx.abort(); return; }
        // Delete records not referenced by the new catalog, including orphaned
        // records from a legacy/fallback replacement in this same transaction.
        const keys = battleStore.getAllKeys();
        keys.onsuccess = () => { for (const key of keys.result) if (!currentRows.has(String(key))) battleStore.delete(key); };
        for (const [key, battle] of currentRows) if (this.rows.get(key) !== battle) battleStore.put({ key, battle } satisfies Row);
        rootStore.put({ token: nextToken, core, history: catalog, sourceLocal } satisfies Root, 'save');
      };
      tx.onabort = tx.onerror = () => reject(conflict ? new Error(CONFLICT) : tx.error ?? new Error('Database write failed'));
      tx.oncomplete = () => {
        this.token = nextToken; this.rows = currentRows;
        // A mirror failure never turns a committed DB save into a failed save.
        try {
          if (!this.localChanged()) {
            const raw = JSON.stringify({ ...core, historyStorage: { mode: 'indexeddb', token: nextToken } satisfies Marker });
            localStorage.setItem(SAVE_KEY, raw); this.local = raw;
          }
        } catch { /* The DB root's sourceLocal still identifies the old mirror. */ }
        resolve();
      };
    });
  }

  private fallback(save: Save): SaveResult {
    if (this.localChanged()) return { saved: false, conflict: true, warning: CONFLICT };
    const history = forkHistory(save.history) ?? emptyHistory();
    const omitted = history.runs.length - 1;
    if (omitted > 0) { history.runs = history.runs.slice(-1); history.omittedRuns += omitted; }
    const latest = history.runs[0];
    if (latest && latest.battles.length > 2) { latest.omittedBattles += latest.battles.length - 2; latest.battles = latest.battles.slice(-2); }
    for (const bytes of [128 * 1024, 32 * 1024, 0]) {
      boundHistory(history, bytes); history.storageReduced = true;
      const raw = JSON.stringify({ ...save, history, historyStorage: { mode: 'fallback', token: this.token ?? '' } satisfies Marker });
      try { localStorage.setItem(SAVE_KEY, raw); this.local = raw; return { saved: true, warning: LIMITED }; } catch { /* Keep last good save. */ }
    }
    return { saved: false, warning: FAILED };
  }
  close(): void { this.db?.close(); }
}
