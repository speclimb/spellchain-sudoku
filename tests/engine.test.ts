import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import bank from '../src/game/puzzles.json';
import { CHARACTERS, ENEMIES, REPEATABLE_REWARDS, RELICS, characterOf, enemyOf, rewardOf } from '../src/game/content';
import { chainBonus, chainCapacity, dispatch, incomingAttack, newSave, previewAction, resolveAction, spellMultiplier, startRun } from '../src/game/engine';
import { parseSave } from '../src/game/storage';
import { candidates, countSolutions, singles, solveSingles } from '../src/game/sudoku';
import type { CharacterId, Run, Save } from '../src/game/types';

function fixture(seed = 20261013, character: CharacterId = 'fuse', clears = 12): Save {
  const save = newSave(); save.meta.clears = clears;
  return startRun(save, character, seed);
}
const play = (run: Run, cell = singles(run.cells)[0], skill = false) => ({ type: 'play' as const, cell, skill, revision: run.revision });
function leaveLastCell(run: Run): number {
  const cell = run.givens.findIndex((given, i) => !given && run.marks[i] === null);
  run.cells = [...run.solution]; run.cells[cell] = 0;
  return cell;
}
function informedAction(run: Run) {
  const choices = singles(run.cells).map(cell => ({ cell, skill: false, report: previewAction(run, cell) }));
  if (run.mana === 8) run.cells.forEach((value, cell) => { if (!value) choices.push({ cell, skill: true, report: previewAction(run, cell, true) }); });
  expect(choices.length).toBeGreaterThan(0);
  const value = (choice: typeof choices[number]) => (choice.report.defeated ? 10000 : 0) + Math.min(run.enemyHp, choice.report.damage) - choice.report.received * 15;
  choices.sort((a, b) => value(b) - value(a));
  return play(run, choices[0].cell, choices[0].skill);
}
function informedReward(run: Run) {
  if (run.rewards.includes('recovery') && run.hp < run.maxHp * 0.65) return { type: 'reward' as const, relic: 'recovery' as const, revision: run.revision };
  const preference = ['ward', 'wick', 'echo', 'rekindle', 'pen', 'lens', 'glass', 'amplifier', 'battery', 'afterglow', 'stroke', 'training', 'vitality', 'recovery', 'gold'];
  const relic = [...run.rewards].sort((a, b) => preference.indexOf(a) - preference.indexOf(b))[0];
  return { type: 'reward' as const, relic, revision: run.revision };
}
interface EncounterSample {
  encounter: number; enemyHp: number; attack: number; moves: number; sheets: number; filled: number;
  levelStart: number; levelEnd: number; maxChain: number; damage: number; maxDamage: number;
}
function recordEncounter(samples: EncounterSample[], before: Run, after: Run) {
  if (before.phase !== 'battle') return;
  let sample = samples.find(entry => entry.encounter === before.stage + 1);
  if (!sample) {
    sample = { encounter: before.stage + 1, enemyHp: enemyOf(before.stage).hp, attack: enemyOf(before.stage).attack, moves: 0, sheets: 0, filled: 0, levelStart: before.spellLevel, levelEnd: before.spellLevel, maxChain: 0, damage: 0, maxDamage: 0 };
    samples.push(sample);
  }
  const report = after.lastReport!;
  sample.moves++; sample.sheets = before.encounterSheet; sample.filled += report.path.length;
  sample.levelEnd = after.spellLevel; sample.maxChain = Math.max(sample.maxChain, report.path.length);
  sample.damage += report.damage; sample.maxDamage = Math.max(sample.maxDamage, report.damage);
}

describe('validated puzzles and transformed boards', () => {
  it('ships 30 distinct puzzles with 36 blanks, one solution, and a singles-only solution', () => {
    expect(bank).toHaveLength(30);
    expect(new Set(bank.map(p => p.puzzle)).size).toBe(30);
    for (const puzzle of bank) {
      const cells = [...puzzle.puzzle].map(Number);
      expect(cells.filter(v => !v)).toHaveLength(36);
      expect(countSolutions(cells)).toBe(1);
      expect(solveSingles(cells)?.join('')).toBe(puzzle.solution);
    }
  });
  it('keeps valid solutions, nonrepeated source puzzles, and six distinct marks after transformations', () => {
    for (let seed = 0; seed < 30; seed++) {
      const run = fixture(seed).run!;
      expect(new Set(run.puzzleOrder).size).toBe(30);
      expect(solveSingles(run.cells)).toEqual(run.solution);
      expect(run.marks.filter(m => m === 'weak')).toHaveLength(3);
      expect(run.marks.filter(m => m === 'shield')).toHaveLength(3);
      run.marks.forEach((m, i) => { if (m) expect(run.cells[i]).toBe(0); });
    }
  });
});

describe('deterministic actions', () => {
  it('makes preview identical to execution, without changing state or the random stream', () => {
    for (const character of CHARACTERS) {
      const run = fixture(71, character.id).run!;
      run.inventory = RELICS.map(r => r.id); run.maxHp = 32; run.hp = 32; run.mana = 8;
      const before = JSON.stringify(run);
      for (const cell of singles(run.cells)) {
        for (const skill of [false, true]) {
          const forecast = previewAction(run, cell, skill);
          const resolved = resolveAction(run, play(run, cell, skill));
          expect(resolved.lastReport).toEqual(forecast);
          expect(JSON.stringify(run)).toBe(before);
          expect(new Set(forecast.path.map(e => e.cell)).size).toBe(forecast.path.length);
          expect(forecast.path.length).toBeLessThanOrEqual(36);
          expect(resolved.mana).toBeLessThanOrEqual(8);
          if (skill) expect(resolved.mana).toBe(0);
        }
      }
    }
  });
  it('counts simultaneous row/column/box completion once each and applies scribe multiplication correctly', () => {
    const run = fixture(5, 'scribe').run!;
    run.cells = [...run.solution]; run.cells[40] = 0; run.marks.fill(null); run.mana = 8;
    run.inventory = ['pen', 'ward', 'glass', 'amplifier']; run.enemyHp = 400;
    const report = previewAction(run, 40, true);
    expect(report.units).toBe(3);
    expect(report.shield).toBe(9);
    expect(report.damage).toBe(Math.floor((10 + 3 * (20 + 10 + 20) * 3) * 1.25 * 1.5));
    expect(report.fullClear).toBe(true);
    expect(report.defeated).toBe(true);
    expect(report.received).toBe(0);
  });
  it('uses the skill on non-single cells and refuses normal input there', () => {
    const run = fixture().run!; run.mana = 8;
    const cell = run.cells.findIndex((n, i) => !n && candidates(run.cells, i).length > 1);
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(() => resolveAction(run, play(run, cell))).toThrow();
    expect(resolveAction(run, play(run, cell, true)).lastReport!.path[0].value).toBe(run.solution[cell]);
  });
  it('jumps to the same solution digit with echo, and resumes from the echo without duplicating cells', () => {
    const run = fixture(17).run!; run.inventory = ['echo'];
    const root = singles(run.cells).find(i => run.cells.some((v, j) => !v && j !== i && run.solution[i] === run.solution[j]))!;
    const report = previewAction(run, root);
    expect(report.path[1].source).toBe('echo');
    expect(report.path[1].value).toBe(run.solution[root]);
    expect(report.path.length).toBeLessThanOrEqual(6);
    expect(new Set(report.path.map(e => e.cell)).size).toBe(report.path.length);
  });
  it('triggers rekindle once even when the first fill completes three units', () => {
    const run = fixture().run!; run.inventory = ['rekindle'];
    const report = previewAction(run, singles(run.cells)[0]);
    expect(report.path.length).toBeLessThanOrEqual(8);
    run.cells = [...run.solution]; run.cells[0] = 0;
    expect(previewAction(run, 0).path).toHaveLength(1);
  });
  it('preserves and consumes afterglow once, including across encounters', () => {
    const run = fixture().run!; run.inventory = ['afterglow']; run.mana = 8; run.enemyHp = 1;
    let result = resolveAction(run, play(run, singles(run.cells)[0], true));
    expect(result.afterglow).toBe(true); expect(result.mana).toBe(0);
    result = resolveAction(result, { type: 'reward', relic: result.rewards[0], revision: result.revision });
    expect(result.afterglow).toBe(true);
    result = resolveAction(result, play(result));
    expect(result.afterglow).toBe(false);
  });
  it('keeps overkill in the score, but excludes the victory sweep from charge, chain, and fill statistics', () => {
    const save = fixture(); save.run!.enemyHp = 1; save.run!.inventory = ['gold'];
    const result = dispatch(save, play(save.run!));
    const run = result.run!, report = run.lastReport!;
    expect(report.path.length).toBeGreaterThan(1);
    expect(report.sweep.length).toBeGreaterThan(0);
    expect(report.path.length + report.sweep.length).toBe(36);
    expect(run.stats.filled).toBe(report.path.length);
    expect(run.mana).toBe(Math.min(8, report.path.length));
    expect(run.score).toBe(Math.floor(report.damage * 1.5) + 500);
    expect(result.meta.clears).toBe(save.meta.clears + 1);
    expect(run.cells).toEqual(run.solution);
    expect(report.received).toBe(0);
  });
  it('doubles the third counterattack in stage 3 and the boss, without carrying shields', () => {
    const run = fixture().run!;
    for (const stage of [2, 5]) {
      run.stage = stage; run.turn = 1;
      const normal = incomingAttack(run); run.turn = 2;
      expect(incomingAttack(run)).toBe(normal * 2);
    }
    run.enemyHp = 800;
    const first = resolveAction(run, play(run));
    if (first.phase === 'battle') {
      const second = previewAction(first, singles(first.cells)[0]);
      expect(second.shield).toBe(second.path.filter(e => e.mark === 'shield').length * 6);
    }
  });
  it('can lose to a counterattack, and never counterattacks after a lethal spell', () => {
    const save = fixture(); const run = save.run!; run.hp = 1; run.enemyHp = 800; run.stage = 5; run.turn = 2; run.stats.kills = 5;
    const root = singles(run.cells).find(i => previewAction(run, i).received > 0)!;
    expect(root).toBeDefined();
    expect(dispatch(save, play(run, root)).run!.phase).toBe('lost');
    run.enemyHp = 1;
    const win = dispatch(save, play(run, root));
    expect(win.run!.phase).toBe('reward'); expect(win.run!.hp).toBe(11); expect(win.meta.wins).toBe(0);
    expect(win.meta.bestKills).toBe(6);
    expect(win.run!.score).toBe(win.run!.lastReport!.attackScore + 500);
  });
  it('does not accept duplicate actions or duplicate reward collection', () => {
    const save = fixture(); save.run!.enemyHp = 1;
    const action = play(save.run!);
    const next = dispatch(save, action);
    expect(() => dispatch(next, action)).toThrow();
    const reward = { type: 'reward' as const, relic: next.run!.rewards[0], revision: next.run!.revision };
    const advanced = dispatch(next, reward);
    expect(() => dispatch(advanced, reward)).toThrow();
    expect(advanced.run!.stage).toBe(1);
    expect(advanced.meta.clears).toBe(next.meta.clears);
  });
});

describe('progression, rewards and persistence', () => {
  it('cycles enemy artwork while HP and attacks keep growing beyond all six archetypes', () => {
    expect(enemyOf(0)).toMatchObject({ archetypeIndex: 0, encounter: 1, cycle: 1, hp: 1400, attack: 3, strongEvery: 0 });
    expect(enemyOf(6)).toMatchObject({ archetypeIndex: 0, encounter: 7, cycle: 2, symbol: 'ember', hp: 13500, attack: 9 });
    expect(enemyOf(17)).toMatchObject({ archetypeIndex: 5, encounter: 18, cycle: 3, symbol: 'dragon', strongEvery: 3 });
    for (let stage = 1; stage < 60; stage++) {
      expect(enemyOf(stage).hp).toBeGreaterThan(enemyOf(stage - 1).hp);
      expect(enemyOf(stage).attack).toBeGreaterThanOrEqual(enemyOf(stage - 1).attack);
    }
    expect(enemyOf(30).hp / enemyOf(20).hp).toBeGreaterThan(spellMultiplier(30) / spellMultiplier(20));
    const run = fixture().run!; run.stage = 17; run.turn = 1;
    const normal = incomingAttack(run); run.turn = 2;
    expect(incomingAttack(run)).toBe(normal * 2);
  });
  it('uses level growth in both chain allowance and damage while retaining valid read-only forecasts', () => {
    const run = fixture(31).run!, before = structuredClone(run), roots = singles(run.cells);
    const low = roots.map(cell => previewAction(run, cell));
    expect(chainBonus(1)).toBe(0); expect(chainCapacity(run)).toBe(4);
    run.spellLevel = 20;
    expect(chainBonus(20)).toBe(19); expect(chainCapacity(run)).toBe(23);
    const high = roots.map(cell => previewAction(run, cell));
    expect(Math.max(...high.map(report => report.path.length))).toBeGreaterThan(Math.max(...low.map(report => report.path.length)));
    expect(Math.max(...high.map(report => report.damage))).toBeGreaterThan(Math.max(...low.map(report => report.damage)) * 4);
    for (let i = 0; i < roots.length; i++) {
      expect(high[i].chain!.bonuses).toContainEqual({ label: '術式成長', amount: 19 });
      expect(new Set(high[i].path.map(event => event.cell)).size).toBe(high[i].path.length);
      expect(high[i].path.length).toBeLessThanOrEqual(36);
      expect(resolveAction(run, play(run, roots[i])).lastReport).toEqual(high[i]);
    }
    run.spellLevel = 1; expect(run).toEqual(before);
  });
  it('keeps offering deterministic repeatable rewards as the unique relic pool runs out', () => {
    for (const missing of [2, 1, 0]) {
      const save = fixture(43), run = save.run!;
      run.stage = 12; run.stats.kills = 12; run.inventory = run.pool.slice(missing); run.enemyHp = 1;
      const next = dispatch(save, play(run));
      expect(next.run!.phase).toBe('reward'); expect(next.run!.stats.kills).toBe(13);
      expect(next.run!.rewards).toHaveLength(3); expect(new Set(next.run!.rewards).size).toBe(3);
      expect(next.run!.rewards.filter(id => REPEATABLE_REWARDS.some(reward => reward.id === id))).toHaveLength(3 - missing);
      expect(next.run!.rewards.every(id => !!rewardOf(id))).toBe(true);
      expect(dispatch(save, play(run))).toEqual(next); expect(parseSave(JSON.stringify(next))).toEqual(next);
      for (const relic of next.run!.rewards) {
        const reward = { type: 'reward' as const, relic, revision: next.run!.revision };
        const advanced = dispatch(next, reward);
        expect(dispatch(parseSave(JSON.stringify(next)), reward)).toEqual(advanced);
        expect(advanced.run).toMatchObject({ phase: 'battle', stage: 13, encounterSheet: 1, enemyHp: enemyOf(13).hp });
        if (REPEATABLE_REWARDS.some(option => option.id === relic)) expect(advanced.run!.inventory).toEqual(next.run!.inventory);
        expect(() => dispatch(advanced, reward)).toThrow('すでに処理');
      }
    }
  });
  it('applies repeatable training, vitality and recovery without treating them as duplicate relics', () => {
    const run = fixture().run!;
    run.phase = 'reward'; run.hp = 7; run.rewards = ['training', 'vitality', 'recovery'];
    const choose = (relic: 'training' | 'vitality' | 'recovery') => resolveAction(run, { type: 'reward', relic, revision: run.revision });
    expect(choose('training')).toMatchObject({ spellLevel: 2, maxHp: 44, hp: 17, inventory: [] });
    expect(choose('vitality')).toMatchObject({ spellLevel: 1, maxHp: 52, hp: 19, inventory: [] });
    expect(choose('recovery')).toMatchObject({ spellLevel: 1, maxHp: 40, hp: 40, inventory: [] });
    let next = choose('training'); next.phase = 'reward'; next.rewards = [...run.rewards];
    next = resolveAction(next, { type: 'reward', relic: 'training', revision: next.revision });
    expect(next).toMatchObject({ spellLevel: 3, maxHp: 48, hp: 27, inventory: [] });
  });
  it('preserves old terminal victories and migrates the highest kill count safely', () => {
    const legacy = fixture(11) as any;
    legacy.meta.wins = 1; delete legacy.meta.bestKills;
    legacy.run.stage = 5; legacy.run.stats.kills = 6; legacy.run.enemyHp = 0; legacy.run.phase = 'won';
    legacy.run.cells = [...legacy.run.solution];
    const restored = parseSave(JSON.stringify(legacy));
    expect(restored.run!.phase).toBe('won'); expect(restored.meta.bestKills).toBe(6);
    expect(() => dispatch(restored, { type: 'play', cell: 0, skill: false, revision: restored.run!.revision })).toThrow();
    const abandoned = structuredClone(legacy); abandoned.run = null;
    expect(parseSave(JSON.stringify(abandoned)).meta.bestKills).toBe(6);
    const oldActive = fixture(19) as any;
    oldActive.run.stage = 8; oldActive.run.stats.kills = 8; oldActive.run.enemyHp = enemyOf(8).hp; delete oldActive.meta.bestKills;
    const active = parseSave(JSON.stringify(oldActive));
    expect(active.meta.bestKills).toBe(8); expect(active.run!.phase).toBe('battle');
    expect(parseSave(JSON.stringify(active))).toEqual(active);
    active.run!.enemyHp = 1;
    const killed = dispatch(active, play(active.run!));
    expect(killed.run!.phase).toBe('reward'); expect(killed.meta.bestKills).toBe(9); expect(killed.meta.wins).toBe(0);
  });
  it('continues a completed sheet against the same enemy, preserving resources and attack cadence', () => {
    const save = fixture(39), run = save.run!;
    run.stage = 2; run.stats.kills = 2; run.enemyHp = ENEMIES[2].hp; run.turn = 1;
    run.hp = 30; run.mana = 8; run.inventory = ['afterglow'];
    const cell = leaveLastCell(run), snapshot = structuredClone(save);
    const forecast = previewAction(run, cell, true);
    expect(save).toEqual(snapshot);
    expect(previewAction(run, cell, true)).toEqual(forecast);
    const next = dispatch(save, play(run, cell, true)), continued = next.run!;
    expect(continued.lastReport).toEqual(forecast);
    expect(forecast).toMatchObject({ fullClear: true, defeated: false, sheetAdvanced: true, levelsGained: 1, spellLevelBefore: 1, spellLevelAfter: 2, maxHpGained: 4, healed: 10, incoming: 4, received: 4, sweep: [] });
    expect(continued).toMatchObject({ stage: 2, phase: 'battle', turn: 2, hp: 36, maxHp: 44, mana: 0, afterglow: true, sheet: 2, encounterSheet: 2, puzzleCursor: 1, spellLevel: 2, rewards: [] });
    expect(continued.enemyHp).toBe(run.enemyHp - forecast.damage);
    expect(continued.stats.kills).toBe(2); expect(continued.stats.sheets).toBe(1);
    expect(next.meta.clears).toBe(save.meta.clears); expect(continued.score).toBe(run.score + forecast.attackScore);
    expect(incomingAttack(continued)).toBe(8); // Third attack still approaches on this enemy.
    expect(continued.cells.filter(v => !v)).toHaveLength(36);
    expect(solveSingles(continued.cells)).toEqual(continued.solution);
    const restored = parseSave(JSON.stringify(next)); expect(restored).toEqual(next);
    expect(dispatch(restored, play(continued))).toEqual(dispatch(next, play(continued)));
    expect(() => dispatch(next, play(run, cell, true))).toThrow('すでに処理');
  });
  it('loses to a lethal counterattack on the last cell before healing or advancing', () => {
    const save = fixture(), run = save.run!;
    run.stage = 5; run.stats.kills = 5; run.enemyHp = ENEMIES[5].hp; run.turn = 2; run.hp = 1;
    const result = dispatch(save, play(run, leaveLastCell(run))).run!;
    expect(result).toMatchObject({ phase: 'lost', hp: 0, spellLevel: 1, sheet: 1, maxHp: 40 });
    expect(result.lastReport).toMatchObject({ fullClear: true, defeated: false, sheetAdvanced: false, levelsGained: 0, healed: 0, incoming: 12 });
    expect(result.cells).toEqual(result.solution);
    expect(parseSave(JSON.stringify({ ...save, run: result })).run).toEqual(result);
  });
  it('scales damage with sustained levels and grants both sheet and enemy growth when both complete', () => {
    const run = fixture().run!, cell = leaveLastCell(run);
    const base = previewAction(run, cell).damage;
    run.spellLevel = 4; run.hp = 20; run.enemyHp = 1;
    const result = resolveAction(run, play(run, cell)), report = result.lastReport!;
    expect(spellMultiplier(1)).toBe(1); expect(spellMultiplier(4)).toBeCloseTo(1.6);
    expect(report.damage).toBe(Math.floor(base * spellMultiplier(4)));
    expect(result).toMatchObject({ phase: 'reward', spellLevel: 6, maxHp: 48, hp: 40, sheet: 1, encounterSheet: 1 });
    expect(report).toMatchObject({ fullClear: true, defeated: true, sheetAdvanced: false, levelsGained: 2, maxHpGained: 8, healed: 20, spellLevelBefore: 4, spellLevelAfter: 6 });
    expect(result.stats.sheets).toBe(1); expect(result.stats.kills).toBe(1);
    const advanced = resolveAction(result, { type: 'reward', relic: result.rewards.find(id => id !== 'glass')!, revision: result.revision });
    expect(advanced).toMatchObject({ stage: 1, spellLevel: 6, sheet: 2, encounterSheet: 1, turn: 0, enemyHp: ENEMIES[1].hp });
  });
  it('uses all 30 sources before deterministic replenishment without an immediate repeat', () => {
    let run = fixture(61).run!;
    run.stage = 5; run.stats.kills = 5;
    const firstDeck = [...run.puzzleOrder], sources = [run.puzzleOrder[run.puzzleCursor]];
    for (let sheet = 1; sheet <= 32; sheet++) {
      run.enemyHp = ENEMIES[5].hp;
      const cell = leaveLastCell(run), before = structuredClone(run), forecast = previewAction(run, cell);
      const next = resolveAction(run, play(run, cell));
      expect(run).toEqual(before); expect(next.lastReport).toEqual(forecast); expect(next.lastReport!.sheetAdvanced).toBe(true);
      run = next; sources.push(run.puzzleOrder[run.puzzleCursor]);
      expect(parseSave(JSON.stringify({ ...newSave(), run })).run).toEqual(run);
    }
    expect(sources.slice(0, 30)).toEqual(firstDeck); expect(new Set(sources.slice(0, 30)).size).toBe(30);
    expect(sources[30]).not.toBe(sources[29]); expect(run.puzzleOrder).not.toEqual(firstDeck);
    expect(run.puzzleCursor).toBe(2); expect(run.sheet).toBe(33); expect(run.stats.sheets).toBe(32);
    expect(run.spellLevel).toBe(33);
  });
  it('migrates original six-board v1 runs without rerolling current boards, HP, rewards or random state', () => {
    let save = fixture(91);
    for (let stage = 0; stage < 2; stage++) {
      save.run!.enemyHp = 1; save = dispatch(save, play(save.run!));
      save = dispatch(save, { type: 'reward', relic: save.run!.rewards.find(id => id !== 'glass')!, revision: save.run!.revision });
    }
    const legacy = structuredClone(save) as any, original = structuredClone(save.run!);
    legacy.run.maxHp = 32; legacy.run.hp = 24; legacy.run.enemyHp = 340; legacy.run.mana = 5; legacy.run.turn = 7;
    legacy.run.afterglow = true; legacy.run.puzzleOrder = legacy.run.puzzleOrder.slice(0, 6);
    for (const key of ['spellLevel', 'sheet', 'encounterSheet', 'puzzleCursor']) delete legacy.run[key];
    delete legacy.run.stats.sheets;
    const restored = parseSave(JSON.stringify(legacy));
    expect(restored.run).toMatchObject({ spellLevel: 3, sheet: 3, encounterSheet: 1, puzzleCursor: 2, maxHp: 32, hp: 24, enemyHp: 340, mana: 5, turn: 7, afterglow: true, randomState: original.randomState, revision: original.revision });
    expect(restored.run!.cells).toEqual(original.cells); expect(restored.run!.solution).toEqual(original.solution);
    expect(restored.run!.puzzleOrder.slice(0, 6)).toEqual(legacy.run.puzzleOrder);
    expect(new Set(restored.run!.puzzleOrder).size).toBe(30); expect(restored.run!.stats.sheets).toBe(0);
    expect(parseSave(JSON.stringify(legacy))).toEqual(restored); expect(parseSave(JSON.stringify(restored))).toEqual(restored);
    expect(dispatch(parseSave(JSON.stringify(restored)), play(restored.run!))).toEqual(dispatch(restored, play(restored.run!)));
    const invalid = structuredClone(restored); invalid.run!.puzzleCursor = 30;
    expect(() => parseSave(JSON.stringify(invalid))).toThrow('成長');
    invalid.run!.puzzleCursor = 2; invalid.run!.puzzleOrder[29] = invalid.run!.puzzleOrder[0];
    expect(() => parseSave(JSON.stringify(invalid))).toThrow('問題');
  });
  it('unlocks by cumulative clears and freezes the relic pool for the current run', () => {
    const save = fixture(13, 'fuse', 2); save.run!.enemyHp = 1;
    expect(save.run!.pool).toHaveLength(9);
    const next = dispatch(save, play(save.run!));
    expect(next.meta.clears).toBe(3); expect(next.run!.pool).not.toContain('echo');
    expect(startRun(next, 'scribe', 2).run!.pool).toContain('echo');
    expect(() => startRun(next, 'lumen', 2)).toThrow();
    expect(fixture(1, 'lumen', 12).run!.pool).toHaveLength(12);
  });
  it('offers three distinct unowned relics with an affinity option when available', () => {
    for (const c of CHARACTERS) {
      for (let seed = 0; seed < 10; seed++) {
        const save = fixture(seed, c.id); save.run!.enemyHp = 1;
        const run = dispatch(save, play(save.run!)).run!;
        expect(run.rewards).toHaveLength(3);
        expect(new Set(run.rewards).size).toBe(3);
        expect(run.rewards.some(id => characterOf(c.id).affinity.some(relic => relic === id))).toBe(true);
        expect(run.rewards.every(id => !run.inventory.some(relic => relic === id))).toBe(true);
      }
    }
  });
  it('applies glass maximum HP loss and clamps current HP', () => {
    const run = fixture().run!; run.phase = 'reward'; run.rewards = ['glass', 'pen', 'wick'];
    const next = resolveAction(run, { type: 'reward', relic: 'glass', revision: run.revision });
    expect(next.maxHp).toBe(32); expect(next.hp).toBe(32);
  });
  it('round trips battle and reward states without rerolling, and rejects corrupted saves', () => {
    const save = fixture(91);
    expect(parseSave(JSON.stringify(save))).toEqual(save);
    save.run!.enemyHp = 1;
    const next = dispatch(save, play(save.run!));
    const restored = parseSave(JSON.stringify(next));
    expect(restored).toEqual(next);
    const action = { type: 'reward' as const, relic: next.run!.rewards[0], revision: next.run!.revision };
    expect(dispatch(restored, action)).toEqual(dispatch(next, action));
    expect(() => parseSave('{broken')).toThrow();
    const invalid = structuredClone(next); invalid.run!.solution[0] = 0;
    expect(() => parseSave(JSON.stringify(invalid))).toThrow();
  });
  it('continues beyond six encounters and eventually loses to actual attacks without stalling', () => {
    const results: { seed: number; phase: Run['phase']; kills: number; moves: number; sheets: number; level: number; hp: number; maxHp: number; bestChain: number; finalAttack: number; shield: number; encounters: EncounterSample[] }[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      let save = fixture(seed, 'fuse', 0);
      const encounters: EncounterSample[] = [];
      const visited = [save.run!.puzzleOrder[save.run!.puzzleCursor]];
      while (save.run!.phase === 'battle' || save.run!.phase === 'reward') {
        const run = save.run!;
        expect(run.stats.moves).toBeLessThan(2000); // Test budget only; there is no runtime encounter cap.
        save = dispatch(save, run.phase === 'reward' ? informedReward(run) : informedAction(run));
        recordEncounter(encounters, run, save.run!);
        if (save.run!.sheet !== run.sheet) {
          const source = save.run!.puzzleOrder[save.run!.puzzleCursor];
          if (save.run!.puzzleCursor === 0) { expect(visited.at(-1)).not.toBe(source); visited.length = 0; }
          expect(visited).not.toContain(source); visited.push(source);
        }
        expect(parseSave(JSON.stringify(save))).toEqual(save);
      }
      const run = save.run!;
      expect(run.phase).toBe('lost'); expect(run.stats.kills).toBeGreaterThan(6);
      expect(run.stats.bestChain).toBeGreaterThanOrEqual(20); expect(run.lastReport!.received).toBeGreaterThanOrEqual(run.lastReport!.hpBefore);
      expect(save.meta.bestKills).toBe(run.stats.kills); expect(save.meta.wins).toBe(0); expect(save.meta.bestScore).toBe(run.score);
      results.push({ seed, phase: run.phase, kills: run.stats.kills, moves: run.stats.moves, sheets: run.sheet, level: run.spellLevel, hp: run.hp, maxHp: run.maxHp, bestChain: run.stats.bestChain, finalAttack: run.lastReport!.incoming, shield: run.lastReport!.shield, encounters });
    }
    mkdirSync('.runtime', { recursive: true });
    writeFileSync('.runtime/balance-sample.json', JSON.stringify({ method: 'Deterministic informed endless play with ward/recovery priority, not a human playtest', runs: results.length, results }, null, 2));
  }, 60000);
  it('lets each unlocked character reach long chains before enemy inflation outgrows the run', () => {
    const results: { character: CharacterId; seed: number; phase: Run['phase']; kills: number; moves: number; sheets: number; level: number; hp: number; maxHp: number; bestChain: number; encounters: EncounterSample[] }[] = [];
    for (const character of CHARACTERS) {
      for (let seed = 21; seed <= 24; seed++) {
        let save = fixture(seed, character.id, 12);
        const encounters: EncounterSample[] = [];
        while (save.run!.phase === 'battle' || save.run!.phase === 'reward') {
          const run = save.run!;
          expect(run.stats.moves).toBeLessThan(2000);
          save = dispatch(save, run.phase === 'reward' ? informedReward(run) : informedAction(run));
          recordEncounter(encounters, run, save.run!);
        }
        const run = save.run!;
        expect(run.stats.sheets).toBeGreaterThan(0); expect(run.spellLevel).toBeGreaterThan(6);
        expect(parseSave(JSON.stringify(save))).toEqual(save);
        expect(run.phase).toBe('lost'); expect(run.stats.kills).toBeGreaterThan(6);
        expect(run.stats.bestChain).toBeGreaterThanOrEqual(20); expect(run.lastReport!.received).toBeGreaterThanOrEqual(run.lastReport!.hpBefore);
        results.push({ character: character.id, seed, phase: run.phase, kills: run.stats.kills, moves: run.stats.moves, sheets: run.sheet, level: run.spellLevel, hp: run.hp, maxHp: run.maxHp, bestChain: run.stats.bestChain, encounters });
      }
    }
    mkdirSync('.runtime', { recursive: true });
    writeFileSync('.runtime/character-balance-sample.json', JSON.stringify({ method: 'Deterministic informed endless play with unlocked relics and ward/recovery priority, not a human playtest', runs: results.length, results }, null, 2));
  }, 60000);
});
