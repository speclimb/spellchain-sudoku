export type CharacterId = 'fuse' | 'scribe' | 'lumen';
export type RelicId = 'wick' | 'echo' | 'rekindle' | 'pen' | 'ward' | 'stroke' | 'battery' | 'amplifier' | 'afterglow' | 'lens' | 'glass' | 'gold';
export type Mark = 'weak' | 'shield' | null;
export type Phase = 'battle' | 'reward' | 'won' | 'lost';
export interface FillEvent {
  cell: number; value: number; ordinal: number; source: 'root' | 'echo' | 'chain';
  units: number[]; mark: Mark;
}
export interface ChainStep {
  from: number | null; cell: number; source: FillEvent['source']; sharedUnits: number[];
  candidateValues: number[]; eligibleCells: number[]; tiedCells: number[]; initiallySingle: boolean;
  remainingBefore: number; remainingAfter: number; addedAuto: number;
}
export interface ChainTrace {
  initialAuto: number; bonuses: { label: string; amount: number }[]; steps: ChainStep[];
  stopReason: 'limit' | 'no-target' | 'board-complete'; remainingAuto: number;
}
export interface Report {
  skill: boolean; path: FillEvent[]; damage: number; attackScore: number;
  shield: number; incoming: number; received: number; healed: number; charge: number;
  units: number; weak: number; defeated: boolean; fullClear: boolean; sweep: number[];
  hpBefore: number; enemyBefore: number;
  /** Optional for reports restored from the original version-1 format. */
  sheetAdvanced?: boolean; levelsGained?: number; spellLevelBefore?: number; spellLevelAfter?: number; maxHpGained?: number;
  /** Older version-1 saves may not contain explanatory metadata. */
  chain?: ChainTrace;
}
export interface Run {
  id: string; seed: number; randomState: number; revision: number;
  character: CharacterId; stage: number; turn: number; phase: Phase;
  cells: number[]; solution: number[]; givens: boolean[]; marks: Mark[];
  puzzleOrder: number[]; puzzleCursor: number; sheet: number; encounterSheet: number; spellLevel: number;
  hp: number; maxHp: number; mana: number; enemyHp: number;
  score: number; inventory: RelicId[]; pool: RelicId[]; rewards: RelicId[]; afterglow: boolean;
  stats: { moves: number; filled: number; bestChain: number; kills: number; skills: number; sheets: number };
  lastReport: Report | null;
}
export type Action =
  | { type: 'play'; cell: number; skill: boolean; revision: number }
  | { type: 'reward'; relic: RelicId; revision: number };
export interface Meta { clears: number; runs: number; wins: number; bestScore: number; tutorialDone: boolean }
export interface Settings { sound: boolean; fast: boolean; reducedMotion: boolean }
export interface Save { version: 1; meta: Meta; run: Run | null; settings: Settings }
