import { relicLevel, relicTierLevel } from './growth';
import type { RelicId, RewardId, Run } from './types';
import { fusionForRelic } from './fusions';

export const RELIC_CAPACITY = 8;

/** Skills and repeatable rewards never consume a relic slot. */
export function rewardRelicId(run: Run, id: RewardId): RelicId | undefined {
  const base = (id.startsWith('greater:') ? id.slice(8) : id.startsWith('apex:') ? id.slice(5) : id) as RelicId;
  return run.pool.includes(base) ? base : undefined;
}

export function needsRelicReplacement(run: Run, id: RewardId): boolean {
  const relic = rewardRelicId(run, id);
  return relic !== undefined && !run.inventory.includes(relic) && run.inventory.length >= RELIC_CAPACITY;
}

/** The reducer supplies a clone. Validate first, then retire exactly one relic;
 * acquisition and restoration are handled by the growth reward reducer. */
export function prepareRelicReward(run: Run, id: RewardId, replace?: RelicId): void {
  if (!needsRelicReplacement(run, id)) {
    if (replace !== undefined) throw new Error('この報酬では遺物を入れ替えられません。');
    return;
  }
  if (replace === undefined || !run.inventory.includes(replace)) throw new Error('入れ替える所持遺物を選んでください。');
  const fusion = fusionForRelic(run, replace);
  if (fusion) {
    // The fusion is indivisible. Archived components keep their growth, but
    // recovering them later requires a fresh boss fusion to restore the bonus.
    run.fusions = run.fusions?.filter(id => id !== fusion.id);
    for (const component of fusion.components) retireRelic(run, component);
    return;
  }
  retireRelic(run, replace);
}

function retireRelic(run: Run, replace: RelicId): void {
  const retired = { level: relicLevel(run, replace), rank: run.acquisitionRank[replace] ?? 1, tier: relicTierLevel(run, replace) };
  run.stowedRelics = { ...run.stowedRelics, [replace]: retired };
  run.inventory.splice(run.inventory.indexOf(replace), 1);
  delete run.relicLevels?.[replace];
  delete run.acquisitionRank[replace];
  delete run.tier[replace];
  if (replace === 'afterglow') run.afterglow = false;
  if (replace === 'quint') run.freeSkillTokens = 0;
  if (replace === 'sept') run.reservedAuto = 0;
  if (replace === 'battery') run.manaOverflow = 0;
  if (replace === 'glass') run.maxHp += 8;
}
