import { describe, expect, it } from 'vitest';
import { RELICS } from '../src/game/content';
import { newSave, startRun } from '../src/game/engine';
import { applyFusion, canFuse, fusionLevelRequirement, relicInventoryEntries } from '../src/game/fusions';
import { relicMaxLevel } from '../src/game/growth';
import { applyGrowthReward, canTakeReward, ORDINARY_EVOLUTION_CHANCE, rollRelicRewards } from '../src/game/rewards';
import { parseSave } from '../src/game/storage';
import { Random } from '../src/game/sudoku';
import type { RelicId, RewardId, Run } from '../src/game/types';

const evolution = (id: RewardId) => /^(greater|apex):/.test(id);
const baseOf = (id: RewardId) => id.replace(/^(greater|apex):/, '') as RelicId;
const seedOf = (index: number) => Math.imul(index + 1, 0x9e3779b1) >>> 0;
const support = ['training', 'vitality', 'recovery', 'magic-boon', 'defense-boon'];
function fixture(mode: 'campaign' | 'endless' = 'campaign', stage = 10) {
  const save = startRun(newSave(), 'fuse', 730, mode), run = save.run!;
  run.progressionVersion = 1; run.stage = stage; run.phase = 'reward'; run.rewardStep = 'relic';
  run.enemyHp = 0; run.cells = [...run.solution]; run.stats.kills = stage + 1;
  run.rewards = ['training', 'vitality', 'recovery']; run.pendingRelicRewards = []; run.lastReport = null;
  return save;
}
function own(run: Run, ids: RelicId[], level = 5, tier = 2) {
  run.inventory = [...ids];
  run.relicLevels = Object.fromEntries(ids.map(id => [id, level]));
  run.tier = Object.fromEntries(ids.map(id => [id, tier]));
  run.acquisitionRank = Object.fromEntries(ids.map(id => [id, ['trinity', 'duality', 'quint', 'sept'].includes(id) ? 3 : 1]));
}
function offersAtDraw(run: Run, draw: number) {
  const random = new Random(73); random.next = () => draw;
  return rollRelicRewards(run, random);
}

describe('versioned relic growth and fusion requirements', () => {
  it.each([['campaign', 8], ['endless', 20]] as const)('%s upgrades exactly one level and stops at %i', (mode, cap) => {
    const run = fixture(mode, 79).run!; own(run, ['pen'], cap - 1, 3);
    expect(relicMaxLevel(run)).toBe(cap);
    expect(canTakeReward(run, 'pen')).toBe(true);
    applyGrowthReward(run, 'pen');
    expect(run.relicLevels!.pen).toBe(cap);
    expect(canTakeReward(run, 'pen')).toBe(false);
    expect(rollRelicRewards(run, new Random(73))).not.toContain('pen');
  });

  it('preserves the preceding campaign upgrade size and level cap without the new flag', () => {
    const run = fixture('campaign', 79).run!; delete run.progressionVersion; own(run, ['pen'], 7, 3);
    expect(relicMaxLevel(run)).toBe(10);
    applyGrowthReward(run, 'pen'); expect(run.relicLevels!.pen).toBe(9);
    applyGrowthReward(run, 'pen'); expect(run.relicLevels!.pen).toBe(10);
    expect(canTakeReward(run, 'pen')).toBe(false);
  });

  it('fuses new campaign apex materials at level 8 while previous runs still require 10', () => {
    const save = fixture('campaign', 9), run = save.run!; own(run, ['wick', 'rekindle'], 8, 3);
    expect(fusionLevelRequirement(run)).toBe(8); expect(canFuse(run, 'eternal-flame')).toBe(true);
    run.relicLevels!.wick = 7; expect(canFuse(run, 'eternal-flame')).toBe(false);
    run.relicLevels!.wick = 8;
    const legacy = structuredClone(run); delete legacy.progressionVersion;
    expect(fusionLevelRequirement(legacy)).toBe(10); expect(canFuse(legacy, 'eternal-flame')).toBe(false);
    applyFusion(run, 'eternal-flame');
    expect(relicInventoryEntries(run)).toHaveLength(1); expect(run.inventory).toHaveLength(2);
    expect(parseSave(JSON.stringify(save)).run!.fusions).toEqual(['eternal-flame']);
  });

  it('lets endless fusion components continue growing from level 10 through 20 without losing the fusion', () => {
    const save = fixture('endless', 99), run = save.run!; own(run, ['wick', 'rekindle'], 10, 3);
    expect(fusionLevelRequirement(run)).toBe(10); applyFusion(run, 'eternal-flame');
    for (let level = 11; level <= 20; level++) {
      expect(canTakeReward(run, 'wick')).toBe(true); applyGrowthReward(run, 'wick');
      expect(run.relicLevels!.wick).toBe(level);
      expect(relicInventoryEntries(run)[0].fusion?.id).toBe('eternal-flame');
      expect(parseSave(JSON.stringify(save)).run!.fusions).toEqual(['eternal-flame']);
    }
    expect(canTakeReward(run, 'wick')).toBe(false);
  });
});

describe('ordinary evolution lottery', () => {
  it.each(['campaign', 'endless'] as const)('%s gets one menu-wide chance with an exact boundary', mode => {
    const run = fixture(mode).run!; own(run, ['wick', 'pen', 'echo', 'lens'], 5, 1);
    const hit = offersAtDraw(run, ORDINARY_EVOLUTION_CHANCE - 0.000001);
    const miss = offersAtDraw(run, ORDINARY_EVOLUTION_CHANCE);
    expect(hit.filter(evolution)).toHaveLength(1); expect(miss.some(evolution)).toBe(false);
    expect(hit.every(id => canTakeReward(run, id))).toBe(true);
    expect(new Set(hit.map(baseOf)).size).toBe(3);
    expect(miss.some(id => run.inventory.includes(baseOf(id)))).toBe(true);
  });

  it('keeps the chance near 15 percent for one or eight eligible materials, never compounds per relic', () => {
    for (const count of [1, 8]) {
      const run = fixture().run!; own(run, RELICS.slice(0, count).map(relic => relic.id), 5, 2);
      let evolved = 0;
      for (let sample = 0; sample < 2000; sample++) {
        const offers = rollRelicRewards(run, new Random(seedOf(sample)));
        expect(offers.filter(evolution).length).toBeLessThanOrEqual(1);
        evolved += Number(offers.some(evolution));
      }
      expect(evolved / 2000).toBeGreaterThan(ORDINARY_EVOLUTION_CHANCE - .02);
      expect(evolved / 2000).toBeLessThan(ORDINARY_EVOLUTION_CHANCE + .02);
    }
  });

  it('never forces an ordinary evolution just because every owned relic has reached the cap', () => {
    const run = fixture().run!; own(run, RELICS.slice(0, 8).map(relic => relic.id), 8, 1);
    const miss = offersAtDraw(run, .9999), hit = offersAtDraw(run, 0);
    expect(miss.some(evolution)).toBe(false); expect(miss).toContain('training');
    expect(miss.filter(id => support.includes(id))).toHaveLength(2);
    expect(hit.filter(evolution)).toHaveLength(1);
    expect(hit.filter(id => support.includes(id))).toHaveLength(1);
    expect(hit.filter(id => !support.includes(id) && !run.inventory.includes(baseOf(id)))).toHaveLength(1);
  });

  it('keeps the old boss-only rule and boss wick guarantee; ordinary new-run wick stays within the lottery', () => {
    const run = fixture().run!; own(run, ['wick'], 5, 1);
    expect(offersAtDraw(run, .9999)).toContain('wick');
    expect(offersAtDraw(run, .9999)).not.toContain('greater:wick');
    run.stage = 9;
    expect(offersAtDraw(run, .9999)).toContain('greater:wick');
    run.stage = 10; delete run.progressionVersion;
    expect(canTakeReward(run, 'greater:wick')).toBe(false);
    expect(offersAtDraw(run, 0).some(evolution)).toBe(false);
  });

  it('requires owned materials and level 5 before upper-to-apex evolution', () => {
    const run = fixture().run!; own(run, ['pen'], 4, 2);
    expect(canTakeReward(run, 'apex:pen')).toBe(false);
    expect(canTakeReward(run, 'greater:lens')).toBe(false);
    expect(offersAtDraw(run, 0).some(evolution)).toBe(false);
    run.relicLevels!.pen = 5;
    expect(canTakeReward(run, 'apex:pen')).toBe(true);
    expect(offersAtDraw(run, 0)).toContain('apex:pen');
  });

  it('retains sampled ordinary evolution rewards on reload and does not alter the source or its combat RNG', () => {
    const save = fixture(), run = save.run!; own(run, ['wick', 'rekindle'], 5, 2);
    const before = structuredClone(run), random = new Random(1); random.next = () => 0;
    run.rewards = rollRelicRewards(run, random);
    expect(run.rewards.some(evolution)).toBe(true);
    expect({ ...run, rewards: before.rewards }).toEqual(before);
    const restored = parseSave(JSON.stringify(save));
    expect(restored.run!.rewards).toEqual(run.rewards);
    expect(restored.run!.randomState).toBe(before.randomState);
  });
});
