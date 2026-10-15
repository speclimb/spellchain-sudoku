import { describe, expect, it } from 'vitest';
import { RELICS } from '../src/game/content';
import { newSave, startRun } from '../src/game/engine';
import { relicValues } from '../src/game/growth';
import { RELIC_CAPACITY, needsRelicReplacement, prepareRelicReward, rewardRelicId } from '../src/game/relic-slots';
import { applyGrowthReward } from '../src/game/rewards';
import type { RewardId, Run } from '../src/game/types';

function fixture(count = RELIC_CAPACITY): Run {
  const save = newSave(); save.meta.clears = 99;
  const run = startRun(save, 'fuse', 73).run!;
  run.inventory = RELICS.slice(0, count).map(relic => relic.id);
  for (const id of run.inventory) {
    run.relicLevels![id] = 5; run.acquisitionRank[id] = 1; run.tier[id] = 2;
  }
  return run;
}

describe('eight-slot relic exchange', () => {
  it('resolves base, greater and apex rewards without treating skills or growth as relics', () => {
    const run = fixture();
    expect(RELIC_CAPACITY).toBe(8);
    for (const id of ['lens', 'greater:lens', 'apex:lens'] as RewardId[]) expect(rewardRelicId(run, id)).toBe('lens');
    for (const id of ['training', 'recovery', 'vitality', 'magic-boon', 'defense-boon', 'skill-upgrade', 'skill:fuse'] as RewardId[]) {
      expect(rewardRelicId(run, id)).toBeUndefined();
      expect(needsRelicReplacement(run, id)).toBe(false);
    }
    run.pool = run.pool.filter(id => id !== 'lens');
    expect(rewardRelicId(run, 'lens')).toBeUndefined();
  });

  it('requires one held replacement only for an incoming new relic at capacity', () => {
    const run = fixture();
    expect(needsRelicReplacement(run, 'gold')).toBe(true);
    expect(needsRelicReplacement(run, 'greater:lens')).toBe(true);
    expect(needsRelicReplacement(run, 'wick')).toBe(false);
    expect(needsRelicReplacement(run, 'greater:wick')).toBe(false);
    expect(needsRelicReplacement(fixture(7), 'gold')).toBe(false);
    const original = structuredClone(run);
    expect(() => prepareRelicReward(run, 'gold')).toThrow();
    expect(() => prepareRelicReward(run, 'gold', 'lens')).toThrow();
    expect(run).toEqual(original);
    for (const id of ['wick', 'greater:wick', 'training', 'skill:fuse'] as RewardId[]) expect(() => prepareRelicReward(run, id, 'pen')).toThrow();
    expect(run).toEqual(original);
    const vacant = fixture(7), before = structuredClone(vacant);
    expect(() => prepareRelicReward(vacant, 'gold', 'pen')).toThrow();
    expect(vacant).toEqual(before);
  });

  it('archives growth and removes only active ownership without acquiring the new relic', () => {
    const run = fixture();
    run.relicLevels!.pen = 9; run.tier.pen = 3;
    const rng = run.randomState;
    prepareRelicReward(run, 'gold', 'pen');
    expect(run.inventory).toHaveLength(7);
    expect(run.inventory).not.toContain('pen');
    expect(run.inventory).not.toContain('gold');
    expect(run.stowedRelics).toEqual({ pen: { level: 9, rank: 1, tier: 3 } });
    expect(run.relicLevels!.pen).toBeUndefined();
    expect(run.acquisitionRank.pen).toBeUndefined();
    expect(run.tier.pen).toBeUndefined();
    expect(relicValues(run, 'pen').completion).toBe(0);
    expect(run.pool).toContain('pen');
    expect(run.randomState).toBe(rng);
  });

  it.each([
    ['afterglow', 'afterglow', true, false],
    ['quint', 'freeSkillTokens', 2, 0],
    ['sept', 'reservedAuto', 14, 0],
    ['battery', 'manaOverflow', 3, 0],
  ] as const)('clears the transient %s effect when retiring it', (id, field, initial, expected) => {
    const run = fixture();
    run.inventory = [...run.inventory.filter(held => held !== id).slice(0, 7), id];
    run.relicLevels![id] = 5; run.acquisitionRank[id] = id === 'quint' || id === 'sept' ? 3 : 1; run.tier[id] = 2;
    Object.assign(run, { [field]: initial });
    prepareRelicReward(run, 'gold', id);
    expect(run[field]).toBe(expected);
    expect(run.stowedRelics![id]).toEqual({ level: 5, rank: id === 'quint' || id === 'sept' ? 3 : 1, tier: 2 });
  });

  it('restores the glass HP ceiling without healing or deleting other archived growth', () => {
    const run = fixture(); run.inventory[0] = 'glass';
    run.relicLevels!.glass = 8; run.acquisitionRank.glass = 1; run.tier.glass = 3;
    run.stowedRelics = { lens: { level: 6, rank: 1, tier: 2 } };
    run.maxHp = 32; run.hp = 10;
    prepareRelicReward(run, 'gold', 'glass');
    expect(run.maxHp).toBe(40); expect(run.hp).toBe(10);
    expect(run.stowedRelics).toEqual({ lens: { level: 6, rank: 1, tier: 2 }, glass: { level: 8, rank: 1, tier: 3 } });
  });

  it('keeps old oversized runs on a one-for-one exchange path', () => {
    const run = fixture(10);
    expect(needsRelicReplacement(run, 'gold')).toBe(true);
    prepareRelicReward(run, 'gold', 'pen');
    expect(run.inventory).toHaveLength(9);
    // The acquisition reducer adds the incoming relic only after preparation.
    run.inventory.push('gold');
    expect(run.inventory).toHaveLength(10);
    expect(run.stowedRelics!.pen).toEqual({ level: 5, rank: 1, tier: 2 });
  });

  it('restores capped prime growth without incrementing it or restoring consumed transient resources', () => {
    const run = fixture(); run.inventory[0] = 'quint';
    run.relicLevels!.quint = 10; run.acquisitionRank.quint = 3; run.tier.quint = 3; run.freeSkillTokens = 3;
    prepareRelicReward(run, 'gold', 'quint'); applyGrowthReward(run, 'gold');
    expect(run.freeSkillTokens).toBe(0);
    prepareRelicReward(run, 'quint', 'gold'); applyGrowthReward(run, 'quint');
    expect(run.relicLevels!.quint).toBe(10); expect(run.acquisitionRank.quint).toBe(3); expect(run.tier.quint).toBe(3);
    expect(run.freeSkillTokens).toBe(0); expect(run.stowedRelics!.quint).toBeUndefined();
    expect(run.inventory).toHaveLength(8);
  });

  it('reapplies only the glass ownership HP cost when repeatedly reacquiring saved growth', () => {
    const run = fixture(); run.inventory[0] = 'glass';
    run.relicLevels!.glass = 8; run.acquisitionRank.glass = 1; run.tier.glass = 3;
    run.maxHp = 32; run.hp = 25;
    for (let cycle = 0; cycle < 3; cycle++) {
      prepareRelicReward(run, 'gold', 'glass'); applyGrowthReward(run, 'gold');
      expect(run.maxHp).toBe(40); expect(run.hp).toBe(25);
      prepareRelicReward(run, 'glass', 'gold'); applyGrowthReward(run, 'glass');
      expect(run.maxHp).toBe(32); expect(run.hp).toBe(25);
      expect(run.relicLevels!.glass).toBe(8); expect(run.tier.glass).toBe(3);
      expect(run.inventory).toHaveLength(8);
    }
  });
});
