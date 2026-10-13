import { REPEATABLE_REWARDS, characterOf, greaterIds, primeIds } from './content';
import type { Random } from './sudoku';
import type { GreaterRelicId, RelicId, RewardId, Run } from './types';

export function canTakeReward(run: Run, id: RewardId): boolean {
  const boss = run.balanceVersion === 2 && (run.stage + 1) % 5 === 0;
  if (id === 'skill-upgrade') return boss && run.skillRank < 2;
  if (id.startsWith('greater:')) {
    const relic = id.slice(8) as GreaterRelicId;
    return boss && greaterIds.includes(relic) && run.pool.includes(relic) && (run.tier[relic] ?? 1) < 2;
  }
  if (id === 'magic-boon' || id === 'defense-boon') return boss && greaterIds.every(relic => run.inventory.includes(relic) && run.tier[relic] === 2);
  if (REPEATABLE_REWARDS.some(reward => reward.id === id)) return true;
  if (boss) return false;
  const relic = id as RelicId;
  return run.pool.includes(relic) && (!run.inventory.includes(relic) || primeIds.includes(relic) && (run.acquisitionRank[relic] ?? 1) < 3);
}

/** Reward selection consumes only the caller's stream, never combat/proc randomness. */
export function rollRewards(run: Run, random: Random): RewardId[] {
  let chosen: RewardId[];
  if (run.balanceVersion === 2 && (run.stage + 1) % 5 === 0) {
    if (greaterIds.every(id => run.inventory.includes(id) && run.tier[id] === 2)) {
      return random.shuffle<RewardId>(['training', 'magic-boon', 'defense-boon']);
    }
    chosen = run.skillRank < 2 ? ['skill-upgrade'] : [];
    const eligible = random.shuffle(greaterIds.map(id => `greater:${id}` as RewardId).filter(id => canTakeReward(run, id)));
    // The two build-defining upgrades must stay visible until the player takes
    // them. Offering a missing upgrade does not grant it or replace their choice.
    const key = eligible.find(id => id === 'greater:lens' || id === 'greater:wick');
    const upper = key ? [key, ...eligible.filter(id => id !== key)] : eligible;
    chosen.push(...upper.slice(0, 2));
  } else {
    const available = random.shuffle(run.pool.filter(id => canTakeReward(run, id)));
    const match = available.find(id => characterOf(run.character).affinity.includes(id));
    chosen = match ? [match, ...available.filter(id => id !== match).slice(0, 2)] : available.slice(0, 3);
  }
  chosen.push(...random.shuffle(REPEATABLE_REWARDS.filter(reward => reward.id !== 'magic-boon' && reward.id !== 'defense-boon').map(reward => reward.id)).filter(id => !chosen.includes(id)).slice(0, 3 - chosen.length));
  return random.shuffle(chosen);
}
