import { describe, expect, it } from 'vitest';
import { dispatch, longestOrigins, newSave, previewAction, startRun } from '../src/game/engine';
import { awardRescueItems, rescueMilestonesAt, RESCUE_COST } from '../src/game/endgame';
import { parseSave } from '../src/game/storage';
import { col, row } from '../src/game/sudoku';
import { enemyForRun } from '../src/game/enemies';
import { capacityText, explainStep } from '../src/ui/chain-guide';
import type { Run } from '../src/game/types';

function fixture(seed = 71) {
  const initial = newSave(); initial.meta.clears = 99;
  const save = startRun(initial, 'lumen', seed);
  save.run!.endgameBalanceVersion = 1;
  save.run!.spellLevel = 100;
  return save;
}
function partial(run: Run, empty = [2, 13]) {
  run.cells = [...run.solution];
  for (const cell of empty) { expect(run.givens[cell]).toBe(false); run.cells[cell] = 0; }
}
function isolated(run: Run, count: number): number[] {
  const available = run.givens.flatMap((given, cell) => given ? [] : [cell]);
  const box = (cell: number) => Math.floor(row(cell) / 3) * 3 + Math.floor(col(cell) / 3);
  function search(picked: number[], start: number): number[] | undefined {
    if (picked.length === count) return picked;
    for (let i = start; i < available.length; i++) {
      const next = available[i];
      if (picked.some(cell => row(cell) === row(next) || col(cell) === col(next) || box(cell) === box(next))) continue;
      const found = search([...picked, next], i + 1); if (found) return found;
    }
  }
  const result = search([], 0); if (!result) throw new Error('No isolated input fixture');
  return result;
}

describe('bounded late-game reconnect', () => {
  it('spends six fuel including the destination, with exact preview/save/guide agreement', () => {
    const save = fixture(), run = save.run!; partial(run); run.enemyHp = 1;
    const before = structuredClone(run), prediction = previewAction(run, 2);
    expect(run).toEqual(before);
    expect(prediction.path.map(event => event.cell)).toEqual([2, 13]);
    expect(prediction.path[1]).toMatchObject({ source: 'chain', rescue: true });
    expect(prediction.extraDamage).toBe(0);
    const step = prediction.chain!.steps[1];
    expect(step.remainingBefore - step.remainingAfter + step.addedAuto).toBe(RESCUE_COST);
    expect(explainStep(prediction, 1)).toMatchObject({ title: expect.stringContaining('接続救済'), budget: expect.stringContaining('6消費') });
    expect(capacityText(run, false)).toContain('接続救済1回');
    const committed = dispatch(save, { type: 'play', cell: 2, skill: false, revision: run.revision });
    expect(committed.run!.lastReport!.path).toEqual(prediction.path);
    expect(committed.run!.lastReport!.chain).toEqual(prediction.chain);
    expect(parseSave(JSON.stringify(committed))).toEqual(committed);
  });

  it('preserves old encounters and the pre-level-100 path, including cached longest origins', () => {
    const run = fixture().run!; partial(run);
    delete run.endgameBalanceVersion;
    expect(longestOrigins(run).length).toBe(1);
    run.endgameBalanceVersion = 1;
    expect(longestOrigins(run).length).toBe(2);
    run.spellLevel = 99;
    expect(previewAction(run, 2).path).toHaveLength(1);
    expect(capacityText(run, false)).not.toContain('接続救済');
  });

  it('uses natural connections without paying a reconnect fee', () => {
    const run = fixture().run!; partial(run, [9, 11, 13, 14, 16]);
    const prediction = previewAction(run, 9);
    expect(prediction.path).toHaveLength(5);
    expect(prediction.path.some(event => event.rescue)).toBe(false);
    expect(prediction.chain!.initialAuto - prediction.chain!.remainingAuto).toBe(4);
  });

  it('uses all three cheap Bridge reconnects before the one shared rescue', () => {
    const run = fixture().run!, empty = isolated(run, 5); partial(run, empty);
    run.skillLevels!.bridge = 10; run.equippedSkills = ['bridge']; run.mana = 8;
    const prediction = previewAction(run, empty[0], true, 'bridge');
    expect(prediction.path).toHaveLength(5);
    expect(prediction.path.slice(1, 4).every(event => event.bridge && !event.rescue)).toBe(true);
    expect(prediction.path[4]).toMatchObject({ rescue: true });
    expect(prediction.path[4].bridge).toBeUndefined();
    expect(prediction.chain!.initialAuto - prediction.chain!.remainingAuto).toBe(3 + RESCUE_COST);
  });

  it('stops after one rescue even with more disconnected singles and spare fuel', () => {
    const run = fixture().run!, empty = isolated(run, 5); partial(run, empty);
    const prediction = previewAction(run, empty[0]);
    expect(prediction.path).toHaveLength(2);
    expect(prediction.path.filter(event => event.rescue)).toHaveLength(1);
    expect(prediction.chain!.stopReason).toBe('no-target');
    expect(prediction.chain!.remainingAuto).toBeGreaterThan(RESCUE_COST);
  });

  it('keeps the rescue spent across fresh sheets and accounts for every fuel unit', () => {
    const run = fixture(1).run!; run.spellLevel = 300;
    run.inventory = ['wick']; run.tier.wick = 2;
    const prediction = previewAction(run, 8);
    expect(prediction.segments!.length).toBeGreaterThan(2);
    expect(prediction.path.filter(event => event.rescue)).toHaveLength(1);
    const trace = prediction.chain!;
    expect(trace.initialAuto + trace.steps.reduce((n, step) => n + step.addedAuto, 0) - trace.remainingAuto)
      .toBe(prediction.path.filter(event => event.source === 'chain').length + RESCUE_COST - 1);
  });

  it('does not reconnect when fewer than six fuel remain', () => {
    const run = fixture(2).run!; run.spellLevel = 104; run.inventory = ['wick']; run.tier.wick = 2;
    const prediction = previewAction(run, 3);
    expect(prediction.path).toHaveLength(107);
    expect(prediction.chain).toMatchObject({ remainingAuto: 1, stopReason: 'no-target' });
    expect(prediction.path.some(event => event.rescue)).toBe(false);
  });

  it('rejects forged rescue flags and fuel accounting without rejecting legacy reports', () => {
    const save = fixture(); partial(save.run!); save.run!.enemyHp = 1;
    const committed = dispatch(save, { type: 'play', cell: 2, skill: false, revision: 0 });
    for (const mutate of [
      (r: any) => { delete r.endgameBalanceVersion; },
      (r: any) => { r.lastReport.chain.steps[1].remainingAfter += 5; r.lastReport.chain.remainingAuto += 5; },
      (r: any) => { r.lastReport.path[1].rescue = 'yes'; },
      (r: any) => { r.lastReport.path[1].hop = true; },
      (r: any) => { r.lastReport.chain.steps[1].rescue = false; },
    ]) {
      const invalid = structuredClone(committed); mutate(invalid.run);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
    delete save.run!.endgameBalanceVersion;
    const legacy = dispatch(save, { type: 'play', cell: 2, skill: false, revision: 0 });
    expect(legacy.run!.lastReport!.path).toHaveLength(1);
    expect(parseSave(JSON.stringify(legacy))).toEqual(legacy);
  });
});

describe('limited reconnect items', () => {
  function limited(level = 200, items = rescueMilestonesAt(level), seed = 71) {
    const save = fixture(seed), run = save.run!;
    run.endgameBalanceVersion = 2; run.spellLevel = level;
    run.rescueMilestones = rescueMilestonesAt(level); run.rescueItems = items;
    return save;
  }
  it('starts empty and awards every crossed hundred from level 200 without duplicating grants', () => {
    const save = startRun(newSave(), 'fuse', 1), run = save.run!;
    expect(run).toMatchObject({ endgameBalanceVersion: 2, rescueItems: 0, rescueMilestones: 0 });
    expect([1, 100, 199, 200, 299, 300, 499].map(rescueMilestonesAt)).toEqual([0, 0, 0, 1, 1, 2, 3]);
    run.spellLevel = 499;
    expect(awardRescueItems(run)).toBe(3);
    expect(run).toMatchObject({ rescueItems: 3, rescueMilestones: 3 });
    expect(awardRescueItems(run)).toBe(0);
    expect(parseSave(JSON.stringify(save)).run).toMatchObject({ rescueItems: 3, rescueMilestones: 3 });
  });
  it('consumes one item only on a committed rescue, with matching preview and save accounting', () => {
    const save = limited(), run = save.run!; partial(run); run.enemyHp = 1;
    const before = structuredClone(run), prediction = previewAction(run, 2);
    expect(run).toEqual(before);
    expect(prediction).toMatchObject({ rescueItemsBefore: 1, rescueItemsAfter: 0, rescueItemsGranted: 0 });
    expect(prediction.path[1]).toMatchObject({ rescue: true });
    const next = dispatch(save, { type: 'play', cell: 2, skill: false, revision: run.revision });
    expect(next.run).toMatchObject({ rescueItems: 0, rescueMilestones: 1 });
    expect(next.run!.lastReport).toMatchObject({ rescueItemsBefore: 1, rescueItemsAfter: 0, rescueItemsGranted: 0 });
    expect(parseSave(JSON.stringify(next))).toEqual(next);
    expect(parseSave(JSON.stringify(parseSave(JSON.stringify(next))))).toEqual(next);
  });
  it('does not rescue without stock and invalidates cached paths when stock changes', () => {
    const run = limited(200, 0).run!; partial(run);
    expect(longestOrigins(run).length).toBe(1);
    expect(previewAction(run, 2).path).toHaveLength(1);
    run.rescueItems = 1;
    expect(longestOrigins(run).length).toBe(2);
    expect(previewAction(run, 2).path[1].rescue).toBe(true);
  });
  it('does not spend items on natural connections or reuse a second item in the same cast', () => {
    const run = limited(400, 3).run!; partial(run, [9, 11, 13, 14, 16]);
    const natural = previewAction(run, 9);
    expect(natural).toMatchObject({ rescueItemsBefore: 3, rescueItemsAfter: 3, rescueItemsGranted: 0 });
    const empty = isolated(run, 5); partial(run, empty);
    const prediction = previewAction(run, empty[0]);
    expect(prediction.path).toHaveLength(2);
    expect(prediction.path.filter(event => event.rescue)).toHaveLength(1);
    expect(prediction).toMatchObject({ rescueItemsBefore: 3, rescueItemsAfter: 2, rescueItemsGranted: 0 });
  });
  it('prioritizes Bridge and does not replenish the single rescue across fresh sheets', () => {
    const run = limited().run!, empty = isolated(run, 5); partial(run, empty);
    run.skillLevels!.bridge = 10; run.equippedSkills = ['bridge']; run.mana = 8;
    const bridge = previewAction(run, empty[0], true, 'bridge');
    expect(bridge.path.slice(1, 4).every(event => event.bridge && !event.rescue)).toBe(true);
    expect(bridge.path[4].rescue).toBe(true);
    expect(bridge.rescueItemsAfter).toBe(0);
    const sheets = limited(300, 2, 1).run!; sheets.inventory = ['wick']; sheets.tier.wick = 2;
    const across = previewAction(sheets, 8);
    expect(across.segments!.length).toBeGreaterThan(2);
    expect(across.path.filter(event => event.rescue)).toHaveLength(1);
    expect(across).toMatchObject({ rescueItemsBefore: 2, rescueItemsAfter: 1, rescueItemsGranted: 0 });
  });
  it('awards a milestone after growth, so it cannot rescue the cast that earns it', () => {
    const save = limited(199), run = save.run!; partial(run); run.enemyHp = 1;
    const prediction = previewAction(run, 2);
    expect(prediction.path).toHaveLength(1);
    expect(prediction).toMatchObject({ rescueItemsBefore: 0, rescueItemsAfter: 1, rescueItemsGranted: 1, spellLevelAfter: 200 });
    const next = dispatch(save, { type: 'play', cell: 2, skill: false, revision: run.revision });
    expect(next.run).toMatchObject({ rescueItems: 1, rescueMilestones: 1, spellLevel: 200 });
    expect(parseSave(JSON.stringify(next))).toEqual(next);
  });
  it('does not award growth or items when retaliation kills a cast with completed sheets', () => {
    const save = limited(199, 0, 1), run = save.run!;
    run.inventory = ['wick']; run.tier.wick = 2; run.stage = 144; run.stats.kills = 144;
    run.enemyHp = enemyForRun(run).hp; run.hp = run.maxHp = 1;
    const next = dispatch(save, { type: 'play', cell: 8, skill: false, revision: 0 });
    expect(next.run!.lastReport!.sheetsCompleted).toBeGreaterThan(0);
    expect(next.run).toMatchObject({ phase: 'lost', spellLevel: 199, rescueItems: 0, rescueMilestones: 0 });
    expect(next.run!.lastReport).toMatchObject({ levelsGained: 0, rescueItemsBefore: 0, rescueItemsAfter: 0, rescueItemsGranted: 0 });
    expect(parseSave(JSON.stringify(next))).toEqual(next);
  });
  it('awards training milestones and migrates old high-level runs only after their existing rewards', () => {
    for (const version of [undefined, 1, 2] as const) {
      const save = limited(version === 2 ? 299 : 449, 0), run = save.run!;
      run.endgameBalanceVersion = version;
      if (version !== 2) { delete run.rescueItems; delete run.rescueMilestones; }
      run.phase = 'reward'; run.enemyHp = 0; run.cells = [...run.solution]; run.stats.kills = 1;
      run.rewardStep = 'relic'; run.rewards = ['training', 'vitality', 'recovery'];
      const restored = parseSave(JSON.stringify(save));
      expect(restored.run!.endgameBalanceVersion).toBe(version);
      expect(restored.run!.rewards).toEqual(run.rewards);
      if (version !== 2) expect(restored.run!.rescueItems).toBeUndefined();
      const next = dispatch(restored, { type: 'reward', relic: 'training', revision: run.revision });
      expect(next.run).toMatchObject({ endgameBalanceVersion: 2, rescueItems: version === 2 ? 1 : 3, rescueMilestones: version === 2 ? 2 : 3 });
      expect(parseSave(JSON.stringify(next))).toEqual(next);
    }
  });
  it('preserves both stages of an already sampled boss reward until the next encounter', () => {
    const save = limited(450, 0), run = save.run!;
    run.endgameBalanceVersion = 1; delete run.rescueItems; delete run.rescueMilestones;
    run.stage = 4; run.phase = 'reward'; run.enemyHp = 0; run.cells = [...run.solution]; run.stats.kills = 5;
    run.rewardStep = 'skill'; run.rewards = ['training', 'vitality', 'recovery'];
    run.pendingRelicRewards = ['training', 'vitality', 'recovery'];
    const first = dispatch(parseSave(JSON.stringify(save)), { type: 'reward', relic: 'vitality', revision: 0 });
    expect(first.run).toMatchObject({ stage: 4, endgameBalanceVersion: 1, rewardStep: 'relic', rewards: run.pendingRelicRewards });
    expect(first.run!.rescueItems).toBeUndefined();
    const second = dispatch(parseSave(JSON.stringify(first)), { type: 'reward', relic: 'vitality', revision: 1 });
    expect(second.run).toMatchObject({ stage: 5, endgameBalanceVersion: 2, rescueItems: 3, rescueMilestones: 3 });
    expect(parseSave(JSON.stringify(second))).toEqual(second);
  });
  it('rejects missing, fractional, negative or impossible v2 resources and forged item accounting', () => {
    const save = limited(), run = save.run!; partial(run); run.enemyHp = 1;
    const next = dispatch(save, { type: 'play', cell: 2, skill: false, revision: 0 });
    for (const mutate of [
      (r: any) => { delete r.rescueItems; },
      (r: any) => { delete r.rescueMilestones; },
      (r: any) => { r.rescueItems = -1; },
      (r: any) => { r.rescueItems = .5; },
      (r: any) => { r.rescueItems = 2; },
      (r: any) => { r.rescueMilestones = 0; },
      (r: any) => { r.rescueMilestones = 2; },
      (r: any) => { delete r.lastReport.rescueItemsBefore; },
      (r: any) => { r.lastReport.rescueItemsBefore = 0; },
      (r: any) => { r.lastReport.rescueItemsAfter = 1; },
      (r: any) => { r.lastReport.rescueItemsGranted = 1; },
      (r: any) => { delete r.lastReport.path[1].rescue; delete r.lastReport.chain.steps[1].rescue; },
    ]) {
      const invalid = structuredClone(next); mutate(invalid.run);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
  });
});
