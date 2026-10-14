import { REPEATABLE_REWARDS, characterOf, greaterIds, primeIds } from './content';
import type { Random } from './sudoku';
import type { GreaterRelicId, RelicId, RewardId, Run, SkillId } from './types';
import { MAX_EQUIPPED_SKILLS, SKILLS, relicLevel, relicTierLevel, skillLevel } from './growth';

function canTakeLegacyReward(run: Run, id: RewardId): boolean {
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
function rollLegacyRewards(run: Run, random: Random): RewardId[] {
  let chosen: RewardId[];
  if (run.balanceVersion === 2 && (run.stage + 1) % 5 === 0) {
    if (greaterIds.every(id => run.inventory.includes(id) && run.tier[id] === 2)) {
      return random.shuffle<RewardId>(['training', 'magic-boon', 'defense-boon']);
    }
    chosen = run.skillRank < 2 ? ['skill-upgrade'] : [];
    const eligible = random.shuffle(greaterIds.map(id => `greater:${id}` as RewardId).filter(id => canTakeLegacyReward(run, id)));
    // The two build-defining upgrades must stay visible until the player takes
    // them. Offering a missing upgrade does not grant it or replace their choice.
    const key = eligible.find(id => id === 'greater:lens' || id === 'greater:wick');
    const upper = key ? [key, ...eligible.filter(id => id !== key)] : eligible;
    chosen.push(...upper.slice(0, 2));
  } else {
    const available = random.shuffle(run.pool.filter(id => canTakeLegacyReward(run, id)));
    const match = available.find(id => characterOf(run.character).affinity.includes(id));
    chosen = match ? [match, ...available.filter(id => id !== match).slice(0, 2)] : available.slice(0, 3);
  }
  chosen.push(...random.shuffle(REPEATABLE_REWARDS.filter(reward => reward.id !== 'magic-boon' && reward.id !== 'defense-boon').map(reward => reward.id)).filter(id => !chosen.includes(id)).slice(0, 3 - chosen.length));
  return random.shuffle(chosen);
}

const isBoss = (run: Run) => run.balanceVersion === 2 && (run.stage + 1) % 5 === 0;
const basicRepeatables: RewardId[] = ['training', 'vitality', 'recovery'];
function isRelicId(run: Run, value: string): value is RelicId { return run.pool.includes(value as RelicId); }

/** Already sampled legacy choices keep their original eligibility and meaning. */
export function canTakeReward(run: Run, id: RewardId): boolean {
  if (!run.expansionVersion || run.rewardStep === 'legacy') return canTakeLegacyReward(run, id);
  const boss = isBoss(run), step = run.rewardStep ?? (boss ? 'skill' : 'relic');
  if (id.startsWith('skill:')) {
    const skill = id.slice(6) as SkillId;
    return boss && step === 'skill' && SKILLS.some(entry => entry.id === skill) && [run.character, 'bridge', 'pierce', 'bastion'].includes(skill) && skillLevel(run, skill) < 10;
  }
  if (id === 'skill-upgrade') return boss && step === 'skill' && run.skillRank < 2;
  if (REPEATABLE_REWARDS.some(reward => reward.id === id)) return basicRepeatables.includes(id) || boss && step === 'relic';
  if (step !== 'relic') return false;
  if (id.startsWith('greater:')) {
    const relic = id.slice(8) as GreaterRelicId;
    return boss && greaterIds.includes(relic) && run.pool.includes(relic) && relicTierLevel(run, relic) < 2;
  }
  if (id.startsWith('apex:')) {
    const relic = id.slice(5) as RelicId, tier = relicTierLevel(run, relic);
    return boss && isRelicId(run, relic) && run.inventory.includes(relic) && tier < 3 && (tier === 1 || relicLevel(run, relic) >= 5);
  }
  return isRelicId(run, id) && relicLevel(run, id) < 10;
}
function fillChoices(chosen: RewardId[], random: Random): RewardId[] {
  chosen.push(...random.shuffle(basicRepeatables).filter(id => !chosen.includes(id)).slice(0, 3 - chosen.length));
  return random.shuffle(chosen);
}
export function rollSkillRewards(run: Run, random: Random): RewardId[] {
  const context: Run = { ...run, rewardStep: 'skill' };
  const available = random.shuffle(SKILLS.map(skill => `skill:${skill.id}` as RewardId).filter(id => canTakeReward(context, id)));
  const missing = available.find(id => !skillLevel(run, id.slice(6) as SkillId));
  const upgrade = available.find(id => skillLevel(run, id.slice(6) as SkillId) > 0);
  const chosen = [missing, upgrade].filter((id): id is RewardId => id !== undefined);
  chosen.push(...available.filter(id => !chosen.includes(id)).slice(0, 3 - chosen.length));
  return fillChoices(chosen, random);
}
/** One candidate per relic, so a new acquisition and its upper version never
 * consume two of the three choices. A missing relic and an owned upgrade each
 * receive one guaranteed slot while those categories remain available. */
export function rollRelicRewards(run: Run, random: Random): RewardId[] {
  const context: Run = { ...run, rewardStep: 'relic' };
  // Keep the cross-sheet path visible in newly rolled growth rewards. It uses
  // the existing missing/owned slot, remains optional, and never rewrites saves.
  const wickOffer: RewardId | undefined = run.expansionVersion && run.balanceVersion === 2 && run.rewardStep !== 'legacy'
    ? run.inventory.includes('wick') ? 'greater:wick' : run.stage >= 2 ? 'wick' : undefined
    : undefined;
  const candidates: RewardId[] = [];
  for (const relic of run.pool) {
    const variants: RewardId[] = [relic];
    if (isBoss(run) && run.inventory.includes(relic)) {
      if (greaterIds.includes(relic as GreaterRelicId) && relicTierLevel(run, relic) === 1) variants.push(`greater:${relic as GreaterRelicId}`);
      else variants.push(`apex:${relic}`);
    }
    const eligible = variants.filter(id => canTakeReward(context, id));
    if (eligible.length) {
      const sampled = random.shuffle(eligible)[0];
      candidates.push(wickOffer && eligible.includes(wickOffer) ? wickOffer : sampled);
    }
  }
  if (!candidates.length && isBoss(run)) return random.shuffle<RewardId>(['training', 'magic-boon', 'defense-boon']);
  const available = random.shuffle(candidates);
  const relicIdOf = (id: RewardId) => (id.startsWith('greater:') ? id.slice(8) : id.startsWith('apex:') ? id.slice(5) : id) as RelicId;
  const missingCandidates = available.filter(id => isRelicId(run, id) && !run.inventory.includes(id));
  const affinityIds = characterOf(run.character).affinity;
  const missing = missingCandidates.find(id => id === wickOffer) ?? missingCandidates.find(id => affinityIds.includes(id as RelicId)) ?? missingCandidates[0];
  const upgradeCandidates = available.filter(id => run.inventory.includes(relicIdOf(id)));
  const upgrade = upgradeCandidates.find(id => id === wickOffer) ?? upgradeCandidates.find(id => affinityIds.includes(relicIdOf(id))) ?? upgradeCandidates[0];
  const chosen = [missing, upgrade].filter((id): id is RewardId => id !== undefined);
  chosen.push(...available.filter(id => !chosen.includes(id)).slice(0, 3 - chosen.length));
  return fillChoices(chosen, random);
}
export function rollRewards(run: Run, random: Random): RewardId[] {
  if (!run.expansionVersion || run.rewardStep === 'legacy') return rollLegacyRewards(run, random);
  return (run.rewardStep ?? (isBoss(run) ? 'skill' : 'relic')) === 'skill' ? rollSkillRewards(run, random) : rollRelicRewards(run, random);
}
/** Mutates only the already-cloned run. Returns false for ordinary repeatables
 * and pre-expansion runs, whose legacy reducers remain the source of truth. */
export function applyGrowthReward(run: Run, id: RewardId): boolean {
  if (!run.expansionVersion) return false;
  if (id === 'skill-upgrade') {
    run.skillRank = 2; run.skillLevels = { ...run.skillLevels, [run.character]: Math.max(2, skillLevel(run, run.character)) }; return true;
  }
  if (id.startsWith('skill:')) {
    const skill = id.slice(6) as SkillId;
    if (!SKILLS.some(entry => entry.id === skill) || ![run.character, 'bridge', 'pierce', 'bastion'].includes(skill)) return false;
    const before = skillLevel(run, skill);
    run.skillLevels = { ...run.skillLevels, [skill]: Math.min(10, before + 1) };
    if (skill === run.character) run.skillRank = run.skillLevels[skill]! >= 2 ? 2 : 1;
    else if (!before && (run.equippedSkills?.length ?? 0) < MAX_EQUIPPED_SKILLS) run.equippedSkills = [...(run.equippedSkills ?? []), skill];
    return true;
  }
  const greater = id.startsWith('greater:'), apex = id.startsWith('apex:');
  const relic = (greater ? id.slice(8) : apex ? id.slice(5) : id) as RelicId;
  if (!isRelicId(run, relic)) return false;
  const before = relicLevel(run, relic), oldTier = relicTierLevel(run, relic);
  if (!before) {
    run.inventory.push(relic); run.acquisitionRank[relic] = 1;
    run.relicLevels = { ...run.relicLevels, [relic]: 1 };
    if (relic === 'glass') { run.maxHp -= 8; run.hp = Math.min(run.hp, run.maxHp); }
  } else if (!greater && !apex) {
    // Legacy prime rewards are acquisition upgrades only; do not reinterpret a
    // previously sampled choice as a new kind of bonus during migration.
    run.relicLevels = { ...run.relicLevels, [relic]: run.rewardStep === 'legacy' ? before : Math.min(10, before + 1) };
    if (primeIds.includes(relic)) run.acquisitionRank[relic] = Math.min(3, (run.acquisitionRank[relic] ?? 1) + 1);
  }
  if (greater) run.tier[relic] = 2;
  if (apex) run.tier[relic] = Math.min(3, oldTier + 1);
  return true;
}
