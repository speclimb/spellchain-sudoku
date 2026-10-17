import { APP_BUILD } from '../build-version';
import { relicOf, rewardOf } from './content';
import { enemyForRun } from './enemies';
import { ownedSkills, skillOf, skillLevel, skillValues, skillDescriptionFor, relicGrowthDescription, relicLevel, relicTierLevel } from './growth';
import type { Action, BattleLedger, CharacterId, EffectMetric, Phase, PrimeProcOutcome, RelicId, RewardId, Run, Save, SkillId } from './types';

export const HISTORY_LIMITS = { runs: 10, battles: 1000, casts: 100000, bytes: 256 * 1024 * 1024 } as const;
export interface HistoryEffect { level: number; tier: number; metric: Partial<EffectMetric> }
export interface HistoryCast {
  /** Monotonic run-wide committed cast number. Cross-sheet segments share this ID. */
  gameVersion?: string;
  id: number; turn: number; skillId?: SkillId; skillLevel?: number; spellLevel: number;
  chain: number; sheetFrom: number; sheetTo: number; sheetsCompleted: number;
  damage: number; hpDamage: number; overkill: number; received: number; hpLost: number;
  incoming: number; shield: number; healed: number; relicHealed?: number; hpBefore: number; hpAfter: number;
  enemyBefore: number; enemyAfter: number; freeSkill: boolean; score: number;
  procs: PrimeProcOutcome[]; relics: Partial<Record<RelicId, HistoryEffect>>;
  fuelBefore: number; fuelAfter: number; tokensBefore: number; tokensAfter: number;
  manaBefore: number; manaAfter: number; charged: number; overflowBefore: number; overflowAfter: number; overflowRestored: number;
  rescueItemsBefore?: number; rescueItemsAfter?: number; rescueItemsGranted?: number;
  stopReason?: 'limit' | 'no-target' | 'board-complete';
}
export interface HistoryReward { gameVersion?: string; revision: number; id: RewardId; name: string; description: string; step: string }
export interface VersionHistory { gameVersions?: string[]; versionHistoryPartial?: boolean }
export interface HistoryBattle extends VersionHistory {
  stage: number; enemy: string; boss: boolean; status: 'battle' | 'victory' | 'lost' | 'retired';
  partial: boolean; maxChain: number; received: number; hpLost: number; sheetsCompleted: number;
  ledger: BattleLedger; casts: HistoryCast[]; rewards: HistoryReward[];
}
export interface HistoryBuild {
  /** Frozen display text: never recalculate past effects from today's balance tables. */
  gameVersion?: string; version: 1; stage: number; cast: number; revision: number; spellLevel: number;
  relics: { id: RelicId; name: string; level: number; tier: number; description: string }[];
  skills: { id: SkillId; name: string; level: number; evolution: number; role: 'intrinsic' | 'equipped' | 'reserve'; description: string }[];
}
export function snapshotBuild(run: Run, gameVersion: string | null = APP_BUILD.id): HistoryBuild {
  return { ...(gameVersion ? { gameVersion } : {}), version: 1, stage: run.stage, cast: run.castCounter, revision: run.revision, spellLevel: run.spellLevel,
    relics: run.inventory.map(id => ({ id, name: relicOf(id).name, level: relicLevel(run, id), tier: relicTierLevel(run, id), description: relicGrowthDescription(run, id) })),
    skills: ownedSkills(run).map(id => ({ id, name: skillOf(id).name, level: skillLevel(run, id), evolution: skillValues(run, id).evolution,
      role: id === run.character ? 'intrinsic' : run.equippedSkills?.includes(id) ? 'equipped' : 'reserve', description: skillDescriptionFor(run, id) })) };
}
export interface HistoryRun extends VersionHistory {
  startedGameVersion?: string;
  key: string; number: number; seed: number; character: CharacterId; status: Phase | 'retired';
  sinceCast: number; partial: boolean; omittedBattles: number; battles: HistoryBattle[]; build?: HistoryBuild;
}
export interface PlayHistory { version: 1; runs: HistoryRun[]; omittedRuns: number; storageReduced?: boolean }
export const emptyHistory = (): PlayHistory => ({ version: 1, runs: [], omittedRuns: 0 });
export const historyKey = (save: Save, run = save.run): string => `${run?.id ?? ''}/${save.meta.runs}`;
export const historyBytes = (history: PlayHistory): number => JSON.stringify(history).length * 2;

/** Copy-on-write: archived casts are immutable and never cloned on every turn. */
export function forkHistory(history: PlayHistory | undefined, currentKey?: string): PlayHistory | undefined {
  if (!history) return undefined;
  return { ...history, runs: history.runs.map(run => ({ ...run, battles: run.battles.map(battle =>
    run.key === currentKey && battle === run.battles.at(-1) ? structuredClone(battle) : battle) })) };
}
export function ensureHistoryRun(save: Save, partial = true): HistoryRun | undefined {
  const run = save.run;
  if (!run) return undefined;
  const history = save.history ??= emptyHistory(), key = historyKey(save);
  let item = history.runs.find(r => r.key === key);
  if (!item) {
    item = { key, number: save.meta.runs, seed: run.seed, character: run.character, status: run.phase,
      sinceCast: run.castCounter, partial, omittedBattles: 0, battles: [] };
    history.runs.push(item);
  }
  // Only a still-live run can fill a missing snapshot from actual current state.
  // Completed legacy runs cannot prove their historical effects and stay unknown.
  if (!item.build && (run.phase === 'battle' || run.phase === 'reward')) item.build = snapshotBuild(run, null);
  return item;
}
function battleFor(item: HistoryRun, run: Run): HistoryBattle {
  let battle = item.battles.find(b => b.stage === run.stage);
  if (!battle) {
    const enemy = enemyForRun(run);
    battle = { stage: run.stage, enemy: enemy.name, boss: enemy.isBoss, status: run.phase === 'lost' ? 'lost' : run.phase === 'reward' || run.phase === 'won' ? 'victory' : 'battle',
      partial: run.turn > 0, maxChain: 0, received: 0, hpLost: 0, sheetsCompleted: 0,
      ledger: { stage: run.stage, boss: enemy.isBoss, balanceVersion: run.balanceVersion, casts: 0, damage: 0, hpDamage: 0, overkill: 0, score: 0, skills: {}, relics: {} }, casts: [], rewards: [] };
    item.battles.push(battle);
  }
  return battle;
}
export function beginHistory(save: Save, gameVersion = APP_BUILD.id): void {
  const history = save.history ??= emptyHistory();
  for (const item of history.runs) {
    if (item.status === 'battle' || item.status === 'reward') item.status = 'retired';
    item.battles = item.battles.map(battle => battle.status === 'battle' ? { ...battle, status: 'retired' } : battle);
  }
  const item = ensureHistoryRun(save, false);
  if (item && save.run) {
    item.startedGameVersion = gameVersion; item.gameVersions = [gameVersion]; item.versionHistoryPartial = false;
    item.build = snapshotBuild(save.run, gameVersion);
    const battle = battleFor(item, save.run); battle.gameVersions = [gameVersion]; battle.versionHistoryPartial = false;
  }
  boundHistory(history, Infinity);
}
function noteVersion(item: VersionHistory, version: string): void {
  if (!item.gameVersions) item.versionHistoryPartial = true;
  item.gameVersions = [...new Set([...(item.gameVersions ?? []), version])];
}
/** Only dispatch calls this, after resolveAction succeeds. Preview/animation never append. */
export function recordHistory(save: Save, before: Run, action: Action, gameVersion = APP_BUILD.id): void {
  const after = save.run!, item = ensureHistoryRun(save);
  if (!item) return;
  item.build = snapshotBuild(after, gameVersion);
  noteVersion(item, gameVersion);
  item.status = after.phase;
  const battle = battleFor(item, before);
  noteVersion(battle, gameVersion);
  if (action.type === 'equip') return;
  item.status = after.phase;
  if (action.type === 'reward') {
    if (!battle.rewards.some(r => r.revision === after.revision)) {
      const reward = rewardOf(action.relic, before);
      const exchange = action.replace ? ` ${relicOf(action.replace).name}（Lv.${relicLevel(before, action.replace)}・${['通常', '上位', '極位'][relicTierLevel(before, action.replace) - 1]}）と交換。外した遺物の育成は再取得まで保存。` : '';
      battle.rewards.push({ gameVersion, revision: after.revision, id: action.relic, name: reward.name, description: reward.description + exchange, step: before.rewardStep ?? 'legacy' });
    }
    battle.status = 'victory';
    if (after.stage !== before.stage) {
      const next = battleFor(item, after); next.gameVersions = [gameVersion]; next.versionHistoryPartial = false;
    }
  } else {
    const report = after.lastReport!;
    if (battle.casts.some(c => c.id === after.castCounter)) return;
    const relics: HistoryCast['relics'] = {};
    for (const [id, metric] of Object.entries(report.ledger?.relics ?? {}) as [RelicId, EffectMetric][]) {
      relics[id] = { level: relicLevel(before, id), tier: relicTierLevel(before, id), metric: Object.fromEntries(Object.entries(metric).filter(([, n]) => n !== 0)) };
    }
    const hpDamage = report.ledger?.hpDamage ?? Math.min(report.damage, report.enemyBefore), overkill = report.ledger?.overkill ?? Math.max(0, report.damage - report.enemyBefore);
    const cast: HistoryCast = { gameVersion, id: after.castCounter, turn: after.turn, skillId: report.skillId, skillLevel: report.skillLevel, spellLevel: before.spellLevel,
      chain: report.path.length, sheetFrom: report.path[0].sheet ?? before.sheet, sheetTo: report.path.at(-1)?.sheet ?? before.sheet,
      sheetsCompleted: report.sheetsCompleted ?? Number(report.fullClear), damage: report.damage, hpDamage, overkill,
      received: report.received, hpLost: Math.min(report.hpBefore + (report.relicHealed ?? 0), report.received), incoming: report.incoming, shield: report.shield,
      healed: report.healed, relicHealed: report.relicHealed, hpBefore: report.hpBefore, hpAfter: after.hp, enemyBefore: report.enemyBefore, enemyAfter: after.enemyHp,
      freeSkill: !!report.freeSkill, score: report.attackScore + (report.defeated ? 500 : 0), procs: structuredClone(report.procs ?? []), relics,
      fuelBefore: before.reservedAuto, fuelAfter: after.reservedAuto, tokensBefore: before.freeSkillTokens, tokensAfter: after.freeSkillTokens,
      manaBefore: before.mana, manaAfter: after.mana, charged: report.charge, overflowBefore: before.manaOverflow, overflowAfter: after.manaOverflow, overflowRestored: report.manaRestored ?? 0, stopReason: report.chain?.stopReason };
    if (report.rescueItemsBefore !== undefined) {
      cast.rescueItemsBefore = report.rescueItemsBefore;
      cast.rescueItemsAfter = report.rescueItemsAfter;
      cast.rescueItemsGranted = report.rescueItemsGranted;
    }
    battle.casts.push(cast); battle.maxChain = Math.max(battle.maxChain, cast.chain); battle.received += cast.received; battle.hpLost += cast.hpLost; battle.sheetsCompleted += cast.sheetsCompleted;
    battle.status = report.defeated ? 'victory' : after.phase === 'lost' ? 'lost' : 'battle';
    const total = battle.ledger;
    total.casts++; total.damage += cast.damage; total.hpDamage += hpDamage; total.overkill += overkill; total.score += cast.score;
    if (cast.skillId) {
      const metric = total.skills[cast.skillId] ??= { uses: 0, damage: 0, hpDamage: 0, overkill: 0, level: cast.skillLevel ?? 1 };
      metric.uses++; metric.damage += cast.damage; metric.hpDamage += hpDamage; metric.overkill += overkill; metric.level = cast.skillLevel ?? metric.level;
    }
    for (const [id, value] of Object.entries(report.ledger?.relics ?? {}) as [RelicId, EffectMetric][]) {
      const metric = total.relics[id] ??= Object.fromEntries(Object.keys(value).map(k => [k, 0])) as unknown as EffectMetric;
      for (const key of Object.keys(value) as (keyof EffectMetric)[]) metric[key] = (metric[key] ?? 0) + (value[key] ?? 0);
    }
  }
  boundHistory(save.history!, Infinity);
}
export function historyCounts(history: PlayHistory): { battles: number; casts: number } {
  return history.runs.reduce((count, run) => ({ battles: count.battles + run.battles.length, casts: count.casts + run.battles.reduce((n, b) => n + b.casts.length, 0) }), { battles: 0, casts: 0 });
}
function dropOldestBattle(history: PlayHistory): boolean {
  const run = history.runs.find(r => r.battles.length);
  if (!run || historyCounts(history).battles <= 1) return false;
  run.battles.shift(); run.omittedBattles++; return true;
}
export function trimHistoryDetails(history: PlayHistory, count = 1): number {
  let removed = 0;
  for (const run of history.runs) for (let i = 0; i < run.battles.length; i++) {
    const battle = run.battles[i];
    const n = Math.min(count - removed, battle.casts.length);
    if (n) run.battles[i] = { ...battle, casts: battle.casts.slice(n) }; removed += n;
    if (removed >= count) return removed;
  }
  return removed;
}
export function boundHistory(history: PlayHistory, maxBytes = HISTORY_LIMITS.bytes): void {
  if (history.runs.length > HISTORY_LIMITS.runs) { history.omittedRuns += history.runs.length - HISTORY_LIMITS.runs; history.runs.splice(0, history.runs.length - HISTORY_LIMITS.runs); }
  while (historyCounts(history).battles > HISTORY_LIMITS.battles) dropOldestBattle(history);
  trimHistoryDetails(history, Math.max(0, historyCounts(history).casts - HISTORY_LIMITS.casts));
  while (Number.isFinite(maxBytes) && historyBytes(history) > maxBytes) {
    // Batch pruning keeps serialization work bounded even with many rich casts.
    if (trimHistoryDetails(history, Math.max(20, Math.ceil(historyCounts(history).casts / 10)))) continue;
    if (dropOldestBattle(history)) continue;
    if (history.runs.length) { history.runs.shift(); history.omittedRuns++; }
    else break;
  }
}
