export type CharacterId = 'fuse' | 'scribe' | 'lumen';
export type RelicId = 'wick' | 'echo' | 'rekindle' | 'pen' | 'ward' | 'stroke' | 'battery' | 'amplifier' | 'afterglow' | 'lens' | 'glass' | 'gold' | 'trinity';
export type RepeatableRewardId = 'training' | 'vitality' | 'recovery';
export type GreaterRelicId = 'stroke' | 'trinity';
export type RewardId = RelicId | RepeatableRewardId | 'skill-upgrade' | `greater:${GreaterRelicId}`;
export type Mark = 'weak' | 'shield' | null;
export type Phase = 'battle' | 'reward' | 'won' | 'lost';
export interface FillEvent {
  cell: number; value: number; ordinal: number; source: 'root' | 'echo' | 'chain';
  units: number[]; mark: Mark; hop?: boolean;
}
export interface ChainStep {
  from: number | null; cell: number; source: FillEvent['source']; sharedUnits: number[];
  candidateValues: number[]; eligibleCells: number[]; tiedCells: number[]; initiallySingle: boolean;
  remainingBefore: number; remainingAfter: number; addedAuto: number; hop?: boolean;
}
export interface ChainTrace {
  initialAuto: number; bonuses: { label: string; amount: number }[]; steps: ChainStep[];
  stopReason: 'limit' | 'no-target' | 'board-complete'; remainingAuto: number;
}
export interface ProcOutcome { id: 'trinity'; chance: number; multiplier: number; triggered: boolean }
export interface Forecast {
  damageMax: number; attackScoreMax: number; chance: number; multiplier: number;
  receivedMin: number; receivedMax: number; healedMin: number; healedMax: number;
  levelsGainedMin: number; levelsGainedMax: number;
  kill: 'none' | 'possible' | 'guaranteed'; survival: 'none' | 'possible' | 'certain';
  sheetAdvancedCertain: boolean;
}
export interface Report {
  skill: boolean; path: FillEvent[]; damage: number; attackScore: number;
  shield: number; incoming: number; received: number; healed: number; charge: number;
  units: number; weak: number; defeated: boolean; fullClear: boolean; sweep: number[];
  hpBefore: number; enemyBefore: number;
  /** Optional for reports restored from earlier version-1 saves. */
  sheetAdvanced?: boolean; levelsGained?: number; spellLevelBefore?: number; spellLevelAfter?: number; maxHpGained?: number;
  chain?: ChainTrace;
  /** Clear bonus is additive after a proc, never amplified by it. */
  baseDamage?: number; guaranteedDamage?: number; clearBonus?: number; clearRatio?: number; oneCastClear?: boolean;
  manaOverflow?: number; manaRestored?: number; proc?: ProcOutcome;
}
/** Forecasts do not draw randomness, advance boards, or choose rewards. */
export interface Preview extends Report { forecast?: Forecast }
export interface Run {
  id: string; seed: number; randomState: number; revision: number;
  balanceVersion: 1 | 2; castCounter: number;
  character: CharacterId; skillRank: 1 | 2; stage: number; turn: number; phase: Phase;
  cells: number[]; solution: number[]; givens: boolean[]; marks: Mark[];
  puzzleOrder: number[]; puzzleCursor: number; sheet: number; encounterSheet: number; spellLevel: number;
  hp: number; maxHp: number; mana: number; manaOverflow: number; enemyHp: number;
  score: number; inventory: RelicId[]; pool: RelicId[]; rewards: RewardId[]; afterglow: boolean;
  acquisitionRank: Partial<Record<RelicId, number>>; tier: Partial<Record<RelicId, number>>;
  stats: { moves: number; filled: number; bestChain: number; kills: number; skills: number; sheets: number };
  lastReport: Report | null;
}
export type Action =
  | { type: 'play'; cell: number; skill: boolean; revision: number }
  | { type: 'reward'; relic: RewardId; revision: number };
export interface Meta { clears: number; runs: number; wins: number; bestScore: number; bestKills: number; tutorialDone: boolean }
export interface Settings { sound: boolean; fast: boolean; reducedMotion: boolean }
export interface Save { version: 1; meta: Meta; run: Run | null; settings: Settings }
