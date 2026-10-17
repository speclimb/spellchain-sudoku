import { describe, expect, it, vi } from 'vitest';
import { RELICS } from '../src/game/content';
import { dispatch, newSave, startRun } from '../src/game/engine';
import { needsRelicReplacement } from '../src/game/relic-slots';
import { canTakeReward, rollRelicRewards } from '../src/game/rewards';
import { parseSave } from '../src/game/storage';
import { Random } from '../src/game/sudoku';
import type { RelicId, RewardId, Run, Save } from '../src/game/types';

const support = ['training', 'vitality', 'recovery', 'magic-boon', 'defense-boon'];
const baseOf = (id: RewardId) => id.replace(/^(greater|apex):/, '') as RelicId;
const seedOf = (index: number) => Math.imul(index + 1, 0x9e3779b1) >>> 0;

function fixture(stage: number, level: number, tier: number): Save {
  const save = newSave(); save.meta.clears = 99;
  const next = startRun(save, 'fuse', 73), run = next.run!;
  run.inventory = RELICS.slice(0, 8).map(relic => relic.id);
  run.relicLevels = Object.fromEntries(run.inventory.map(id => [id, level]));
  run.acquisitionRank = Object.fromEntries(run.inventory.map(id => [id, 1]));
  run.tier = Object.fromEntries(run.inventory.map(id => [id, tier]));
  run.stage = stage; run.phase = 'reward'; run.rewardStep = 'relic'; run.enemyHp = 0;
  run.stats.kills = stage + 1; run.cells = [...run.solution];
  return next;
}

function expectLegalDistinct(run: Run, offers: RewardId[]): void {
  expect(offers).toHaveLength(3);
  expect(new Set(offers.map(baseOf)).size).toBe(3);
  expect(offers.every(id => canTakeReward(run, id))).toBe(true);
}

describe('full-inventory reward guarantees', () => {
  it.each([
    ['ordinary owned level-ups', 70, 6, 2, true],
    ['boss owned level-ups and evolutions', 74, 6, 2, true],
    ['boss Lv.10 with evolution left', 74, 10, 1, true],
    ['ordinary Lv.10', 70, 10, 1, false],
    ['ordinary completed build', 70, 10, 3, false],
    ['boss completed build', 74, 10, 3, false],
  ] as const)('always keeps the build for %s across 1000 seeds', (_name, stage, level, tier, ownedGrowth) => {
    const run = fixture(stage, level, tier).run!, original = structuredClone(run);
    expect(run.inventory).toHaveLength(8); expect(run.pool).toHaveLength(16);
    const seenSupport = new Set<string>();
    for (let index = 0; index < 1000; index++) {
      const random = new Random(seedOf(index)), replay = new Random(seedOf(index));
      const offers = rollRelicRewards(run, random);
      expect(rollRelicRewards(run, replay)).toEqual(offers); expect(replay.state).toBe(random.state);
      expectLegalDistinct(run, offers);
      expect(offers.filter(id => needsRelicReplacement(run, id))).toHaveLength(1);
      const owned = offers.filter(id => run.inventory.includes(baseOf(id)));
      const supports = offers.filter(id => support.includes(id));
      supports.forEach(id => seenSupport.add(id));
      if (ownedGrowth) {
        expect(owned).toHaveLength(1); expect(supports).toHaveLength(1);
        if (level === 10) expect(owned[0]).toMatch(/^(greater|apex):/);
        if (stage === 74 && tier === 1) expect(owned).toContain('greater:wick');
      } else {
        expect(owned).toHaveLength(0); expect(supports).toHaveLength(2);
        expect(supports).toContain('training');
        expect(supports.some(id => id !== 'training')).toBe(true);
      }
    }
    expect(run).toEqual(original);
    expect(seenSupport.has('vitality')).toBe(true); expect(seenSupport.has('recovery')).toBe(true);
    if (stage === 74) {
      expect(seenSupport.has('magic-boon')).toBe(true); expect(seenSupport.has('defense-boon')).toBe(true);
    } else {
      expect(seenSupport.has('magic-boon')).toBe(false); expect(seenSupport.has('defense-boon')).toBe(false);
    }
  });

  it.each([70, 74])('restores capped archived relic candidates at battle index %i without forcing replacement', stage => {
    const run = fixture(stage, 10, 3).run!;
    const archived = run.pool.filter(id => !run.inventory.includes(id));
    run.stowedRelics = Object.fromEntries(archived.map(id => [id, { level: 10, rank: 1, tier: 3 }]));
    const seen = new Set<string>();
    for (let index = 0; index < 1000; index++) {
      const offers = rollRelicRewards(run, new Random(seedOf(index)));
      expectLegalDistinct(run, offers); expect(offers).toContain('training');
      const restored = offers.filter(id => archived.includes(baseOf(id)));
      expect(restored).toHaveLength(1); seen.add(restored[0]);
      expect(offers.filter(id => !needsRelicReplacement(run, id))).toHaveLength(2);
    }
    expect(seen.size).toBe(archived.length);
  });

  it('does not reroll saved ordinary menus or pending boss menus on load and selection', () => {
    const ordinary = fixture(70, 10, 3);
    ordinary.run!.rewards = ['lens', 'glass', 'afterglow'];
    const loaded = parseSave(JSON.stringify(ordinary));
    expect(loaded).toEqual(ordinary);
    expect(loaded.run!.rewards.every(id => needsRelicReplacement(loaded.run!, id))).toBe(true);

    const boss = fixture(74, 10, 3), run = boss.run!;
    run.rewardStep = 'skill'; run.rewards = ['skill:fuse', 'skill:bridge', 'skill:pierce'];
    run.pendingRelicRewards = ['lens', 'glass', 'afterglow'];
    const pending = parseSave(JSON.stringify(boss)); expect(pending).toEqual(boss);
    const after = dispatch(pending, { type: 'reward', relic: 'skill:fuse', revision: run.revision });
    expect(after.run!.rewards).toEqual(run.pendingRelicRewards);
    expect(after.run!.randomState).toBe(run.randomState);
    expect(after.run!.pendingRelicRewards).toEqual([]);
    expect(parseSave(JSON.stringify(after))).toEqual(after);
  });

  it('accepts guaranteed training without a replacement and preserves the entire capped build', () => {
    const save = fixture(70, 10, 3), run = save.run!;
    const random = new Random(73); run.rewards = rollRelicRewards(run, random); run.randomState = random.state;
    const before = structuredClone(run), loaded = parseSave(JSON.stringify(save));
    const next = dispatch(loaded, { type: 'reward', relic: 'training', revision: run.revision });
    expect(next.run!.inventory).toEqual(before.inventory); expect(next.run!.relicLevels).toEqual(before.relicLevels);
    expect(next.run!.tier).toEqual(before.tier); expect(next.run!.stowedRelics).toEqual(before.stowedRelics);
    expect(next.run!.spellLevel).toBe(before.spellLevel + 1);
    expect(parseSave(JSON.stringify(next))).toEqual(next);
  });

  it('uses only the reward stream and leaves versionless sampling on its previous rules', () => {
    const run = fixture(70, 6, 2).run!, original = structuredClone(run);
    const unseeded = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected global RNG'); });
    try {
      const balanced = rollRelicRewards(run, new Random(73));
      expect(balanced.filter(id => support.includes(id))).toHaveLength(1); expect(run).toEqual(original);
      delete run.relicBalanceVersion;
      let withoutSupport = 0;
      for (let index = 0; index < 1000; index++) withoutSupport += Number(rollRelicRewards(run, new Random(seedOf(index))).every(id => !support.includes(id)));
      expect(withoutSupport).toBe(1000);
    } finally { unseeded.mockRestore(); }
  });
});
