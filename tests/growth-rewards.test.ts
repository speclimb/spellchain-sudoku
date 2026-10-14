import { describe, expect, it } from 'vitest';
import { RELICS, greaterIds, primeIds, rewardOf } from '../src/game/content';
import { MAX_EQUIPPED_SKILLS, relicGrowthDescription, relicLevel, relicNextDescription, relicValues, selectedSkill, skillDescriptionFor, skillLevel, skillNextDescription, skillValues } from '../src/game/growth';
import { applyGrowthReward, canTakeReward, rollRelicRewards, rollRewards, rollSkillRewards } from '../src/game/rewards';
import { Random } from '../src/game/sudoku';
import type { CharacterId, RelicId, Run, SkillId } from '../src/game/types';
function fixture(character: CharacterId = 'fuse'): Run {
  return {
    id: 'growth-test', seed: 73, randomState: 73, revision: 0, balanceVersion: 2, castCounter: 0,
    expansionVersion: 1, enemyRulesVersion: 1, skillLevels: { [character]: 1 }, equippedSkills: [], relicLevels: {},
    character, skillRank: 1, stage: 4, turn: 0, phase: 'reward', rewardStep: 'skill', pendingRelicRewards: [],
    cells: [], solution: [], givens: [], marks: [], puzzleOrder: [], puzzleCursor: 0, sheet: 1, encounterSheet: 1, spellLevel: 1,
    freeSkillTokens: 0, reservedAuto: 0, boons: { defense: 0, magic: 0 }, hp: 40, maxHp: 40, mana: 0, manaOverflow: 0,
    enemyHp: 0, score: 0, inventory: [], pool: RELICS.map(relic => relic.id), rewards: [], afterglow: false,
    acquisitionRank: {}, tier: {}, stats: { moves: 0, filled: 0, bestChain: 0, kills: 5, skills: 0, sheets: 0 }, lastReport: null,
  };
}
function own(run: Run, id: RelicId, lv = 1, tier = 1, rank = 1): void {
  if (!run.inventory.includes(id)) run.inventory.push(id);
  run.relicLevels![id] = lv; run.tier[id] = tier; run.acquisitionRank[id] = rank;
}

describe('skill level definitions and selection', () => {
  it.each(['fuse', 'scribe', 'lumen'] as CharacterId[])('preserves %s legacy intrinsic ranks exactly', character => {
    const legacy = fixture(character); delete legacy.expansionVersion;
    for (const rank of [1, 2] as const) {
      legacy.skillRank = rank;
      const expanded = fixture(character); expanded.skillLevels![character] = rank; expanded.skillRank = rank;
      expect(skillValues(expanded, character)).toEqual(skillValues(legacy, character));
    }
    expect(skillValues(legacy, character)).toMatchObject(character === 'fuse' ? { auto: 4, fuseHops: 1 } : character === 'scribe' ? { completionMultiplier: 4 } : { damageMultiplier: 2.5 });
  });
  it('uses only one learned and equipped skill; intrinsic does not occupy a slot', () => {
    const run = fixture();
    expect(selectedSkill(run, false, 'bridge')).toBeUndefined();
    expect(selectedSkill(run, true)).toBe('fuse');
    expect(() => selectedSkill(run, true, 'bridge')).toThrow();
    applyGrowthReward(run, 'skill:bridge'); applyGrowthReward(run, 'skill:pierce'); applyGrowthReward(run, 'skill:bastion');
    expect(run.equippedSkills).toEqual(['bridge', 'pierce']); expect(run.equippedSkills).toHaveLength(MAX_EQUIPPED_SKILLS);
    expect(selectedSkill(run, true, 'bridge')).toBe('bridge'); expect(() => selectedSkill(run, true, 'bastion')).toThrow();
    expect(skillLevel(run, 'bastion')).toBe(1);
  });
  it('evolves bridge at five and ten and improves every level', () => {
    const run = fixture(); let previous = '';
    for (let lv = 1; lv <= 10; lv++) {
      run.skillLevels!.bridge = lv; const value = skillValues(run, 'bridge');
      expect(value.reconnects).toBe(lv < 5 ? 1 : lv < 10 ? 2 : 3);
      const current = JSON.stringify([value.auto, value.reconnects]); expect(current).not.toBe(previous); previous = current;
    }
    expect(skillNextDescription(run, 'bridge')).toContain('最大');
  });
  it.each(['pierce', 'bastion'] as SkillId[])('%s has meaningful five/ten evolutions and capped levels', id => {
    const run = fixture(); run.skillLevels![id] = 4;
    const before = skillValues(run, id); run.skillLevels![id] = 5; const evolved = skillValues(run, id);
    expect(evolved.evolution).toBe(2); expect(id === 'pierce' ? before.weakBurst : before.temporaryShield).toBe(0);
    expect(id === 'pierce' ? evolved.weakBurst : evolved.temporaryShield).toBeGreaterThan(0);
    run.skillLevels![id] = 10; expect(canTakeReward(run, `skill:${id}`)).toBe(false);
    applyGrowthReward(run, `skill:${id}`); expect(skillLevel(run, id)).toBe(10);
    expect(skillDescriptionFor(run, id)).toContain('追加攻撃');
  });
});

describe('relic independent level, rank and tier', () => {
  it.each(primeIds)('%s preserves all three original odds and upper effects during migration', id => {
    for (const rank of [1, 2, 3]) for (const tier of [1, 2]) {
      const run = fixture(); own(run, id, rank, tier, rank);
      const value = relicValues(run, id); expect(value.chance).toBe([.3, .45, .6][rank - 1]);
      expect(value.primeValue).toBe(id === 'trinity' ? (tier === 2 ? 2 : 1.5) : id === 'duality' ? (tier === 2 ? .5 : .25) : id === 'quint' ? tier : tier === 2 ? 14 : 7);
      delete run.expansionVersion; expect(relicValues(run, id).chance).toBe(value.chance); expect(relicValues(run, id).primeValue).toBe(value.primeValue);
    }
  });
  it('keeps rate, mitigation, free-token and tier caps finite', () => {
    const run = fixture(); run.rewardStep = 'relic';
    for (const id of primeIds) {
      own(run, id, 10, 3, 3); const value = relicValues(run, id);
      expect(value.chance).toBeLessThanOrEqual(.8);
      if (id === 'duality') expect(value.primeValue).toBeLessThanOrEqual(.6);
      if (id === 'quint') expect(value.primeValue).toBeLessThanOrEqual(3);
      if (id === 'sept') expect(relicGrowthDescription(run, id)).toContain('予約は1件');
      expect(canTakeReward(run, `apex:${id}`)).toBe(false);
    }
  });
  it.each(RELICS.map(relic => relic.id))('%s gains a real effect at high level and at upper/apex tiers', id => {
    const run = fixture(); own(run, id);
    const base = relicValues(run, id); run.relicLevels![id] = 10; const high = relicValues(run, id);
    const omit = ({ level: _level, tier: _tier, ...effects }: ReturnType<typeof relicValues>) => effects;
    expect(omit(high)).not.toEqual(omit(base));
    run.tier[id] = 2; const upper = relicValues(run, id); expect(omit(upper)).not.toEqual(omit(high));
    run.tier[id] = 3; expect(omit(relicValues(run, id))).not.toEqual(omit(upper));
    expect(relicGrowthDescription(run, id).length).toBeGreaterThan(10);
  });
  it('increments relic levels without repeated glass HP costs and promotes independently', () => {
    const run = fixture(); run.rewardStep = 'relic';
    applyGrowthReward(run, 'glass'); expect(run.maxHp).toBe(32);
    for (let i = 0; i < 8; i++) applyGrowthReward(run, 'glass');
    expect(relicLevel(run, 'glass')).toBe(9); expect(run.maxHp).toBe(32);
    expect(canTakeReward(run, 'apex:glass')).toBe(true); applyGrowthReward(run, 'apex:glass');
    expect(run.tier.glass).toBe(2); expect(relicLevel(run, 'glass')).toBe(9);
    applyGrowthReward(run, 'apex:glass'); expect(run.tier.glass).toBe(3); expect(run.acquisitionRank.glass).toBe(1);
  });
  it('requires level five for apex, with old upper availability preserved', () => {
    const run = fixture(); run.rewardStep = 'relic'; own(run, 'wick', 1, 1);
    expect(canTakeReward(run, 'greater:wick')).toBe(true); applyGrowthReward(run, 'greater:wick');
    expect(relicValues(run, 'wick')).toMatchObject({ auto: 2, carry: true });
    expect(canTakeReward(run, 'apex:wick')).toBe(false); run.relicLevels!.wick = 5;
    expect(canTakeReward(run, 'apex:wick')).toBe(true); expect(relicNextDescription(run, 'wick')).toContain('Lv.6');
  });
});

describe('two separate deterministic boss reward pools', () => {
  it('guarantees an unowned skill and relic when one remains', () => {
    const run = fixture(); run.skillLevels = { fuse: 8, bridge: 4, pierce: 9 };
    run.inventory = run.pool.filter(id => id !== 'lens'); run.relicLevels = Object.fromEntries(run.inventory.map(id => [id, 3]));
    for (let seed = 1; seed <= 100; seed++) {
      const skills = rollSkillRewards(run, new Random(seed));
      expect(skills).toHaveLength(3); expect(new Set(skills).size).toBe(3); expect(skills).toContain('skill:bastion');
      expect(skills.every(id => id.startsWith('skill:'))).toBe(true);
      expect(skills.some(id => id === 'skill:scribe' || id === 'skill:lumen')).toBe(false);
      const relics = rollRelicRewards(run, new Random(seed)); expect(relics).toHaveLength(3); expect(relics).toContain('lens');
      expect(relics.every(id => canTakeReward({ ...run, rewardStep: 'relic' }, id))).toBe(true);
    }
  });
  it('always offers both learning and intrinsic growth across 100 first-boss seeds', () => {
    const run = fixture();
    for (let seed = 1; seed <= 100; seed++) {
      const rewards = rollSkillRewards(run, new Random(seed));
      expect(rewards).toContain('skill:fuse');
      expect(rewards.some(id => ['skill:bridge', 'skill:pierce', 'skill:bastion'].includes(id))).toBe(true);
      expect(rewards).toHaveLength(3); expect(new Set(rewards).size).toBe(3);
      expect(rewards.every(id => id.startsWith('skill:') && canTakeReward(run, id))).toBe(true);
    }
  });
  it('always offers both a new relic and an owned upgrade across 100 boss seeds', () => {
    const run = fixture(); run.rewardStep = 'relic'; own(run, 'pen');
    for (let seed = 1; seed <= 100; seed++) {
      const rewards = rollRelicRewards(run, new Random(seed));
      expect(rewards.some(id => id === 'pen' || id === 'apex:pen')).toBe(true);
      expect(rewards.some(id => run.pool.includes(id as RelicId) && !run.inventory.includes(id as RelicId))).toBe(true);
      const bases = rewards.map(id => id.startsWith('apex:') ? id.slice(5) : id.startsWith('greater:') ? id.slice(8) : id);
      expect(rewards).toHaveLength(3); expect(new Set(bases).size).toBe(3);
      expect(rewards.every(id => canTakeReward(run, id))).toBe(true);
      expect(rewards.every(id => !['training', 'vitality', 'recovery', 'magic-boon', 'defense-boon'].includes(id))).toBe(true);
    }
  });
  it('rolls the relic step in advance without mutating the skill-step run', () => {
    const run = fixture(), serialized = JSON.stringify(run), random = new Random(76);
    const result = rollRelicRewards(run, random);
    expect(JSON.stringify(run)).toBe(serialized); expect(random.state).not.toBe(76);
    expect(rollRelicRewards(run, new Random(76))).toEqual(result);
    expect(rollRewards(run, new Random(76))).toEqual(rollSkillRewards(run, new Random(76)));
  });
  it('fills all exhausted choices without duplicates', () => {
    const run = fixture(); run.skillLevels = { fuse: 10, bridge: 10, pierce: 10, bastion: 10 };
    expect(rollSkillRewards(run, new Random(1)).sort()).toEqual(['recovery', 'training', 'vitality']);
    run.inventory = [...run.pool]; run.relicLevels = Object.fromEntries(run.pool.map(id => [id, 10])); run.tier = Object.fromEntries(run.pool.map(id => [id, 3]));
    expect(rollRelicRewards(run, new Random(1)).sort()).toEqual(['defense-boon', 'magic-boon', 'training']);
    run.stage = 5; expect(rollRelicRewards(run, new Random(1)).sort()).toEqual(['recovery', 'training', 'vitality']);
  });
  it('does not reinterpret sampled legacy boss choices', () => {
    const run = fixture(); run.rewardStep = 'legacy';
    expect(canTakeReward(run, 'skill-upgrade')).toBe(true); expect(canTakeReward(run, 'greater:wick')).toBe(true);
    expect(canTakeReward(run, 'skill:bridge')).toBe(false);
    const old = structuredClone(run); delete old.expansionVersion;
    expect(rollRewards(run, new Random(4))).toEqual(rollRewards(old, new Random(4)));
    applyGrowthReward(run, 'skill-upgrade'); expect(skillLevel(run, 'fuse')).toBe(2);
    run.skillRank = 1; run.skillLevels!.fuse = 7; applyGrowthReward(run, 'skill-upgrade'); expect(skillLevel(run, 'fuse')).toBe(7);
    run.inventory = [...greaterIds]; run.tier = Object.fromEntries(greaterIds.map(id => [id, 2]));
    expect(rollRewards(run, new Random(2)).sort()).toEqual(['defense-boon', 'magic-boon', 'training']);
  });
  it('describes current→next effects and milestones', () => {
    const run = fixture(); run.skillLevels!.bridge = 4;
    expect(rewardOf('skill:bridge', run).name).toContain('4→5'); expect(rewardOf('skill:bridge', run).description).toContain('→');
    run.rewardStep = 'relic'; own(run, 'lens', 5, 2);
    expect(rewardOf('apex:lens', run).name).toContain('極位'); expect(rewardOf('lens', run).description).toContain('→');
    expect(rewardOf('lens', run).name).toContain('5→6');
    expect(skillNextDescription(run, 'bridge')).toContain('進化');
  });
});
