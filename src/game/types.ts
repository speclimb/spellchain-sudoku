export type CharacterId = 'fuse' | 'scribe' | 'lumen';
export type SkillId = CharacterId | 'bridge' | 'pierce' | 'bastion';
export type RewardStep = 'legacy' | 'skill' | 'relic';
export type RelicId = 'wick' | 'echo' | 'rekindle' | 'pen' | 'ward' | 'stroke' | 'battery' | 'amplifier' | 'afterglow' | 'lens' | 'glass' | 'gold' | 'trinity' | 'duality' | 'quint' | 'sept';
export type PrimeRelicId = 'duality' | 'trinity' | 'quint' | 'sept';
export type RepeatableRewardId = 'training' | 'vitality' | 'recovery' | 'magic-boon' | 'defense-boon';
export type GreaterRelicId = 'stroke' | PrimeRelicId | 'lens' | 'wick';
export type RewardId = RelicId | RepeatableRewardId | 'skill-upgrade' | `greater:${GreaterRelicId}` | `apex:${RelicId}` | `skill:${SkillId}`;
export type Mark = 'weak' | 'shield' | null;
export type Phase = 'battle' | 'reward' | 'won' | 'lost';
export interface FillEvent {
  /** Global sheet identity; absent only in legacy single-sheet reports. */
  sheet?: number; sheetStart?: boolean;
  cell: number; value: number; ordinal: number; source: 'root' | 'echo' | 'chain';
  units: number[]; mark: Mark; hop?: boolean; bridge?: boolean;
}
export interface ChainStep {
  sheet?: number; sheetStart?: boolean;
  from: number | null; cell: number; source: FillEvent['source']; sharedUnits: number[];
  candidateValues: number[]; eligibleCells: number[]; tiedCells: number[]; initiallySingle: boolean;
  remainingBefore: number; remainingAfter: number; addedAuto: number; hop?: boolean; bridge?: boolean;
}
export interface ChainTrace {
  initialAuto: number; bonuses: { label: string; amount: number }[]; steps: ChainStep[];
  stopReason: 'limit' | 'no-target' | 'board-complete'; remainingAuto: number;
}
export interface ProcOutcome { id: 'trinity'; chance: number; multiplier: number; triggered: boolean }
export interface PrimeEffect { id: PrimeRelicId; chance: number; value: number }
export interface PrimeProcOutcome extends PrimeEffect { triggered: boolean }
export interface SheetSegment {
  /** State before this segment; pathEnd is exclusive. */
  sheet: number; cells: number[]; solution: number[]; givens: boolean[]; marks: Mark[];
  pathStart: number; pathEnd: number; baseDamage: number; clearBonus: number; clearRatio: number;
  fullClear: boolean; oneCastClear: boolean;
}
export interface Forecast {
  procs?: PrimeEffect[];
  damageMax: number; attackScoreMax: number; chance: number; multiplier: number;
  receivedMin: number; receivedMax: number; healedMin: number; healedMax: number;
  levelsGainedMin: number; levelsGainedMax: number;
  kill: 'none' | 'possible' | 'guaranteed'; survival: 'none' | 'possible' | 'certain';
  sheetAdvancedCertain: boolean;
}
export interface EffectMetric {
  heldCasts: number; opportunities: number; triggers: number; damage: number;
  addedInputs: number; fuelGranted: number; fuelUsed: number; mana: number;
  prevented: number; tokensGranted: number; tokensUsed: number; score: number;
}
export interface SkillMetric { uses: number; damage: number; hpDamage: number; overkill: number; level: number }
export interface BattleLedger {
  balanceVersion?: 1 | 2;
  stage: number; boss: boolean; casts: number; damage: number; hpDamage: number; overkill: number; score: number;
  skills: Partial<Record<SkillId, SkillMetric>>; relics: Partial<Record<RelicId, EffectMetric>>;
}
export interface ContributionHistory { sinceCast: number; partial: boolean; battles: BattleLedger[] }
export interface CastLedger {
  hpDamage: number; overkill: number; skillId?: SkillId; skillLevel?: number;
  relics: Partial<Record<RelicId, EffectMetric>>;
}
export interface Report {
  skillId?: SkillId; skillLevel?: number; extraDamage?: number; armorPrevented?: number; armorBroken?: boolean;
  ledger?: CastLedger; temporaryShield?: number; enemyStyle?: string;
  segments?: SheetSegment[]; sheetsCompleted?: number; freeSkill?: boolean; procs?: PrimeProcOutcome[];
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
/** Forecasts clone board RNG when needed; they never consume source state, roll procs, or choose rewards. */
export interface Preview extends Report { forecast?: Forecast }
export interface Run {
  id: string; seed: number; randomState: number; revision: number;
  balanceVersion: 1 | 2; castCounter: number;
  expansionVersion?: 1; enemyRulesVersion?: 0 | 1;
  /** Missing/zero preserves the HP of an already-started pre-rebalance battle. */
  enemyHealthVersion?: 0 | 1;
  skillLevels?: Partial<Record<SkillId, number>>; equippedSkills?: SkillId[];
  relicLevels?: Partial<Record<RelicId, number>>;
  rewardStep?: RewardStep; pendingRelicRewards?: RewardId[];
  contributions?: ContributionHistory;
  character: CharacterId; skillRank: 1 | 2; stage: number; turn: number; phase: Phase;
  cells: number[]; solution: number[]; givens: boolean[]; marks: Mark[];
  puzzleOrder: number[]; puzzleCursor: number; sheet: number; encounterSheet: number; spellLevel: number;
  freeSkillTokens: number; reservedAuto: number; boons: { defense: number; magic: number };
  hp: number; maxHp: number; mana: number; manaOverflow: number; enemyHp: number;
  score: number; inventory: RelicId[]; pool: RelicId[]; rewards: RewardId[]; afterglow: boolean;
  acquisitionRank: Partial<Record<RelicId, number>>; tier: Partial<Record<RelicId, number>>;
  stats: { moves: number; filled: number; bestChain: number; kills: number; skills: number; sheets: number };
  lastReport: Report | null;
}
export type Action =
  | { type: 'play'; cell: number; skill: boolean; skillId?: SkillId; revision: number }
  | { type: 'reward'; relic: RewardId; revision: number }
  | { type: 'equip'; skills: SkillId[]; revision: number };
export interface Meta { clears: number; runs: number; wins: number; bestScore: number; bestKills: number; tutorialDone: boolean }
export interface Settings { sound: boolean; fast: boolean; reducedMotion: boolean }
export interface Save { history?: import('./history').PlayHistory; version: 1; meta: Meta; run: Run | null; settings: Settings }
