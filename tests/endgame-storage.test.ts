import { describe, expect, it } from 'vitest';
import syntheticOriginalVictory from './fixtures/synthetic-original-full-clear-victory.json';
import { RELICS, enemyOf, greaterIds, primeIds, relicDescription, rewardOf } from '../src/game/content';
import { dispatch, newSave, previewAction, startRun } from '../src/game/engine';
import { canTakeReward, rollRewards } from '../src/game/rewards';
import { parseSave } from '../src/game/storage';
import { Random, singles } from '../src/game/sudoku';
import type { Run, Save } from '../src/game/types';

function fixture(seed = 71): Save {
  const save = newSave(); save.meta.clears = 99;
  return startRun(save, 'fuse', seed);
}

/** Reconstruct the pre-expansion rules explicitly for compatibility assertions. */
function legacyRun(run: Run): Run {
  delete run.relicBalanceVersion; delete run.stowedRelics;
  delete run.expansionVersion; delete run.enemyRulesVersion; delete run.skillLevels;
  delete run.equippedSkills; delete run.relicLevels; delete run.rewardStep;
  delete run.pendingRelicRewards; delete run.contributions;
  return run;
}
const play = (run: Run, cell = singles(run.cells)[0], skill = false) => ({ type: 'play' as const, cell, skill, revision: run.revision });
function ownUppers(run: Run) {
  run.inventory = [...greaterIds];
  for (const id of greaterIds) run.tier[id] = 2;
}
function carryFixture(): Save {
  // Find a genuine generated path beyond two sheets, keeping all board metadata
  // valid. This exercises parsing against the reducer, not a hand-forged report.
  for (let seed = 1; seed <= 20; seed++) {
    const save = fixture(seed), run = save.run!;
    run.stage = 40; run.stats.kills = 40; run.enemyHp = enemyOf(40).hp;
    run.spellLevel = 125; run.hp = run.maxHp = 1_000_000; run.mana = 8; run.skillRank = 2;
    run.inventory = ['wick', 'echo', 'rekindle']; run.tier.wick = 2;
    for (const cell of singles(run.cells)) {
      const report = previewAction(run, cell, true);
      if (report.path.length > 81) return dispatch(save, play(run, cell, true));
    }
  }
  throw new Error('No generated long-chain fixture found.');
}

describe('legacy relic content and repeatable reward compatibility', () => {
  it('defines all four ranked primes and seven independent upper tiers', () => {
    expect(primeIds).toEqual(['duality', 'trinity', 'quint', 'sept']);
    expect(greaterIds).toHaveLength(7);
    for (const id of ['duality', 'quint', 'sept']) expect(RELICS.find(relic => relic.id === id)?.unlock).toBe(0);
    const run = legacyRun(fixture().run!);
    for (const id of primeIds) {
      run.inventory.push(id); run.acquisitionRank[id] = 2; run.tier[id] = 2;
      expect(relicDescription(id, run)).toContain('45％');
      expect(rewardOf(id, run).description).toContain('60％');
      expect(canTakeReward(run, id)).toBe(true);
      run.acquisitionRank[id] = 3;
      expect(canTakeReward(run, id)).toBe(false);
    }
  });
  it('always offers a missing build-defining upper without granting it', () => {
    const run = legacyRun(fixture().run!); run.stage = 4;
    const before = structuredClone(run);
    for (let seed = 0; seed < 80; seed++) {
      const rewards = rollRewards(run, new Random(seed));
      expect(rewards).toHaveLength(3); expect(new Set(rewards).size).toBe(3);
      expect(rewards).toContain('skill-upgrade');
      expect(rewards.some(id => id === 'greater:lens' || id === 'greater:wick')).toBe(true);
      expect(rewards.every(id => canTakeReward(run, id))).toBe(true);
    }
    expect(run).toEqual(before);
    run.inventory.push('lens'); run.tier.lens = 2;
    for (let seed = 0; seed < 30; seed++) expect(rollRewards(run, new Random(seed))).toContain('greater:wick');
    expect(canTakeReward(run, 'greater:quint')).toBe(true); // Can acquire an unowned base directly.
  });
  it('offers exactly training and the two five-encounter boons after all uppers', () => {
    const run = legacyRun(fixture().run!); run.stage = 9; ownUppers(run);
    for (let seed = 0; seed < 30; seed++) expect(rollRewards(run, new Random(seed)).sort()).toEqual(['defense-boon', 'magic-boon', 'training']);
    expect(canTakeReward(run, 'magic-boon')).toBe(true);
    run.stage = 8;
    expect(canTakeReward(run, 'magic-boon')).toBe(false);
    for (let seed = 0; seed < 20; seed++) expect(rollRewards(run, new Random(seed))).not.toContain('defense-boon');
  });
  it('keeps early exhaustion fillers as training, vitality, and recovery', () => {
    const run = legacyRun(fixture().run!); run.pool = [];
    expect(rollRewards(run, new Random(1)).sort()).toEqual(['recovery', 'training', 'vitality']);
  });
});

describe('endgame save migration and bounded resources', () => {
  it('adds new relics to old pools while preserving every pending choice and random state', () => {
    const old = fixture() as any, r = legacyRun(old.run) as any;
    r.pool = r.pool.filter((id: string) => !['duality', 'quint', 'sept'].includes(id));
    r.phase = 'reward'; r.enemyHp = 0; r.cells = [...r.solution]; r.stats.kills = 1;
    r.rewards = ['wick', 'pen', 'recovery'];
    delete r.freeSkillTokens; delete r.reservedAuto; delete r.boons;
    const before = structuredClone(r), loaded = parseSave(JSON.stringify(old));
    expect(loaded.run).toMatchObject({ freeSkillTokens: 0, reservedAuto: 0, boons: { defense: 0, magic: 0 } });
    for (const key of ['cells', 'solution', 'givens', 'marks', 'hp', 'mana', 'enemyHp', 'randomState', 'puzzleOrder', 'rewards']) expect((loaded.run as any)[key]).toEqual(before[key]);
    expect(loaded.run!.pool).toEqual([...before.pool, 'duality', 'quint', 'sept']);
    expect(parseSave(JSON.stringify(loaded))).toEqual(loaded);
  });
  it('round trips valid upper resources and rejects invalid ranks, tiers, reservations and durations', () => {
    const save = fixture(), run = save.run!;
    ownUppers(run); run.freeSkillTokens = 2; run.reservedAuto = 14; run.boons = { defense: 5, magic: 4 };
    for (const id of primeIds) run.acquisitionRank[id] = 3;
    expect(parseSave(JSON.stringify(save))).toEqual(save);
    const mutations = [
      (r: any) => { r.freeSkillTokens = 3; },
      (r: any) => { r.tier.quint = 1; },
      (r: any) => { r.reservedAuto = 21; },
      (r: any) => { r.tier.sept = 1; },
      (r: any) => { r.acquisitionRank.duality = 4; },
      (r: any) => { r.tier.lens = 3; },
      (r: any) => { r.boons.defense = 6; },
      (r: any) => { r.boons.magic = -1; },
      (r: any) => { r.boons.extra = 1; },
      (r: any) => { r.inventory = r.inventory.filter((id: string) => id !== 'quint'); delete r.tier.quint; delete r.acquisitionRank.quint; },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(save); mutate(invalid.run);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
  });
  it('restores newly earned prime proc records and rejects forged effect values', () => {
    const save = fixture(), run = save.run!;
    run.inventory = [...primeIds]; run.spellLevel = 15; run.enemyHp = 1;
    const committed = dispatch(save, play(run));
    expect(committed.run!.lastReport!.procs!.length).toBeGreaterThan(0);
    expect(parseSave(JSON.stringify(committed))).toEqual(committed);
    for (const mutate of [
      (p: any) => { p.procs[0].value = 99; },
      (p: any) => { p.procs[0].chance = .9; },
      (p: any) => { p.procs.push({ ...p.procs[0] }); },
      (p: any) => { p.freeSkill = true; },
    ]) {
      const invalid = structuredClone(committed); mutate(invalid.run!.lastReport);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
  });
});

describe('multi-sheet report persistence', () => {
  it('round trips more than 81 ordinals, multiple levels and same coordinates on different sheets', () => {
    const committed = carryFixture(), report = committed.run!.lastReport!;
    expect(report.path.length).toBeGreaterThan(81);
    expect(report.segments!.length).toBeGreaterThan(2);
    expect(report.levelsGained).toBeGreaterThan(2);
    expect(new Set(report.path.map(event => event.cell)).size).toBeLessThan(report.path.length);
    expect(parseSave(JSON.stringify(committed))).toEqual(committed);
  });
  it('persists a surviving or lethal cast that completes earlier sheets then ends partially filled', () => {
    const long = carryFixture().run!;
    for (const lethal of [false, true]) {
      const save = fixture(long.seed), run = save.run!;
      run.stage = 1000; run.stats.kills = 1000; run.enemyHp = enemyOf(1000).hp;
      run.spellLevel = 125; run.hp = lethal ? 1 : 1_000_000; run.maxHp = 1_000_000; run.mana = 8; run.skillRank = 2;
      run.inventory = ['wick', 'echo', 'rekindle']; run.tier.wick = 2;
      const committed = dispatch(save, play(run, long.lastReport!.path[0].cell, true));
      const report = committed.run!.lastReport!;
      expect(report.fullClear).toBe(true); expect(report.segments!.at(-1)!.fullClear).toBe(false);
      expect(report.sweep).toEqual([]); expect(report.chain!.stopReason).not.toBe('board-complete');
      expect(committed.run!.phase).toBe(lethal ? 'lost' : 'battle');
      expect(report.levelsGained).toBe(lethal ? 0 : report.sheetsCompleted);
      expect(report.sheetAdvanced).toBe(!lethal);
      expect(parseSave(JSON.stringify(committed))).toEqual(committed);
    }
  });
  it('rejects corrupt sheet identity, coverage, snapshots, summaries and continuation costs', () => {
    const valid = carryFixture();
    const mutations = [
      (p: any) => { p.path[1].ordinal = 1; },
      (p: any) => { p.path[0].sheetStart = true; },
      (p: any) => { p.shield++; },
      (p: any) => { p.hpBefore++; },
      (p: any) => { p.enemyBefore = p.damage + 1; },
      (p: any) => { p.attackScore++; },
      (p: any) => { p.path[0].sheet = p.path[1].sheet + 1; },
      (p: any) => { p.path[1].cell = p.path[0].cell; },
      (p: any) => { p.segments[1].pathStart--; },
      (p: any) => { p.segments[1].sheet++; },
      (p: any) => { p.segments[0].cells[p.path[0].cell] = p.path[0].value; },
      (p: any) => { p.segments[0].clearRatio = 0; },
      (p: any) => { p.segments[0].baseDamage++; },
      (p: any) => { p.sheetsCompleted++; },
      (p: any) => { p.levelsGained++; },
      (p: any) => { const step = p.chain.steps.find((s: any) => s.sheetStart); step.sheetStart = false; },
      (p: any) => { const step = p.chain.steps.find((s: any) => s.sheetStart); step.remainingAfter++; },
      (p: any) => { p.sweep.push(p.path.at(-1).cell); },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(valid); mutate(invalid.run!.lastReport);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
  });
  it('retains backward compatibility with pre-segment reports', () => {
    const save = fixture(); save.run!.enemyHp = 1;
    const legacy = dispatch(save, play(save.run!)) as any, p = legacy.run.lastReport;
    delete p.segments; delete p.sheetsCompleted; delete p.freeSkill; delete p.procs;
    for (const event of p.path) { delete event.sheet; delete event.sheetStart; }
    for (const step of p.chain.steps) { delete step.sheet; delete step.sheetStart; }
    expect(parseSave(JSON.stringify(legacy))).toEqual(legacy);
  });
});


describe('original-format combat compatibility', () => {
  it('preserves the historical auto-victory branch from a synthetic original-reducer fixture', () => {
    // Emitted by commit 25ad667's reducer after setting up its last empty cell
    // against an 800-HP enemy. This is a format/semantics fixture, not a claim
    // that ordinary play could reach this state: the original bank's cumulative
    // minimum full-board damage exceeded every original enemy's HP.
    const original = structuredClone(syntheticOriginalVictory);
    expect(original.run.lastReport.damage).toBe(70);
    expect(original.run.lastReport.enemyBefore).toBe(800);
    const restored = parseSave(JSON.stringify(original));
    expect(restored.run).toMatchObject({ balanceVersion: 1, phase: 'won', enemyHp: 0, hp: 24 });
    expect(restored.run!.lastReport).toEqual(original.run.lastReport);
    expect(restored.run!.randomState).toBe(original.run.randomState);
    expect(restored.run!.rewards).toEqual(original.run.rewards);
    expect(parseSave(JSON.stringify(restored))).toEqual(restored);
  });
  it('does not permit historical auto-victory in v2 or modern report formats', () => {
    const changes = [
      (save: any) => { save.run.balanceVersion = 2; },
      (save: any) => { save.run.lastReport.segments = []; },
      (save: any) => { save.run.lastReport.levelsGained = 0; },
      (save: any) => { save.run.lastReport.baseDamage = 70; },
      (save: any) => { save.run.lastReport.fullClear = false; },
    ];
    for (const change of changes) {
      const invalid = structuredClone(syntheticOriginalVictory); change(invalid);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
  });
});
