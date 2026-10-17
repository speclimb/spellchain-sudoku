import type { Run } from './types';

export const RESCUE_LEVEL = 100;
export const RESCUE_ITEM_LEVEL = 200;
export const RESCUE_ITEM_INTERVAL = 100;
/** Includes the destination input; the other five units pay for reconnecting. */
export const RESCUE_COST = 6;
/** Number of items earned through this level, including every crossed milestone. */
export const rescueMilestonesAt = (level: number): number => Math.max(0, Math.floor((level - RESCUE_ITEM_LEVEL) / RESCUE_ITEM_INTERVAL) + 1);
export const canRescueChain = (run: Pick<Run, 'endgameBalanceVersion' | 'spellLevel' | 'rescueItems'>): boolean =>
  run.endgameBalanceVersion === 1 ? run.spellLevel >= RESCUE_LEVEL
    : run.endgameBalanceVersion === 2 && (run.rescueItems ?? 0) > 0;

/** Award only on growth or the next-encounter migration, never on save loading. */
export function awardRescueItems(run: Run): number {
  if (run.endgameBalanceVersion !== 2) return 0;
  const earned = rescueMilestonesAt(run.spellLevel), granted = Math.max(0, earned - (run.rescueMilestones ?? 0));
  run.rescueItems = (run.rescueItems ?? 0) + granted;
  run.rescueMilestones = earned;
  return granted;
}

export function activateLimitedRescue(run: Run): void {
  run.endgameBalanceVersion = 2;
  awardRescueItems(run);
}
