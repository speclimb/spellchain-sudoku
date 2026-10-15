import { describe, expect, it } from 'vitest';
import { RELICS } from '../src/game/content';
import { dispatch, legalOrigins, newSave, startRun } from '../src/game/engine';
import { rollRewards } from '../src/game/rewards';
import { parseSave } from '../src/game/storage';
import { Random } from '../src/game/sudoku';
import type { RelicId, Save } from '../src/game/types';

const allRelics = RELICS.map(relic => relic.id);
const oldUnlock: Partial<Record<RelicId, number>> = { echo: 3, rekindle: 6, amplifier: 12 };
type OldPhase = 'battle' | 'reward' | 'boss-skill' | 'boss-relic';

function oldPoolSave(phase: OldPhase): Save {
  const base = newSave(); base.meta.clears = phase.startsWith('boss') ? 4 : 0;
  let save = startRun(base, 'fuse', 73);
  const run = save.run!;
  delete run.relicBalanceVersion;
  run.pool = allRelics.filter(id => (oldUnlock[id] ?? 0) <= base.meta.clears).reverse();
  run.inventory = ['wick', 'gold']; run.relicLevels = { wick: 2, gold: 3 };
  run.acquisitionRank = { wick: 1, gold: 1 }; run.tier = { wick: 1, gold: 1 };
  if (phase === 'battle') return save;
  if (phase.startsWith('boss')) { run.stage = 4; run.stats.kills = 4; }
  run.enemyHp = 1;
  save = dispatch(save, { type: 'play', cell: legalOrigins(run)[0], skill: false, revision: run.revision });
  if (phase === 'boss-relic') save = dispatch(save, { type: 'reward', relic: save.run!.rewards[0], revision: save.run!.revision });
  return save;
}

describe('relic availability without lifetime-clear locks', () => {
  it('makes all sixteen relics eligible in the first adventure and its ordinary reward rolls', () => {
    const run = startRun(newSave(), 'fuse', 73).run!;
    expect(allRelics).toHaveLength(16);
    expect(RELICS.every(relic => relic.unlock === 0)).toBe(true);
    expect(run.pool).toEqual(allRelics);
    const offered = new Set<RelicId>();
    for (let seed = 1; seed <= 200; seed++) {
      for (const id of rollRewards(run, new Random(Math.imul(seed, 0x9e3779b1) >>> 0))) {
        if (allRelics.includes(id as RelicId)) offered.add(id as RelicId);
      }
    }
    expect(offered).toEqual(new Set(allRelics));
  });

  it.each(['battle', 'reward', 'boss-skill', 'boss-relic'] as const)('extends an old %s pool without changing the committed adventure', phase => {
    const save = oldPoolSave(phase), before = structuredClone(save);
    const oldRun = before.run!;
    expect(oldRun.pool.length).toBeLessThan(16);
    expect(oldRun.phase).toBe(phase === 'battle' ? 'battle' : 'reward');
    if (phase === 'boss-skill') { expect(oldRun.rewardStep).toBe('skill'); expect(oldRun.pendingRelicRewards).toHaveLength(3); }
    if (phase === 'boss-relic') expect(oldRun.rewardStep).toBe('relic');
    const expanded = [...oldRun.pool, ...allRelics.filter(id => !oldRun.pool.includes(id))];
    const loaded = parseSave(JSON.stringify(save));
    expect(loaded).toEqual({ ...before, run: { ...oldRun, pool: expanded } });
    expect(new Set(loaded.run!.pool)).toEqual(new Set(allRelics));
    expect(loaded.run!.relicBalanceVersion).toBe(oldRun.relicBalanceVersion);
    expect(save).toEqual(before);
    expect(parseSave(JSON.stringify(loaded))).toEqual(loaded);
  });

  it('validates a saved reward against its original pool before expanding availability', () => {
    const save = oldPoolSave('reward');
    expect(save.run!.pool).not.toContain('amplifier');
    save.run!.rewards[0] = 'amplifier';
    expect(() => parseSave(JSON.stringify(save))).toThrow();
  });
});
