import { describe, expect, it, vi } from 'vitest';
import { enemyOf, greaterIds, primeIds } from '../src/game/content';
import { chainCapacity, dispatch, newSave, previewAction, resolveAction, spellMultiplier, startRun } from '../src/game/engine';
import { parseSave } from '../src/game/storage';
import { Random, singles } from '../src/game/sudoku';
import type { CharacterId, Report, RewardId, Run, Save } from '../src/game/types';

function fixture(seed = 71, character: CharacterId = 'fuse'): Save {
  const save = newSave(); save.meta.clears = 99;
  return startRun(save, character, seed);
}
function boardWith(blanks: number[], character: CharacterId = 'fuse'): Run {
  const run = fixture(71, character).run!;
  run.cells = [...run.solution]; blanks.forEach(cell => { run.cells[cell] = 0; });
  run.marks.fill(null); run.enemyHp = 1_000_000; run.mana = 8;
  return run;
}
function digitAt(run: Run, cell: number, digit: number): void {
  const old = run.solution[cell];
  const swap = (value: number) => value === old ? digit : value === digit ? old : value;
  run.solution = run.solution.map(swap); run.cells = run.cells.map(value => value ? swap(value) : 0);
}
const play = (run: Run, cell = singles(run.cells)[0], skill = false) => ({ type: 'play' as const, cell, skill, revision: run.revision });
const choose = (run: Run, relic: RewardId) => resolveAction(run, { type: 'reward', relic, revision: run.revision });
function rewardFixture(stage: number, seed = 71): Run {
  const run = fixture(seed).run!;
  run.stage = stage; run.stats.kills = stage; run.enemyHp = 1;
  return resolveAction(run, play(run));
}
function ordinaryContribution(report: Report, run: Run, index: number, skill = false): number {
  const event = report.path[index];
  const complete = event.units.length * (20 + (run.character === 'scribe' ? 10 : 0) + (run.inventory.includes('pen') ? 20 : 0));
  return 10 + 2 * index + complete * (skill && run.character === 'scribe' ? (run.skillRank === 2 ? 4 : 3) : 1)
    + (event.mark === 'weak' ? (run.inventory.includes('lens') ? 20 : 8) : 0);
}

describe('cell-level Stroke and stored battery overflow', () => {
  it('doubles only the first three cell contributions even when a chain continues past three', () => {
    const run = boardWith([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const plain = previewAction(run, 0);
    run.inventory = ['stroke'];
    const stroke = previewAction(run, 0);
    expect(stroke.path).toEqual(plain.path); expect(stroke.path.length).toBeGreaterThan(3);
    const extra = stroke.path.slice(0, 3).reduce((sum, _, index) => sum + ordinaryContribution(stroke, run, index), 0);
    expect(stroke.damage).toBe(plain.damage + extra);
  });
  it('extends Greater Stroke to the first five cells without doubling later cells', () => {
    const run = boardWith([0, 1, 2, 3, 4, 5, 6, 7, 8]); run.spellLevel = 3;
    const plain = previewAction(run, 0);
    run.inventory = ['stroke']; run.tier.stroke = 2;
    const greater = previewAction(run, 0);
    expect(greater.path).toHaveLength(7);
    const amount = greater.path.reduce((sum, _, index) => sum + ordinaryContribution(greater, run, index) * (index < 5 ? 2 : 1), 0);
    expect(greater.damage).toBe(Math.floor(amount * spellMultiplier(run.spellLevel)));
    expect(greater.damage).toBeGreaterThan(plain.damage);
  });
  it('stores at most two points from normal overflow, then restores them after a skill with no self-charge', () => {
    const run = boardWith([0, 40, 80]); run.inventory = ['battery']; run.mana = 7;
    const charged = resolveAction(run, play(run, 0));
    expect(charged.lastReport!.path).toHaveLength(1);
    expect(charged).toMatchObject({ mana: 8, manaOverflow: 2 });
    const used = resolveAction(charged, play(charged, 40, true));
    expect(used).toMatchObject({ mana: 2, manaOverflow: 0 });
    expect(used.lastReport!.charge).toBe(0);
    expect(used.lastReport!.path).toHaveLength(1);
  });
  it('does not store overflow without Battery, create overflow on skill, or exceed the two-point cap', () => {
    const noBattery = boardWith([0, 40]);
    expect(resolveAction(noBattery, play(noBattery, 0))).toMatchObject({ mana: 8, manaOverflow: 0 });
    const battery = boardWith([0, 1, 2, 3, 4, 40], 'lumen'); battery.inventory = ['battery'];
    expect(resolveAction(battery, play(battery, 0))).toMatchObject({ mana: 8, manaOverflow: 2 });
    expect(resolveAction(battery, play(battery, 0, true))).toMatchObject({ mana: 0, manaOverflow: 0 });
  });
  it('preserves stored overflow through enemy rewards and save/reload', () => {
    const save = fixture(); const run = save.run!;
    run.inventory = ['battery']; run.mana = 8; run.enemyHp = 1;
    const reward = dispatch(save, play(run));
    expect(reward.run!.manaOverflow).toBe(2);
    const restored = parseSave(JSON.stringify(reward)); expect(restored).toEqual(reward);
    const next = dispatch(restored, { type: 'reward', relic: restored.run!.rewards[0], revision: restored.run!.revision });
    expect(next.run).toMatchObject({ mana: 8, manaOverflow: 2 });
  });
});

describe('Trinity ranks and deterministic per-cast uncertainty', () => {
  it.each([[1, .3], [2, .45], [3, .6]] as const)('rank %i advertises its exact chance, with a single 1.5x proc', (rank, chance) => {
    const run = boardWith([0, 1, 2, 40], 'scribe'); digitAt(run, 0, 3); run.inventory = ['trinity'];
    if (rank > 1) run.acquisitionRank.trinity = rank;
    const preview = previewAction(run, 0), actual = resolveAction(run, play(run, 0)).lastReport!;
    expect(preview.path).toHaveLength(3);
    expect(preview.forecast).toMatchObject({ chance, multiplier: 1.5 });
    expect(actual.proc).toMatchObject({ id: 'trinity', chance, multiplier: 1.5 });
    expect(actual.damage).toBe(actual.proc!.triggered ? Math.floor(actual.baseDamage! * 1.5) : actual.baseDamage!);
    expect(actual.path).toEqual(preview.path);
    expect(preview.damage).toBe(preview.guaranteedDamage);
    expect(actual.damage).toBeGreaterThanOrEqual(preview.damage);
    expect(actual.damage).toBeLessThanOrEqual(preview.forecast!.damageMax);
  });
  it('requires a digit 3 in the actual path and upgrades the proc multiplier to 2x independently of rank', () => {
    const short = boardWith([0, 1, 40], 'scribe'); digitAt(short, 40, 3); short.inventory = ['trinity'];
    expect(previewAction(short, 0).path).toHaveLength(2);
    expect(previewAction(short, 0).forecast).toBeUndefined();
    expect(resolveAction(short, play(short, 0)).lastReport!.proc).toBeUndefined();
    const run = boardWith([0, 1, 2, 40], 'scribe'); digitAt(run, 0, 3); run.inventory = ['trinity']; run.tier.trinity = 2;
    expect(previewAction(run, 0).forecast).toMatchObject({ chance: .3, multiplier: 2 });
    expect(resolveAction(run, play(run, 0)).lastReport!.proc).toMatchObject({ chance: .3, multiplier: 2 });
  });
  it('never draws RNG or changes state while previewing, including reordered and repeated roots', () => {
    const run = fixture().run!; run.inventory = ['trinity']; run.enemyHp = 100000;
    const before = structuredClone(run), root = singles(run.cells)[0];
    const random = vi.spyOn(Random.prototype, 'next');
    try {
      const first = previewAction(run, root);
      for (const cell of [...singles(run.cells)].reverse()) previewAction(run, cell);
      expect(previewAction(run, root)).toEqual(first);
      expect(random).not.toHaveBeenCalled(); expect(run).toEqual(before);
    } finally { random.mockRestore(); }
  });
  it('persists the same proc across reload and preview order, isolated from the board/reward random stream', () => {
    const save = fixture(); const run = save.run!; run.inventory = ['trinity'];
    const root = singles(run.cells).find(cell => previewAction(run, cell).path.length >= 3)!;
    const untouched = dispatch(save, play(run, root));
    for (const cell of singles(run.cells).reverse()) { previewAction(run, cell); previewAction(run, cell); }
    expect(dispatch(parseSave(JSON.stringify(save)), play(run, root))).toEqual(untouched);
    const altered = structuredClone(run); altered.randomState = (altered.randomState + 91231) >>> 0;
    expect(resolveAction(altered, play(altered, root)).lastReport!.proc).toEqual(untouched.run!.lastReport!.proc);
    expect(untouched.run!.castCounter).toBe(run.castCounter + 1);
    expect(parseSave(JSON.stringify(untouched))).toEqual(untouched);
  });
  it('uses seed and cast identity for both hits and misses without compounding a proc on long chains', () => {
    const outcomes = new Set<boolean>();
    for (let seed = 1; seed <= 60; seed++) {
      const run = boardWith([0, 1, 2, 3, 4, 5, 6, 7, 8, 40]);
      run.seed = seed; run.inventory = ['trinity']; run.spellLevel = 6;
      const actual = resolveAction(run, play(run, 0)).lastReport!;
      expect(actual.path.length).toBeGreaterThanOrEqual(9);
      outcomes.add(actual.proc!.triggered);
      expect(actual.damage).toBe(Math.floor(actual.baseDamage! * (actual.proc!.triggered ? 1.5 : 1)));
    }
    expect(outcomes).toEqual(new Set([true, false]));
  });
});

describe('boss milestones, duplicate caps and skill growth', () => {
  it.each([4, 9, 14])('offers a skill upgrade and two Greater rewards including a build-defining upgrade after encounter index %i', stage => {
    const run = rewardFixture(stage);
    expect(run.rewards).toHaveLength(3);
    expect(run.rewards).toContain('skill-upgrade');
    expect(run.rewards.filter(id => id.startsWith('greater:'))).toHaveLength(2);
    expect(run.rewards.some(id => id === 'greater:lens' || id === 'greater:wick')).toBe(true);
    expect(new Set(run.rewards).size).toBe(3);
  });
  it('offers training and the two boons when every Greater family is owned', () => {
    const run = fixture().run!; run.stage = 9; run.stats.kills = 9; run.enemyHp = 1;
    run.skillRank = 2; run.inventory = [...greaterIds]; run.tier = Object.fromEntries(greaterIds.map(id => [id, 2])); run.acquisitionRank.trinity = 3;
    const reward = resolveAction(run, play(run));
    expect([...reward.rewards].sort()).toEqual(['defense-boon', 'magic-boon', 'training']);
  });
  it('allows Trinity duplicates only through rank three, while excluding capped and one-copy relics', () => {
    const run = fixture().run!; run.inventory = [...run.pool]; run.enemyHp = 1;
    for (const id of primeIds.filter(id => id !== 'trinity')) run.acquisitionRank[id] = 3;
    expect(run.pool).toContain('trinity');
    const rankOne = resolveAction(run, play(run));
    expect(rankOne.rewards).toContain('trinity');
    const rankTwo = choose(rankOne, 'trinity');
    expect(rankTwo.acquisitionRank.trinity).toBe(2);
    expect(rankTwo.inventory.filter(id => id === 'trinity')).toHaveLength(1);
    rankTwo.enemyHp = 1;
    const second = resolveAction(rankTwo, play(rankTwo)); expect(second.rewards).toContain('trinity');
    const rankThree = choose(second, 'trinity'); expect(rankThree.acquisitionRank.trinity).toBe(3);
    rankThree.enemyHp = 1;
    const capped = resolveAction(rankThree, play(rankThree));
    expect([...capped.rewards].sort()).toEqual(['recovery', 'training', 'vitality']);
  });
  it('keeps skill rank separate from spell level and never offers rank three', () => {
    const reward = rewardFixture(4); const before = reward.spellLevel;
    const upgraded = choose(reward, 'skill-upgrade');
    expect(upgraded.skillRank).toBe(2); expect(upgraded.spellLevel).toBe(before);
    upgraded.stage = 9; upgraded.stats.kills = 9; upgraded.enemyHp = 1;
    expect(resolveAction(upgraded, play(upgraded)).rewards).not.toContain('skill-upgrade');
  });
  it('Greater acquisition replaces the family tier instead of inserting a second inventory item', () => {
    for (const id of ['stroke', 'trinity'] as const) {
      const reward = rewardFixture(4); reward.inventory = [id]; reward.rewards = [`greater:${id}`];
      const next = choose(reward, `greater:${id}`);
      expect(next.inventory.filter(relic => relic === id)).toHaveLength(1);
      expect(next.tier[id]).toBe(2);
      expect(next.acquisitionRank[id] ?? 1).toBe(1);
    }
  });
  it('upgrades Scribe completion scaling from 3x to 4x and Lumen overall scaling from 2x to 2.5x', () => {
    for (const character of ['scribe', 'lumen'] as const) {
      const run = boardWith([0, 1, 2, 40], character); run.inventory = ['pen'];
      const first = previewAction(run, 0, true); run.skillRank = 2;
      const second = previewAction(run, 0, true);
      expect(second.path).toEqual(first.path);
      if (character === 'scribe') expect(second.damage - first.damage).toBe(first.units * 50);
      else expect(second.damage).toBe(Math.floor(first.damage * 1.25));
      run.skillRank = 1; const normal = previewAction(run, 0); run.skillRank = 2;
      expect(previewAction(run, 0)).toEqual(normal);
    }
  });
  it('lets rank-two Fuse hop once at a dead end, spending available fuel, and never hops normally', () => {
    const run = boardWith([0]);
    const same = run.solution.flatMap((value, cell) => value === run.solution[0] ? [cell] : []).slice(0, 3);
    same.forEach(cell => { run.cells[cell] = 0; }); run.skillRank = 2;
    const normal = previewAction(run, 0), skill = previewAction(run, 0, true);
    expect(normal.path).toHaveLength(1); expect(skill.path).toHaveLength(2);
    expect(skill.chain!.steps.filter(step => step.hop)).toHaveLength(1);
    const hop = skill.chain!.steps.find(step => step.hop)!;
    expect(hop.source).toBe('chain'); expect(hop.remainingAfter).toBe(hop.remainingBefore - 1);
    expect(hop.sharedUnits).toEqual([]); expect(skill.chain!.stopReason).toBe('no-target');
    run.skillRank = 1; expect(previewAction(run, 0, true).path).toHaveLength(1);
    expect(chainCapacity(run, true)).toBe(8);
  });
});

describe('proportional clear bonus and compatibility', () => {
  it('adds a proportional bonus after ordinary multipliers and never awards it for an enemy sweep', () => {
    const run = fixture().run!;
    const cell = run.givens.findIndex(given => !given);
    run.cells = [...run.solution]; run.cells[cell] = 0; run.enemyHp = 100000;
    run.inventory = ['glass']; run.spellLevel = 4;
    const report = previewAction(run, cell);
    expect(report.fullClear).toBe(true); expect(report.clearRatio).toBeCloseTo(1 / 36);
    expect(report.clearBonus).toBe(Math.floor(report.baseDamage! / (4 * 36)));
    expect(report.damage).toBe(report.baseDamage! + report.clearBonus!);
    expect(report.oneCastClear).toBe(false);
    const sweep = fixture().run!; sweep.enemyHp = 1;
    const killed = resolveAction(sweep, play(sweep)).lastReport!;
    expect(killed.sweep.length).toBeGreaterThan(0);
    expect(killed.fullClear).toBe(false); expect(killed.clearBonus).toBe(0); expect(killed.oneCastClear).toBe(false);
  });
  it('gives the maximum bonus only for all original 36 blanks filled in this one cast', () => {
    let report: Report | undefined;
    for (let seed = 1; seed <= 30 && !report; seed++) {
      const run = fixture(seed).run!; run.spellLevel = 60; run.skillRank = 2; run.mana = 8; run.enemyHp = 1_000_000;
      for (const cell of singles(run.cells)) {
        const candidate = previewAction(run, cell, true);
        if (candidate.fullClear && candidate.path.length === 36) { report = candidate; break; }
      }
    }
    expect(report).toBeDefined();
    expect(report).toMatchObject({ fullClear: true, clearRatio: 1, oneCastClear: true });
    expect(report!.clearBonus).toBe(Math.floor(report!.baseDamage! * .25));
    expect(report!.damage).toBe(report!.baseDamage! + report!.clearBonus!);
  });
  it('does not multiply the clear bonus when Trinity procs', () => {
    const run = boardWith([0, 1, 2], 'scribe'); digitAt(run, 0, 3); run.inventory = ['trinity', 'glass', 'amplifier'];
    run.tier.trinity = 2; run.acquisitionRank.trinity = 3;
    let actual: Report | undefined;
    for (let seed = 1; seed <= 60; seed++) {
      run.seed = seed; const candidate = resolveAction(run, play(run, 0, true)).lastReport!;
      if (candidate.proc?.triggered) { actual = candidate; break; }
    }
    expect(actual?.proc?.triggered).toBe(true);
    expect(actual!.damage).toBe(Math.floor(actual!.baseDamage! * 2) + actual!.clearBonus!);
    expect(actual!.clearBonus).toBe(Math.floor(actual!.baseDamage! * actual!.path.length / (4 * 36)));
  });
  it('migrates old HP, resources, offered rewards and random state without changing the current fight', () => {
    const save = fixture(19) as any;
    save.run.stage = 12; save.run.stats.kills = 12; save.run.enemyHp = enemyOf(12, 1).hp - 123;
    save.run.hp = 24; save.run.maxHp = 40; save.run.mana = 7;
    for (const key of ['balanceVersion', 'skillRank', 'manaOverflow', 'castCounter', 'acquisitionRank', 'tier']) delete save.run[key];
    const old = structuredClone(save.run), restored = parseSave(JSON.stringify(save));
    expect(restored.run).toMatchObject({ balanceVersion: 1, skillRank: 1, manaOverflow: 0, castCounter: old.stats.moves, acquisitionRank: {}, tier: {}, enemyHp: old.enemyHp, hp: 24, maxHp: 40, mana: 7, randomState: old.randomState });
    expect(restored.run!.cells).toEqual(old.cells); expect(restored.run!.rewards).toEqual(old.rewards);
    expect(parseSave(JSON.stringify(restored))).toEqual(restored);
    restored.run!.enemyHp = 1;
    const reward = dispatch(restored, play(restored.run!));
    const next = dispatch(reward, { type: 'reward', relic: reward.run!.rewards[0], revision: reward.run!.revision });
    expect(next.run!.balanceVersion).toBe(2); expect(next.run!.enemyHp).toBe(enemyOf(13, 2).hp);
  });
  it('uses a slower new HP curve with every-fifth bosses while preserving the old curve explicitly', () => {
    expect(enemyOf(6, 1).hp).toBe(13500);
    expect(enemyOf(6, 2).hp).toBeLessThan(enemyOf(6, 1).hp);
    for (let stage = 1; stage < 35; stage++) expect(enemyOf(stage).hp).toBeGreaterThan(enemyOf(stage - 1).hp);
    for (const stage of [4, 9, 14]) expect(enemyOf(stage).strongEvery).toBe(3);
    expect(enemyOf(30, 2).hp).toBeLessThan(enemyOf(30, 1).hp / 10);
    expect(fixture().run!.balanceVersion).toBe(2);
  });
});

describe('honest forecast outcome bounds', () => {
  function uncertain(fullClear = false): Run {
    const run = boardWith(fullClear ? [0, 1, 2] : [0, 1, 2, 40], 'scribe');
    digitAt(run, 0, 3); run.inventory = ['trinity']; run.hp = 20;
    const preview = previewAction(run, 0);
    run.enemyHp = preview.damage + 1;
    expect(run.enemyHp).toBeLessThanOrEqual(preview.forecast!.damageMax);
    return run;
  }
  it('states possible kill and possible survival when only a proc prevents lethal retaliation', () => {
    const run = uncertain(); run.hp = 1;
    const report = previewAction(run, 0);
    expect(report).toMatchObject({ defeated: false, healed: 0, levelsGained: 0, received: 3 });
    expect(report.forecast).toMatchObject({ kill: 'possible', survival: 'possible', receivedMin: 0, receivedMax: 3, healedMin: 0, healedMax: 10, levelsGainedMin: 0, levelsGainedMax: 1 });
  });
  it('bounds full-clear healing and growth without promising either a kill or sheet transition', () => {
    const run = uncertain(true), report = previewAction(run, 0);
    expect(report).toMatchObject({ fullClear: true, defeated: false, healed: 10, levelsGained: 1 });
    expect(report.forecast).toMatchObject({ kill: 'possible', survival: 'certain', healedMin: 10, healedMax: 20, levelsGainedMin: 1, levelsGainedMax: 2, sheetAdvancedCertain: false });
    expect(report.damage).toBe(report.guaranteedDamage);
  });
  it('warns that even a proc cannot save the player when both bounds lose to retaliation', () => {
    const run = uncertain(); run.enemyHp = 1_000_000; run.hp = 1;
    const report = previewAction(run, 0);
    expect(report.forecast).toMatchObject({ kill: 'none', survival: 'none', receivedMin: 3, receivedMax: 3, healedMin: 0, healedMax: 0, levelsGainedMin: 0, levelsGainedMax: 0 });
  });
  it('does not roll rewards or generate a board even when preview guarantees a kill or sheet completion', () => {
    for (const lethal of [false, true]) {
      const run = uncertain(true); run.enemyHp = lethal ? 1 : 1_000_000;
      const before = structuredClone(run), random = vi.spyOn(Random.prototype, 'next');
      try {
        const report = previewAction(run, 0);
        expect(report.fullClear).toBe(true); expect(report.defeated).toBe(lethal);
        expect(random).not.toHaveBeenCalled(); expect(run).toEqual(before);
      } finally { random.mockRestore(); }
    }
  });
});

describe('progression save validation', () => {
  it('rejects forged rank, tier, overflow and cast counter values', () => {
    const valid = fixture(); valid.run!.inventory = ['trinity', 'battery'];
    valid.run!.mana = 8; valid.run!.manaOverflow = 2;
    expect(parseSave(JSON.stringify(valid))).toEqual(valid);
    const mutations: ((run: Run) => void)[] = [
      run => { run.acquisitionRank.trinity = 4; },
      run => { run.tier.trinity = 3; },
      run => { run.tier.stroke = 2; },
      run => { run.manaOverflow = 3; },
      run => { run.mana = 7; },
      run => { run.inventory = ['trinity']; },
      run => { run.castCounter++; },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(valid); mutate(invalid.run!);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
  });
  it('rejects mismatched damage accounting, fake procs and duplicate victory-sweep cells', () => {
    const save = fixture(); save.run!.enemyHp = 1;
    const valid = dispatch(save, play(save.run!));
    const mutations: ((report: Report) => void)[] = [
      report => { report.guaranteedDamage!++; },
      report => { report.damage!++; },
      report => { report.clearBonus!++; },
      report => { report.clearRatio = 1; },
      report => { report.oneCastClear = true; },
      report => { report.sweep.push(report.sweep[0]); },
      report => { report.sweep.push(report.path[0].cell); },
      report => { report.manaRestored = 2; },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(valid); mutate(invalid.run!.lastReport!);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
  });
});


describe('exact clear bonus arithmetic', () => {
  it('does not lose an integer damage point to floating ratio rounding', () => {
    const run = fixture(1).run!; run.inventory = ['stroke']; run.spellLevel = 36;
    for (const cell of [60, 62, 64, 65, 67, 70, 71, 72, 73, 74, 75, 78, 79]) run.cells[cell] = run.solution[cell];
    const report = previewAction(run, 19);
    expect(report.path).toHaveLength(23); expect(report.baseDamage).toBe(10368);
    expect(report.clearBonus).toBe(1656); expect(report.damage).toBe(12024);
  });
});

describe('multiple threes in a single cast', () => {
  it('rolls Trinity only once even when the actual path fills several digit 3 cells', () => {
    let actual: Report | undefined;
    for (let seed = 1; seed <= 30 && !actual; seed++) {
      const run = fixture(seed).run!; run.inventory = ['trinity']; run.spellLevel = 60; run.skillRank = 2; run.mana = 8;
      for (const cell of singles(run.cells)) {
        const p = previewAction(run, cell, true);
        if (p.path.filter(event => event.value === 3).length >= 2) {
          actual = resolveAction(run, play(run, cell, true)).lastReport!; break;
        }
      }
    }
    expect(actual).toBeDefined(); expect(actual!.path.filter(event => event.value === 3).length).toBeGreaterThanOrEqual(2);
    expect(actual!.proc).toMatchObject({ chance: .3, multiplier: 1.5 });
    expect(actual!.damage).toBe(Math.floor(actual!.baseDamage! * (actual!.proc!.triggered ? 1.5 : 1)) + actual!.clearBonus!);
  });
});
