import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import bank from '../src/game/puzzles.json';
import { CHARACTERS, ENEMIES, REPEATABLE_REWARDS, RELICS, primeIds, characterOf, enemyOf, rewardOf } from '../src/game/content';
import { canUseSkill, chainBonus, chainCapacity, dispatch, incomingAttack, newSave, previewAction, resolveAction, sheetShield, spellMultiplier, startRun } from '../src/game/engine';
import { parseSave } from '../src/game/storage';
import { needsRelicReplacement } from '../src/game/relic-slots';
import { enemyForRun } from '../src/game/enemies';
import { candidates, countSolutions, PEERS, singles, solveSingles, UNITS } from '../src/game/sudoku';
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
  if (canUseSkill(run)) run.cells.forEach((value, cell) => { if (!value) choices.push({ cell, skill: true, report: previewAction(run, cell, true) }); });
  expect(choices.length).toBeGreaterThan(0);
  const value = (choice: typeof choices[number]) => (choice.report.defeated ? 10000 : 0) + Math.min(run.enemyHp, choice.report.damage) - choice.report.received * 15;
  choices.sort((a, b) => value(b) - value(a));
  return play(run, choices[0].cell, choices[0].skill);
}
function informedReward(run: Run) {
  if (run.rewards.includes('recovery') && run.hp < run.maxHp * 0.65) return { type: 'reward' as const, relic: 'recovery' as const, revision: run.revision };
  const preference = ['skill-upgrade', 'greater:wick', 'greater:lens', 'greater:stroke', 'greater:trinity', 'greater:duality', 'greater:quint', 'greater:sept', 'magic-boon', 'defense-boon', 'duality', 'quint', 'sept', 'ward', 'wick', 'echo', 'rekindle', 'pen', 'lens', 'glass', 'amplifier', 'battery', 'afterglow', 'stroke', 'trinity', 'training', 'vitality', 'recovery', 'gold'];
  const relic = [...run.rewards].sort((a, b) => (preference.includes(a) ? preference.indexOf(a) : 999) - (preference.includes(b) ? preference.indexOf(b) : 999))[0];
  const replace = needsRelicReplacement(run, relic) ? [...run.inventory].sort((a, b) => preference.indexOf(b) - preference.indexOf(a))[0] : undefined;
  return { type: 'reward' as const, relic, replace, revision: run.revision };
}
interface EncounterSample {
  encounter: number; enemyHp: number; attack: number; moves: number; sheets: number; filled: number;
  levelStart: number; levelEnd: number; maxChain: number; damage: number; maxDamage: number;
}
function recordEncounter(samples: EncounterSample[], before: Run, after: Run) {
  if (before.phase !== 'battle') return;
  let sample = samples.find(entry => entry.encounter === before.stage + 1);
  if (!sample) {
    sample = { encounter: before.stage + 1, enemyHp: before.enemyHp, attack: enemyForRun(before).attack, moves: 0, sheets: 0, filled: 0, levelStart: before.spellLevel, levelEnd: before.spellLevel, maxChain: 0, damage: 0, maxDamage: 0 };
    samples.push(sample);
  }
  const report = after.lastReport!;
  sample.moves++; sample.sheets = Math.max(before.encounterSheet, after.encounterSheet); sample.filled += report.path.length;
  sample.levelEnd = after.spellLevel; sample.maxChain = Math.max(sample.maxChain, report.path.length);
  sample.damage += report.damage; sample.maxDamage = Math.max(sample.maxDamage, report.damage);
}

describe('validated puzzles and transformed boards', () => {
  it('ships 100 distinct puzzles with 36 blanks, one solution, and a singles-only solution', () => {
    expect(bank).toHaveLength(100);
    expect(new Set(bank.map(p => p.id)).size).toBe(bank.length);
    expect(new Set(bank.map(p => p.puzzle)).size).toBe(bank.length);
    const masks = bank.map(p => [...p.puzzle].map(value => value === '0'));
    for (let left = 0; left < masks.length; left++) for (let right = left + 1; right < masks.length; right++) {
      expect(masks[left].filter((blank, cell) => blank !== masks[right][cell]).length).toBeGreaterThanOrEqual(18);
    }
    for (const puzzle of bank) {
      const cells = [...puzzle.puzzle].map(Number);
      expect(cells.filter(v => !v)).toHaveLength(36);
      expect(countSolutions(cells)).toBe(1);
      expect(solveSingles(cells)?.join('')).toBe(puzzle.solution);
    }
  });
  it('keeps valid solutions, nonrepeated source puzzles, and six distinct marks after transformations', () => {
    for (let seed = 0; seed < bank.length; seed++) {
      const run = fixture(seed).run!;
      expect(new Set(run.puzzleOrder).size).toBe(bank.length);
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
      run.inventory = RELICS.filter(r => !primeIds.includes(r.id)).map(r => r.id); run.maxHp = 32; run.hp = 32; run.mana = 8;
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
    run.cells = [...run.solution]; run.cells[40] = 0; run.givens = run.cells.map(Boolean); run.marks.fill(null); run.mana = 8;
    run.inventory = ['pen', 'ward', 'glass', 'amplifier']; run.enemyHp = 400;
    const report = previewAction(run, 40, true);
    expect(report.units).toBe(3);
    expect(report.shield).toBe(6);
    const base = Math.floor((10 + 3 * (20 + 10 + 20) * 3) * (1 + .2 + .35));
    expect(report.baseDamage).toBe(base); expect(report.clearBonus).toBe(Math.floor(base * .25));
    expect(report.damage).toBe(base + Math.floor(base * .25));
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
    expect(report.path.length).toBeLessThanOrEqual(7);
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
    expect(run.mana).toBe(Math.min(5, report.path.length));
    expect(run.score).toBe(Math.floor(report.damage * 1.5) + 500);
    expect(result.meta.clears).toBe(save.meta.clears + 1);
    expect(run.cells).toEqual(run.solution);
    expect(report.received).toBe(0);
  });
  it('doubles the third counterattack in stage 3 and the boss while retaining defenses within a sheet', () => {
    const run = fixture().run!;
    for (const stage of [2, 4, 9]) {
      run.stage = stage; run.turn = 1;
      const normal = incomingAttack(run); run.turn = 2;
      expect(incomingAttack(run)).toBe(normal * 2);
    }
    run.enemyHp = 800;
    const first = resolveAction(run, play(run));
    if (first.phase === 'battle') {
      const second = previewAction(first, singles(first.cells)[0]);
      expect(second.shield).toBe(sheetShield(first) + second.path.filter(e => e.mark === 'shield').length * 6);
    }
  });
  it('can lose to a counterattack, and never counterattacks after a lethal spell', () => {
    const save = fixture(); const run = save.run!; run.hp = 1; run.enemyHp = 800; run.stage = 5; run.turn = 1; run.stats.kills = 5;
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
  it('retains earned sheet defenses for disconnected final cells and restores them from existing save fields', () => {
    const save = fixture(1), run = save.run!;
    run.stage = 12; run.stats.kills = 12; run.enemyRulesVersion = 0; run.enemyHp = enemyOf(12).hp; run.spellLevel = 30;
    run.inventory = ['ward']; run.mana = 8;
    const blanks = run.givens.flatMap((given, cell) => !given && !run.marks[cell] ? [cell] : []);
    const a = blanks[0], b = blanks.find(cell => cell !== a && !PEERS[a].includes(cell))!;
    expect(b).toBeDefined(); run.cells = [...run.solution]; run.cells[a] = 0; run.cells[b] = 0;
    const givenUnits = UNITS.filter(unit => unit.every(cell => run.givens[cell])).length;
    const beforeShield = 18 + (21 - givenUnits) * 2;
    expect(sheetShield(run)).toBe(beforeShield);
    const restored = parseSave(JSON.stringify(save)); expect(restored).toEqual(save);
    expect(sheetShield(restored.run!)).toBe(beforeShield);
    const forecast = previewAction(run, a), next = dispatch(restored, play(run, a));
    expect(forecast.path).toHaveLength(1); expect(forecast.chain!.stopReason).toBe('no-target');
    expect(forecast.shield).toBe(beforeShield + 6); expect(forecast.incoming).toBe(enemyOf(12).attack); expect(forecast.received).toBe(0);
    expect(next.run!.lastReport).toEqual(forecast); expect(next.run!.hp).toBe(run.hp);
    expect(sheetShield(next.run!)).toBe(forecast.shield);
    const loaded = parseSave(JSON.stringify(next)), finalForecast = previewAction(loaded.run!, b);
    expect(finalForecast).toMatchObject({ fullClear: true, defeated: false, incoming: enemyOf(12).attack, received: 0, sheetAdvanced: true });
    expect(finalForecast.shield).toBe(18 + (27 - givenUnits) * 2);
    const final = dispatch(loaded, play(loaded.run!, b));
    expect(final.run!.lastReport).toEqual(finalForecast);
    expect(final.run!.stage).toBe(run.stage); expect(final.run!.turn).toBe(run.turn + 2);
    expect(sheetShield(final.run!)).toBe(0); expect(final.run!.sheet).toBe(run.sheet + 1);
    expect(parseSave(JSON.stringify(final))).toEqual(final);
    expect(() => dispatch(final, play(loaded.run!, b))).toThrow('すでに処理');
  });
  it('keeps shield marks active on later hands without ward and resets them for a new enemy', () => {
    const save = fixture(11), run = save.run!;
    const mark = run.marks.findIndex((m, cell) => m === 'shield' && !run.givens[cell]);
    run.cells[mark] = run.solution[mark];
    expect(sheetShield(run)).toBe(6);
    const root = singles(run.cells).find(cell => previewAction(run, cell).path.every(event => event.mark !== 'shield'))!;
    expect(root).toBeDefined(); const forecast = previewAction(run, root);
    expect(forecast.shield).toBe(6); expect(forecast.received).toBe(0);
    run.enemyHp = 1;
    const reward = dispatch(save, play(run, root));
    const advanced = dispatch(reward, { type: 'reward', relic: reward.run!.rewards[0], revision: reward.run!.revision });
    expect(sheetShield(advanced.run!)).toBe(0);
  });
  it('does not award ward defenses for units completely supplied as givens', () => {
    const run = fixture().run!; run.inventory = ['ward']; run.marks.fill(null);
    run.givens = run.solution.map((_, cell) => cell < 45);
    run.cells = run.solution.map((value, cell) => run.givens[cell] ? value : 0);
    expect(UNITS.filter(unit => unit.every(cell => run.givens[cell]))).toHaveLength(8);
    expect(sheetShield(run)).toBe(0);
    run.cells = [...run.solution];
    expect(sheetShield(run)).toBe((27 - 8) * 2);
  });
  it('does not award defenses from an enemy victory sweep, including restored reward and legacy won states', () => {
    const save = fixture(21), run = save.run!;
    run.inventory = ['ward']; run.mana = 8; run.enemyHp = 1;
    const next = dispatch(save, play(run, singles(run.cells)[0], true)), defeated = next.run!;
    expect(defeated.lastReport!.sweep.length).toBeGreaterThan(0); expect(defeated.lastReport!.fullClear).toBe(false);
    expect(defeated.cells).toEqual(defeated.solution);
    expect(sheetShield(defeated)).toBe(defeated.lastReport!.shield);
    expect(sheetShield(parseSave(JSON.stringify(next)).run!)).toBe(defeated.lastReport!.shield);
    const won = structuredClone(defeated); won.rewardStep = undefined; won.phase = 'won'; won.stage = 5; won.stats.kills = 6;
    expect(sheetShield(won)).toBe(defeated.lastReport!.shield);
    expect(sheetShield(parseSave(JSON.stringify({ ...save, run: won })).run!)).toBe(defeated.lastReport!.shield);
  });
  it('cycles enemy artwork and every-fifth bosses while HP and attacks keep growing', () => {
    expect(enemyOf(0)).toMatchObject({ archetypeIndex: 0, encounter: 1, cycle: 1, hp: 1400, attack: 3, strongEvery: 0 });
    expect(enemyOf(6)).toMatchObject({ archetypeIndex: 1, encounter: 7, cycle: 2, symbol: 'wing', hp: 9700, attack: 6 });
    expect(enemyOf(19)).toMatchObject({ archetypeIndex: 5, encounter: 20, cycle: 4, symbol: 'dragon', strongEvery: 3 });
    for (let stage = 1; stage < 60; stage++) {
      expect(enemyOf(stage).hp).toBeGreaterThan(enemyOf(stage - 1).hp);
      expect(enemyOf(stage).attack).toBeGreaterThanOrEqual(enemyOf(stage - 1).attack);
    }
    expect(enemyOf(30).hp / enemyOf(20).hp).toBeGreaterThan(spellMultiplier(30) / spellMultiplier(20));
    const run = fixture().run!; run.stage = 19; run.turn = 1;
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
      run.stage = 12; run.stats.kills = 12; run.inventory = run.pool.slice(missing); run.relicLevels = Object.fromEntries(run.inventory.map(id => [id,10])); for (const id of primeIds) run.acquisitionRank[id] = 3; run.enemyHp = 1;
      const next = dispatch(save, play(run));
      expect(next.run!.phase).toBe('reward'); expect(next.run!.stats.kills).toBe(13);
      expect(next.run!.rewards).toHaveLength(3); expect(new Set(next.run!.rewards).size).toBe(3);
      expect(next.run!.rewards.filter(id => REPEATABLE_REWARDS.some(reward => reward.id === id))).toHaveLength(Math.max(2, 3 - missing));
      expect(next.run!.rewards.every(id => !!rewardOf(id))).toBe(true);
      expect(dispatch(save, play(run))).toEqual(next); expect(parseSave(JSON.stringify(next))).toEqual(next);
      for (const relic of next.run!.rewards) {
        const reward = { type: 'reward' as const, relic, replace: needsRelicReplacement(next.run!, relic) ? next.run!.inventory[0] : undefined, revision: next.run!.revision };
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
    expect(forecast).toMatchObject({ fullClear: true, defeated: false, sheetAdvanced: true, levelsGained: 1, spellLevelBefore: 1, spellLevelAfter: 2, maxHpGained: 4, healed: 10, incoming: 4, received: 0, sweep: [] });
    expect(continued).toMatchObject({ stage: 2, phase: 'battle', turn: 2, hp: 40, maxHp: 44, mana: 0, afterglow: true, sheet: 2, encounterSheet: 2, puzzleCursor: 1, spellLevel: 2, rewards: [] });
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
    run.stage = 30; run.stats.kills = 30; run.enemyHp = enemyOf(30).hp; run.turn = 2; run.hp = 1;
    const result = dispatch(save, play(run, leaveLastCell(run))).run!;
    expect(result).toMatchObject({ phase: 'lost', hp: 0, spellLevel: 1, sheet: 1, maxHp: 40 });
    expect(result.lastReport).toMatchObject({ fullClear: true, defeated: false, sheetAdvanced: false, levelsGained: 0, healed: 0, incoming: 73, shield: 18, received: 55 });
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
    const advanced = resolveAction(result, { type: 'reward', relic: result.rewards.find(id => id !== 'glass' && id !== 'training')!, revision: result.revision });
    expect(advanced).toMatchObject({ stage: 1, spellLevel: 6, sheet: 2, encounterSheet: 1, turn: 0, enemyHp: ENEMIES[1].hp });
  });
  it('uses every source once per deck before deterministic replenishment without boundary repeats', () => {
    let run = fixture(61).run!;
    run.stage = 5; run.stats.kills = 5;
    const firstDeck = [...run.puzzleOrder], sources = [run.puzzleOrder[run.puzzleCursor]];
    const completedSheets = bank.length * 2 + 2;
    for (let sheet = 1; sheet <= completedSheets; sheet++) {
      run.enemyHp = enemyOf(run.stage).hp;
      const cell = leaveLastCell(run), before = structuredClone(run), forecast = previewAction(run, cell);
      const next = resolveAction(run, play(run, cell));
      expect(run).toEqual(before); expect(next.lastReport).toEqual(forecast); expect(next.lastReport!.sheetAdvanced).toBe(true);
      run = next; sources.push(run.puzzleOrder[run.puzzleCursor]);
      expect(parseSave(JSON.stringify({ ...newSave(), run })).run).toEqual(run);
    }
    expect(sources.slice(0, bank.length)).toEqual(firstDeck);
    for (let deck = 0; deck < 2; deck++) {
      expect(new Set(sources.slice(deck * bank.length, (deck + 1) * bank.length)).size).toBe(bank.length);
      expect(sources[(deck + 1) * bank.length]).not.toBe(sources[(deck + 1) * bank.length - 1]);
    }
    expect(run.puzzleOrder).not.toEqual(firstDeck);
    expect(run.puzzleCursor).toBe(2); expect(run.sheet).toBe(completedSheets + 1); expect(run.stats.sheets).toBe(completedSheets);
    expect(run.spellLevel).toBe(completedSheets + 1);
  });
  it('migrates original six-board v1 runs without rerolling current boards, HP, rewards or random state', () => {
    let save = fixture(91);
    for (let stage = 0; stage < 2; stage++) {
      save.run!.enemyHp = 1; save = dispatch(save, play(save.run!));
      save = dispatch(save, { type: 'reward', relic: save.run!.rewards.find(id => id !== 'glass')!, revision: save.run!.revision });
    }
    const legacy = structuredClone(save) as any, original = structuredClone(save.run!);
    legacy.run.maxHp = 32; legacy.run.hp = 24; legacy.run.enemyHp = 340; legacy.run.mana = 5; legacy.run.turn = 7;
    legacy.run.afterglow = true;
    legacy.run.puzzleOrder = legacy.run.puzzleOrder.filter((source: number) => source < 30).slice(0, 6);
    for (const key of ['spellLevel', 'sheet', 'encounterSheet', 'puzzleCursor']) delete legacy.run[key];
    delete legacy.run.stats.sheets;
    const restored = parseSave(JSON.stringify(legacy));
    expect(restored.run).toMatchObject({ spellLevel: 3, sheet: 3, encounterSheet: 1, puzzleCursor: 2, maxHp: 32, hp: 24, enemyHp: 340, mana: 5, turn: 7, afterglow: true, randomState: original.randomState, revision: original.revision });
    expect(restored.run!.cells).toEqual(original.cells); expect(restored.run!.solution).toEqual(original.solution);
    expect(restored.run!.puzzleOrder.slice(0, 6)).toEqual(legacy.run.puzzleOrder);
    expect(new Set(restored.run!.puzzleOrder).size).toBe(bank.length); expect(restored.run!.stats.sheets).toBe(0);
    expect(parseSave(JSON.stringify(legacy))).toEqual(restored); expect(parseSave(JSON.stringify(restored))).toEqual(restored);
    expect(dispatch(parseSave(JSON.stringify(restored)), play(restored.run!))).toEqual(dispatch(restored, play(restored.run!)));
    const invalid = structuredClone(restored); invalid.run!.puzzleCursor = bank.length;
    expect(() => parseSave(JSON.stringify(invalid))).toThrow('成長');
    invalid.run!.puzzleCursor = 2; invalid.run!.puzzleOrder[bank.length - 1] = invalid.run!.puzzleOrder[0];
    expect(() => parseSave(JSON.stringify(invalid))).toThrow('問題');
  });
  it('offers every relic from the start while keeping cumulative character unlocks', () => {
    const allRelics = RELICS.map(relic => relic.id);
    expect(fixture(13, 'fuse', 0).run!.pool).toEqual(allRelics);
    expect(() => startRun(newSave(), 'scribe', 2)).toThrow();
    const save = fixture(13, 'fuse', 2); save.run!.enemyHp = 1;
    expect(save.run!.pool).toEqual(allRelics);
    expect(() => startRun(save, 'scribe', 2)).toThrow();
    const next = dispatch(save, play(save.run!));
    expect(next.meta.clears).toBe(3); expect(next.run!.pool).toEqual(allRelics);
    expect(startRun(next, 'scribe', 2).run!.pool).toEqual(allRelics);
    expect(() => startRun(next, 'lumen', 2)).toThrow();
    const beforeLumen = newSave(); beforeLumen.meta.clears = 11;
    expect(() => startRun(beforeLumen, 'lumen', 2)).toThrow();
    expect(fixture(1, 'lumen', 12).run!.pool).toEqual(allRelics);
  });
  it('preserves three distinct unowned relics and affinity in versionless reward rolls', () => {
    for (const c of CHARACTERS) {
      for (let seed = 0; seed < 10; seed++) {
        const save = fixture(seed, c.id); save.run!.enemyHp = 1; delete save.run!.relicBalanceVersion;
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
  const endlessResults: { seed: number; phase: Run['phase']; kills: number; moves: number; sheets: number; level: number; hp: number; maxHp: number; bestChain: number; finalAttack: number; shield: number; encounters: EncounterSample[] }[] = [];
  // Long-run survival is measured by scripts/endgame-stability-balance.mjs.
  // A regression test must not require an endless game to force a defeat.
  it.each([1, 2, 3, 4, 5, 6])('continues beyond six encounters with valid committed saves (seed %i)', seed => {
      let save = fixture(seed, 'fuse', 0);
      const encounters: EncounterSample[] = [];
      const visited = [save.run!.puzzleOrder[save.run!.puzzleCursor]];
      while ((save.run!.phase === 'battle' || save.run!.phase === 'reward') && save.run!.stats.kills < 30) {
        const run = save.run!;
        expect(run.stats.moves).toBeLessThan(2000); // Test budget only; there is no runtime encounter cap.
        save = dispatch(save, run.phase === 'reward' ? informedReward(run) : informedAction(run));
        recordEncounter(encounters, run, save.run!);
        if (save.run!.sheet !== run.sheet) {
          const source = save.run!.puzzleOrder[save.run!.puzzleCursor];
          // One upper-Wick cast can cross the deck boundary and end beyond cursor zero.
          if (run.puzzleCursor + save.run!.sheet - run.sheet >= run.puzzleOrder.length) {
            expect(save.run!.puzzleOrder[0]).not.toBe(run.puzzleOrder.at(-1)); visited.length = 0;
          }
          expect(visited).not.toContain(source); visited.push(source);
        }
        expect(parseSave(JSON.stringify(save))).toEqual(save);
      }
      const run = save.run!;
      expect(run.stats.kills).toBeGreaterThan(6);
      expect(run.stats.bestChain).toBeGreaterThanOrEqual(20);
      if (run.phase === 'lost') expect(run.lastReport!.received).toBeGreaterThanOrEqual(run.lastReport!.hpBefore);
      else { expect(run.phase).toBe('reward'); expect(run.stats.kills).toBe(30); }
      expect(save.meta.bestKills).toBe(run.stats.kills); expect(save.meta.wins).toBe(0);
      expect(save.meta.bestScore).toBe(run.phase === 'lost' ? run.score : 0);
      endlessResults.push({ seed, phase: run.phase, kills: run.stats.kills, moves: run.stats.moves, sheets: run.sheet, level: run.spellLevel, hp: run.hp, maxHp: run.maxHp, bestChain: run.stats.bestChain, finalAttack: run.lastReport!.incoming, shield: run.lastReport!.shield, encounters });
    mkdirSync('.runtime', { recursive: true });
    writeFileSync('.runtime/balance-sample.json', JSON.stringify({ method: 'Bounded 30-win regression with ward/recovery priority; surviving runs are stage-censored, not defeats or a human playtest', runs: endlessResults.length, results: endlessResults }, null, 2));
  }, 180000);
  it('lets every character reach long chains without prime charms within a bounded campaign', () => {
    const results: { character: CharacterId; seed: number; phase: Run['phase']; kills: number; moves: number; sheets: number; level: number; hp: number; maxHp: number; bestChain: number; encounters: EncounterSample[] }[] = [];
    for (const character of CHARACTERS) {
      for (let seed = 21; seed <= 24; seed++) {
        let save = fixture(seed, character.id, 12);
        save.run!.pool = save.run!.pool.filter(id => !primeIds.includes(id));
        const encounters: EncounterSample[] = [];
        while ((save.run!.phase === 'battle' || save.run!.phase === 'reward') && save.run!.stats.kills < 30) {
          const run = save.run!;
          expect(run.stats.moves).toBeLessThan(2000);
          save = dispatch(save, run.phase === 'reward' ? informedReward(run) : informedAction(run));
          recordEncounter(encounters, run, save.run!);
        }
        const run = save.run!;
        expect(run.stats.sheets).toBeGreaterThan(0); expect(run.spellLevel).toBeGreaterThan(6);
        // This simulation excludes primes deliberately; loading restores the
        // public pool while preserving its completed combat and inventory.
        const expandedPool = [...run.pool, ...RELICS.map(relic => relic.id).filter(id => !run.pool.includes(id))];
        expect(parseSave(JSON.stringify(save))).toEqual({ ...save, run: { ...run, pool: expandedPool } });
        expect(run.stats.kills).toBeGreaterThan(6);
        expect(run.stats.bestChain).toBeGreaterThanOrEqual(20);
        if (run.phase === 'lost') expect(run.lastReport!.received).toBeGreaterThanOrEqual(run.lastReport!.hpBefore);
        else { expect(run.phase).toBe('reward'); expect(run.stats.kills).toBe(30); }
        results.push({ character: character.id, seed, phase: run.phase, kills: run.stats.kills, moves: run.stats.moves, sheets: run.sheet, level: run.spellLevel, hp: run.hp, maxHp: run.maxHp, bestChain: run.stats.bestChain, encounters });
      }
    }
    mkdirSync('.runtime', { recursive: true });
    writeFileSync('.runtime/character-balance-sample.json', JSON.stringify({ method: 'Bounded 30-win regression, all prime charms excluded; surviving runs are stage-censored, not defeats or a human playtest', runs: results.length, results }, null, 2));
  }, 180000);
});
