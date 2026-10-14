import { rewardOf } from './content';
import { enemyForRun } from './enemies';
import { relicLevel, relicTierLevel } from './growth';
import type { Action, BattleLedger, CharacterId, EffectMetric, Phase, PrimeProcOutcome, RelicId, RewardId, Run, Save, SkillId } from './types';

export const HISTORY_LIMITS = { runs: 3, battles: 60, casts: 600, bytes: 750 * 1024 } as const;
export interface HistoryEffect { level: number; tier: number; metric: Partial<EffectMetric> }
export interface HistoryCast {
  /** Monotonic run-wide committed cast number. Cross-sheet segments share this ID. */
  id: number; turn: number; skillId?: SkillId; skillLevel?: number; spellLevel: number;
  chain: number; sheetFrom: number; sheetTo: number; sheetsCompleted: number;
  damage: number; hpDamage: number; overkill: number; received: number; hpLost: number;
  incoming: number; shield: number; healed: number; hpBefore: number; hpAfter: number;
  enemyBefore: number; enemyAfter: number; freeSkill: boolean; score: number;
  procs: PrimeProcOutcome[]; relics: Partial<Record<RelicId, HistoryEffect>>;
  fuelBefore: number; fuelAfter: number; tokensBefore: number; tokensAfter: number;
  manaBefore: number; manaAfter: number; charged: number; overflowBefore: number; overflowAfter: number; overflowRestored: number;
  stopReason?: 'limit' | 'no-target' | 'board-complete';
}
export interface HistoryReward { revision: number; id: RewardId; name: string; description: string; step: string }
export interface HistoryBattle {
  stage: number; enemy: string; boss: boolean; status: 'battle' | 'victory' | 'lost' | 'retired';
  partial: boolean; maxChain: number; received: number; hpLost: number; sheetsCompleted: number;
  ledger: BattleLedger; casts: HistoryCast[]; rewards: HistoryReward[];
}
export interface HistoryRun {
  key: string; number: number; seed: number; character: CharacterId; status: Phase | 'retired';
  sinceCast: number; partial: boolean; omittedBattles: number; battles: HistoryBattle[];
}
export interface PlayHistory { version: 1; runs: HistoryRun[]; omittedRuns: number; storageReduced?: boolean }
export const emptyHistory = (): PlayHistory => ({ version: 1, runs: [], omittedRuns: 0 });
export const historyKey = (save: Save, run = save.run): string => `${run?.id ?? ''}/${save.meta.runs}`;
export const historyBytes = (history: PlayHistory): number => JSON.stringify(history).length * 2;

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
export function beginHistory(save: Save): void {
  const history = save.history ??= emptyHistory();
  for (const item of history.runs) {
    if (item.status === 'battle' || item.status === 'reward') item.status = 'retired';
    for (const battle of item.battles) if (battle.status === 'battle') battle.status = 'retired';
  }
  const item = ensureHistoryRun(save, false);
  if (item && save.run) battleFor(item, save.run);
  boundHistory(history);
}
/** Only dispatch calls this, after resolveAction succeeds. Preview/animation never append. */
export function recordHistory(save: Save, before: Run, action: Action): void {
  const after = save.run!, item = ensureHistoryRun(save);
  if (!item || action.type === 'equip') return;
  const battle = battleFor(item, before);
  item.status = after.phase;
  if (action.type === 'reward') {
    if (!battle.rewards.some(r => r.revision === after.revision)) {
      const reward = rewardOf(action.relic, before);
      battle.rewards.push({ revision: after.revision, id: action.relic, name: reward.name, description: reward.description, step: before.rewardStep ?? 'legacy' });
    }
    battle.status = 'victory';
    if (after.stage !== before.stage) battleFor(item, after);
  } else {
    const report = after.lastReport!;
    if (battle.casts.some(c => c.id === after.castCounter)) return;
    const relics: HistoryCast['relics'] = {};
    for (const [id, metric] of Object.entries(report.ledger?.relics ?? {}) as [RelicId, EffectMetric][]) {
      relics[id] = { level: relicLevel(before, id), tier: relicTierLevel(before, id), metric: Object.fromEntries(Object.entries(metric).filter(([, n]) => n !== 0)) };
    }
    const hpDamage = report.ledger?.hpDamage ?? Math.min(report.damage, report.enemyBefore), overkill = report.ledger?.overkill ?? Math.max(0, report.damage - report.enemyBefore);
    const cast: HistoryCast = { id: after.castCounter, turn: after.turn, skillId: report.skillId, skillLevel: report.skillLevel, spellLevel: before.spellLevel,
      chain: report.path.length, sheetFrom: report.path[0].sheet ?? before.sheet, sheetTo: report.path.at(-1)?.sheet ?? before.sheet,
      sheetsCompleted: report.sheetsCompleted ?? Number(report.fullClear), damage: report.damage, hpDamage, overkill,
      received: report.received, hpLost: Math.min(report.hpBefore, report.received), incoming: report.incoming, shield: report.shield,
      healed: report.healed, hpBefore: report.hpBefore, hpAfter: after.hp, enemyBefore: report.enemyBefore, enemyAfter: after.enemyHp,
      freeSkill: !!report.freeSkill, score: report.attackScore + (report.defeated ? 500 : 0), procs: structuredClone(report.procs ?? []), relics,
      fuelBefore: before.reservedAuto, fuelAfter: after.reservedAuto, tokensBefore: before.freeSkillTokens, tokensAfter: after.freeSkillTokens,
      manaBefore: before.mana, manaAfter: after.mana, charged: report.charge, overflowBefore: before.manaOverflow, overflowAfter: after.manaOverflow, overflowRestored: report.manaRestored ?? 0, stopReason: report.chain?.stopReason };
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
      for (const key of Object.keys(value) as (keyof EffectMetric)[]) metric[key] += value[key];
    }
  }
  boundHistory(save.history!);
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
  for (const run of history.runs) for (const battle of run.battles) {
    const n = Math.min(count - removed, battle.casts.length);
    battle.casts.splice(0, n); removed += n;
    if (removed >= count) return removed;
  }
  return removed;
}
export function boundHistory(history: PlayHistory, maxBytes = HISTORY_LIMITS.bytes): void {
  if (history.runs.length > HISTORY_LIMITS.runs) { history.omittedRuns += history.runs.length - HISTORY_LIMITS.runs; history.runs.splice(0, history.runs.length - HISTORY_LIMITS.runs); }
  while (historyCounts(history).battles > HISTORY_LIMITS.battles) dropOldestBattle(history);
  trimHistoryDetails(history, Math.max(0, historyCounts(history).casts - HISTORY_LIMITS.casts));
  while (historyBytes(history) > maxBytes) {
    // Batch pruning keeps serialization work bounded even with many rich casts.
    if (trimHistoryDetails(history, 20)) continue;
    if (dropOldestBattle(history)) continue;
    if (history.runs.length) { history.runs.shift(); history.omittedRuns++; }
    else break;
  }
}
