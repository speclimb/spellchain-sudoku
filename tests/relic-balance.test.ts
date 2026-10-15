import { describe, expect, it, vi } from 'vitest';
import { relicOf } from '../src/game/content';
import { newSave, startRun, legalOrigins, previewAction, resolveAction } from '../src/game/engine';
import { relicValues } from '../src/game/growth';
import { enemyForRun } from '../src/game/enemies';
import { applyGrowthReward, canTakeReward, rollRelicRewards } from '../src/game/rewards';
import { parseSave } from '../src/game/storage';
import { Random, PEERS } from '../src/game/sudoku';
import type { RelicId, RewardId, Run } from '../src/game/types';

const supportRewards = ['training', 'vitality', 'recovery', 'magic-boon', 'defense-boon'];
const baseRelic = (id: RewardId) => id.replace(/^(greater|apex):/, '') as RelicId;

function fixture(): Run { const save = newSave(); save.meta.clears = 99; return startRun(save, 'fuse', 71).run!; }
function own(run: Run, ids: RelicId[], level = 1, tier = 1) {
  run.inventory = ids; run.relicLevels = Object.fromEntries(ids.map(id => [id, level]));
  run.tier = Object.fromEntries(ids.map(id => [id, tier]));
}
function isolated(run: Run): number {
  const root = run.givens.findIndex(given => !given);
  const other = run.givens.findIndex((given, i) => !given && i !== root && !PEERS[root].includes(i));
  run.cells = [...run.solution]; run.cells[root] = 0; run.cells[other] = 0; run.marks.fill(null);
  run.enemyHp = 1_000_000;
  return root;
}

describe('relic balance on the latest growth systems', () => {
  it.each(['wick', 'rekindle', 'ward', 'battery'] as const)('%s gains a real effect at every offered level upgrade', id => {
    for (const tier of [1, 2, 3]) {
      const run = fixture(); own(run, [id], tier === 3 ? 5 : 1, tier); run.rewardStep = 'relic';
      while (run.relicLevels![id]! < 10) {
        const before = relicValues(run, id);
        expect(canTakeReward(run, id)).toBe(true);
        expect(applyGrowthReward(run, id)).toBe(true);
        const after = relicValues(run, id);
        expect(after.level).toBe(before.level + 1); expect(after.tier).toBe(tier);
        const effectKeys = (Object.keys(before) as (keyof typeof before)[]).filter(key => key !== 'level' && key !== 'tier');
        expect(effectKeys.some(key => after[key] !== before[key]), `tier ${tier}, Lv.${before.level}→${after.level}`).toBe(true);
        for (const key of effectKeys) if (typeof before[key] === 'number') expect(after[key]).toBeGreaterThanOrEqual(before[key]);
      }
      expect(canTakeReward(run, id)).toBe(false);
    }
  });
  it('battery Lv.10 still increases stored mana for a single-cell Lumen cast at every tier', () => {
    for (const tier of [1, 2, 3]) {
      const run = fixture(), root = isolated(run); run.character = 'lumen';
      own(run, ['battery'], 9, tier);
      const before = previewAction(run, root);
      expect(before.path).toHaveLength(1); expect(before.charge).toBe(8);
      applyGrowthReward(run, 'battery');
      const after = previewAction(run, root);
      expect(after.path).toHaveLength(1); expect(after.charge).toBe(8);
      expect(after.manaOverflow).toBe(before.manaOverflow! + 1);
      expect(after.manaOverflow).toBeLessThanOrEqual(4);
    }
  });
  it('keeps old in-flight values and reduces late growth without cutting cross-sheet access', () => {
    const run = fixture(); own(run, ['wick', 'rekindle', 'ward', 'battery', 'lens'], 10, 3);
    expect(relicValues(run, 'wick')).toMatchObject({ auto: 11, carry: true });
    expect(relicValues(run, 'rekindle').rekindleAuto).toBe(13);
    expect(relicValues(run, 'ward').ward).toBe(13);
    expect(relicValues(run, 'battery')).toMatchObject({ charge: 10, overflow: 4 });
    delete run.relicBalanceVersion;
    expect(relicValues(run, 'wick').auto).toBe(13);
    expect(relicValues(run, 'battery')).toMatchObject({ charge: 13, overflow: 6 });
    expect(relicValues(run, 'lens').weakDamage).toBe(80);
  });
  it('caps cell-derived charge while preserving character and battery bonuses separately', () => {
    const run = fixture(); run.spellLevel = 10;
    const root = legalOrigins(run).find(cell => previewAction(run, cell).path.length >= 8)!;
    expect(root).toBeDefined();
    expect(previewAction(run, root).charge).toBe(5);
    own(run, ['battery']); expect(previewAction(run, root).charge).toBe(6);
    run.character = 'lumen'; expect(previewAction(run, root).charge).toBe(7);
    delete run.relicBalanceVersion; expect(previewAction(run, root).charge).toBe(8);
  });
  it('combines glass and amplifier bonuses additively and reports each marginal contribution', () => {
    const run = fixture(); const cell = isolated(run); run.mana = 8;
    const plain = previewAction(run, cell, true).baseDamage!;
    own(run, ['glass', 'amplifier']);
    const p = previewAction(run, cell, true);
    expect(p.baseDamage).toBe(Math.floor(plain * 1.55));
    expect(p.ledger!.relics.glass!.damage).toBeGreaterThan(0);
    expect(p.ledger!.relics.amplifier!.damage).toBeGreaterThan(0);
    expect(p.baseDamage).toBeLessThan(Math.floor(plain * 1.2 * 1.35));
  });
  it('rewards choosing a weak origin instead of passively strengthening every weak fill', () => {
    const run = fixture(), cell = isolated(run); run.marks[cell] = 'weak';
    const plain = previewAction(run, cell).baseDamage!;
    own(run, ['lens']);
    expect(previewAction(run, cell).baseDamage! - plain).toBe(16);
    expect(relicValues(run, 'lens')).toMatchObject({ weakDamage: 16, weakRootDamage: 8 });
  });
  it('gold completion heals before a lethal counter, once per cast, with preview and save parity', () => {
    const run = fixture(), marks = [...run.marks], cell = isolated(run);
    run.marks = marks; run.hp = 3; run.stage = 18; run.stats.kills = 18; run.enemyRulesVersion = 0; run.enemyHp = enemyForRun(run).hp;
    expect(resolveAction(run, { type: 'play', cell, skill: false, revision: run.revision }).phase).toBe('lost');
    own(run, ['gold']);
    const p = previewAction(run, cell), next = resolveAction(run, { type: 'play', cell, skill: false, revision: run.revision });
    expect(p.units).toBeGreaterThan(1); expect(p.relicHealed).toBe(2);
    expect(next.phase).toBe('battle'); expect(next.hp).toBe(1); expect(next.lastReport).toEqual(p);
    expect(next.lastReport!.ledger!.relics.gold!.healed).toBe(2);
    const save = newSave(); save.meta.clears = 99; save.run = next;
    expect(parseSave(JSON.stringify(save)).run).toEqual(next);
    run.mana = 8; expect(previewAction(run, cell, true).relicHealed).toBe(0);
    run.hp = run.maxHp; expect(previewAction(run, cell).relicHealed).toBe(0);
  });
  it('keeps acquisition and owned growth visible without character affinity bias', () => {
    const run = fixture(); run.stage = 5; run.rewardStep = 'relic'; own(run, ['wick', 'pen', 'battery', 'gold'], 3, 2);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      const offers = rollRelicRewards(run, new Random(Math.imul(seed, 0x9e3779b1) >>> 0));
      expect(offers.filter(id => supportRewards.includes(id)).length).toBeLessThanOrEqual(1);
      expect(offers.some(id => run.inventory.includes(id as RelicId))).toBe(true);
      const missing = offers.find(id => run.pool.includes(id as RelicId) && !run.inventory.includes(id as RelicId));
      expect(missing).toBeDefined(); seen.add(missing!);
      const other = { ...run, character: 'lumen' as const };
      expect(rollRelicRewards(other, new Random(Math.imul(seed, 0x9e3779b1) >>> 0))).toEqual(offers);
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it.each([
    ['ordinary with owned growth', 5, true], ['boss with owned growth', 4, true],
    ['first reward without owned relics', 0, false], ['boss without owned relics', 4, false],
  ] as const)('offers support occasionally in %s', (_name, stage, owned) => {
    const run = fixture(); run.stage = stage; run.rewardStep = 'relic';
    if (owned) own(run, ['wick', 'pen', 'battery', 'gold'], 6);
    let withSupport = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const offers = rollRelicRewards(run, new Random(Math.imul(seed, 0x9e3779b1) >>> 0));
      expect(offers).toHaveLength(3); expect(new Set(offers).size).toBe(3);
      expect(offers.every(id => canTakeReward(run, id))).toBe(true);
      const relics = offers.filter(id => !supportRewards.includes(id));
      expect([2, 3]).toContain(relics.length);
      withSupport += Number(relics.length === 2);
      expect(relics.some(id => !run.inventory.includes(baseRelic(id)))).toBe(true);
      if (owned) expect(relics.some(id => run.inventory.includes(baseRelic(id)))).toBe(true);
      else expect(new Set(relics.map(id => relicOf(baseRelic(id)).kind)).size).toBe(relics.length);
      if (stage === 4 && owned) expect(offers).toContain('greater:wick');
    }
    // Wide deterministic bounds reject both guaranteed support and a missing
    // support branch without turning the test into an exact RNG transcript.
    expect(withSupport).toBeGreaterThanOrEqual(200);
    expect(withSupport).toBeLessThanOrEqual(300);
  });

  it('fills short relic pools with distinct valid support choices on ordinary and boss rewards', () => {
    for (const stage of [0, 4]) for (const count of [0, 1, 2]) {
      const run = fixture(); run.stage = stage; run.rewardStep = 'relic'; run.pool = (['pen', 'gold'] as RelicId[]).slice(0, count);
      for (let seed = 1; seed <= 20; seed++) {
        const offers = rollRelicRewards(run, new Random(seed));
        expect(offers).toHaveLength(3); expect(new Set(offers).size).toBe(3);
        expect(offers.every(id => canTakeReward(run, id))).toBe(true);
        expect(offers.filter(id => run.pool.includes(id as RelicId))).toHaveLength(count);
        expect(offers.filter(id => supportRewards.includes(id))).toHaveLength(3 - count);
      }
    }
  });

  it('retains the terminal support sets when every relic has reached its maximum', () => {
    const run = fixture(); own(run, [...run.pool], 10, 3); run.rewardStep = 'relic';
    expect(rollRelicRewards(run, new Random(73)).sort()).toEqual(['recovery', 'training', 'vitality']);
    run.stage = 4;
    expect(rollRelicRewards(run, new Random(73)).sort()).toEqual(['defense-boon', 'magic-boon', 'training']);
  });

  it('replays the same support decision and RNG while preserving existing and pending rewards', () => {
    const run = fixture(); run.stage = 4; run.rewardStep = 'skill'; own(run, ['wick', 'pen'], 6);
    run.rewards = ['skill:fuse', 'skill:bridge', 'skill:pierce']; run.pendingRelicRewards = ['greater:wick', 'gold', 'recovery'];
    const before = structuredClone(run);
    const unseeded = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected global RNG'); });
    try {
      for (let seed = 1; seed <= 20; seed++) {
        const random = new Random(seed), replay = new Random(seed);
        const offers = rollRelicRewards(run, random);
        expect(rollRelicRewards(run, replay)).toEqual(offers);
        expect(replay.state).toBe(random.state); expect(random.state).not.toBe(seed);
        expect(run).toEqual(before);
      }
    } finally { unseeded.mockRestore(); }
  });
});
