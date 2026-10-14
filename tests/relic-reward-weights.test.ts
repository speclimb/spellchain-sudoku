import { describe, expect, it, vi } from 'vitest';
import { RELICS } from '../src/game/content';
import { canTakeReward, rollRelicRewards, rollRewards } from '../src/game/rewards';
import { Random } from '../src/game/sudoku';
import type { CharacterId, RelicId, RewardId, Run } from '../src/game/types';

function fixture(stage = 4, character: CharacterId = 'fuse'): Run {
  return {
    id: 'reward-weights', seed: 73, randomState: 73, revision: 0, balanceVersion: 2, castCounter: 0,
    expansionVersion: 1, skillLevels: { [character]: 1 }, equippedSkills: [], relicLevels: {},
    character, skillRank: 1, stage, turn: 0, phase: 'reward', rewardStep: 'relic', pendingRelicRewards: [],
    cells: [], solution: [], givens: [], marks: [], puzzleOrder: [], puzzleCursor: 0, sheet: 1, encounterSheet: 1, spellLevel: 1,
    freeSkillTokens: 0, reservedAuto: 0, boons: { defense: 0, magic: 0 }, hp: 40, maxHp: 40, mana: 0, manaOverflow: 0,
    enemyHp: 0, score: 0, inventory: [], pool: RELICS.map(relic => relic.id), rewards: [], afterglow: false,
    acquisitionRank: {}, tier: {}, stats: { moves: 0, filled: 0, bestChain: 0, kills: stage + 1, skills: 0, sheets: 0 }, lastReport: null,
  };
}
function own(run: Run, id: RelicId, level = 1, tier = 1): void {
  run.inventory.push(id); run.relicLevels![id] = level; run.tier[id] = tier; run.acquisitionRank[id] = 1;
}
const evolution = (id: RewardId) => id.startsWith('greater:') || id.startsWith('apex:');
const baseOf = (id: RewardId) => id.replace(/^(greater|apex):/, '') as RelicId;
const seedOf = (index: number) => Math.imul(index + 1, 0x9e3779b1) >>> 0;
function offersAtDraw(run: Run, value: number): RewardId[] {
  const random = new Random(1); random.next = () => value;
  return rollRelicRewards(run, random);
}

describe('level-aware evolution weights', () => {
  it.each([
    [1, 2], [2, 2], [3, 3], [4, 3], [5, 4], [6, 4], [7, 4], [8, 5], [9, 5],
  ])('at level %i uses evolution weight %i only when both variants qualify', (level, weight) => {
    for (const id of ['pen', 'trinity'] as RelicId[]) {
      const run = fixture(); run.pool = [id]; own(run, id, level);
      const cutoff = weight / (weight + 1);
      expect(offersAtDraw(run, cutoff - .000001).some(evolution)).toBe(true);
      expect(offersAtDraw(run, cutoff + .000001)).toContain(id);
      expect(offersAtDraw(run, cutoff + .000001).some(evolution)).toBe(false);
    }
  });

  it('monotonically increases conditional evolution offers, then removes capped level-ups', () => {
    const counts: number[] = [];
    for (let level = 1; level <= 10; level++) {
      const run = fixture(); run.pool = ['pen']; own(run, 'pen', level);
      let count = 0;
      for (let seed = 0; seed < 2000; seed++) count += Number(rollRelicRewards(run, new Random(seedOf(seed))).some(evolution));
      counts.push(count);
    }
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0] / 2000).toBeCloseTo(2 / 3, 2);
    expect(counts[2] / 2000).toBeCloseTo(3 / 4, 2);
    expect(counts[4] / 2000).toBeCloseTo(4 / 5, 2);
    expect(counts[7] / 2000).toBeCloseTo(5 / 6, 2);
    expect(counts[9]).toBe(2000);
  });

  it('keeps evolution boss-only and requires Lv.5 for the upper-to-apex step', () => {
    for (const id of ['pen', 'trinity'] as RelicId[]) for (let level = 1; level <= 10; level++) {
      for (const tier of [1, 2, 3]) for (const stage of [3, 4, 5, 9]) {
        const run = fixture(stage); run.pool = [id]; own(run, id, level, tier);
        for (const draw of [0, .999999]) {
          const offers = offersAtDraw(run, draw);
          expect(offers.every(reward => canTakeReward(run, reward))).toBe(true);
          if ((stage + 1) % 5 || tier === 3 || tier === 2 && level < 5) expect(offers.some(evolution)).toBe(false);
          if (level === 10) expect(offers).not.toContain(id);
        }
      }
    }
  });
});

describe('weighted three-choice selection', () => {
  it('modestly favors owned growth in the ordinary flexible slot and keeps both guaranteed categories', () => {
    const run = fixture(5);
    for (const id of ['echo', 'rekindle', 'pen', 'ward', 'battery', 'glass', 'trinity', 'sept'] as RelicId[]) own(run, id, 3);
    let secondOwned = 0;
    for (let index = 0; index < 6000; index++) {
      const offers = rollRelicRewards(run, new Random(seedOf(index)));
      const owned = offers.filter(id => run.inventory.includes(baseOf(id))).length;
      expect(offers).toContain('wick'); expect(owned).toBeGreaterThanOrEqual(1);
      expect(offers.some(evolution)).toBe(false);
      expect(new Set(offers.map(baseOf)).size).toBe(3);
      secondOwned += Number(owned === 2);
    }
    // After the two guarantees, seven owned and seven missing remain.
    expect(secondOwned / 6000).toBeGreaterThan(.55);
    expect(secondOwned / 6000).toBeLessThan(.60);
  });

  it('favors a boss evolution without letting affinity hide every non-affinity evolution', () => {
    const run = fixture(); run.pool = ['echo', 'pen', 'gold', 'glass', 'battery', 'ward'];
    own(run, 'echo', 3, 3); own(run, 'pen', 10);
    let seen = 0;
    for (let index = 0; index < 1000; index++) {
      const offers = rollRelicRewards(run, new Random(seedOf(index)));
      expect(offers.some(id => !run.inventory.includes(baseOf(id)))).toBe(true);
      seen += Number(offers.includes('apex:pen'));
    }
    expect(seen).toBeGreaterThan(700);
  });

  it.each(['fuse', 'scribe', 'lumen'] as CharacterId[])('keeps all %s candidates legal and distinct across level/tier exhaustion', character => {
    for (const stage of [0, 1, 2, 4, 5, 9]) for (const level of [1, 4, 5, 9, 10]) {
      const run = fixture(stage, character);
      for (let i = 0; i < run.pool.length - 1; i++) own(run, run.pool[i], level, i % 3 + 1);
      const original = structuredClone(run);
      for (let index = 0; index < 30; index++) {
        const offers = rollRelicRewards(run, new Random(seedOf(index)));
        expect(offers).toHaveLength(3); expect(new Set(offers.map(baseOf)).size).toBe(3);
        expect(offers.every(id => canTakeReward(run, id))).toBe(true);
        expect(offers).toContain(run.pool[run.pool.length - 1]);
        const hasOwnedCandidate = run.inventory.some(id => canTakeReward(run, id) || canTakeReward(run, `apex:${id}`) || canTakeReward(run, `greater:${id}` as RewardId));
        if (hasOwnedCandidate) expect(offers.some(id => run.inventory.includes(baseOf(id)))).toBe(true);
      }
      expect(run).toEqual(original);
    }
  });

  it('never inserts an exhausted relic and uses the existing terminal filler sets', () => {
    const run = fixture();
    for (const id of run.pool) own(run, id, 10, 3);
    expect(rollRelicRewards(run, new Random(73)).sort()).toEqual(['defense-boon', 'magic-boon', 'training']);
    run.stage = 5;
    expect(rollRelicRewards(run, new Random(73)).sort()).toEqual(['recovery', 'training', 'vitality']);
  });

  it('uses only the supplied reward RNG, without mutating live or pending state', () => {
    const run = fixture(); own(run, 'echo', 4); own(run, 'pen', 8);
    run.pendingRelicRewards = ['wick', 'pen', 'lens']; run.rewards = ['skill:fuse', 'skill:bridge', 'skill:pierce'];
    const original = structuredClone(run), random = new Random(73), replay = new Random(73);
    const unseeded = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected global RNG'); });
    try {
      const offers = rollRelicRewards(run, random);
      expect(rollRelicRewards(run, replay)).toEqual(offers); expect(replay.state).toBe(random.state);
      expect(random.state).not.toBe(73); expect(run).toEqual(original);
    } finally { unseeded.mockRestore(); }
  });

  it('retains fixed-seed no-owned and legacy rolls exactly', () => {
    const run = fixture(0), random = new Random(73);
    expect(rollRewards(run, random)).toEqual(['glass', 'echo', 'sept']); expect(random.state).toBe(775954742);
    run.stage = 4; run.rewardStep = 'legacy';
    const legacy = new Random(73);
    expect(rollRewards(run, legacy)).toEqual(['skill-upgrade', 'greater:quint', 'greater:wick']);
    expect(legacy.state).toBe(3330908523);
  });
});
