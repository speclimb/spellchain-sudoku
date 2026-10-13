import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import bank from '../src/game/puzzles.json';
import { CHARACTERS, RELICS, characterOf } from '../src/game/content';
import { dispatch, incomingAttack, newSave, previewAction, resolveAction, startRun } from '../src/game/engine';
import { parseSave } from '../src/game/storage';
import { candidates, countSolutions, singles, solveSingles } from '../src/game/sudoku';
import type { CharacterId, Run, Save } from '../src/game/types';

function fixture(seed = 20261013, character: CharacterId = 'fuse', clears = 12): Save {
  const save = newSave(); save.meta.clears = clears;
  return startRun(save, character, seed);
}
const play = (run: Run, cell = singles(run.cells)[0], skill = false) => ({ type: 'play' as const, cell, skill, revision: run.revision });

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
      expect(new Set(run.puzzleOrder).size).toBe(6);
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
    run.inventory = ['pen', 'ward', 'glass', 'amplifier'];
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
    expect(win.run!.phase).toBe('won'); expect(win.run!.hp).toBe(1); expect(win.meta.wins).toBe(1);
    expect(win.meta.bestScore).toBe(win.run!.score);
    expect(win.run!.score).toBe(win.run!.lastReport!.attackScore + 500 + 1000 + 10);
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
        expect(run.rewards.some(id => characterOf(c.id).affinity.includes(id))).toBe(true);
        expect(run.rewards.every(id => !run.inventory.includes(id))).toBe(true);
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
  it('finishes whole six-stage runs through public actions, never stalls or repeats source boards', () => {
    let wins = 0;
    const lengths: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      let save = fixture(seed, 'fuse', 0);
      while (save.run!.phase === 'battle' || save.run!.phase === 'reward') {
        const run = save.run!;
        expect(run.stats.moves).toBeLessThan(150);
        if (run.phase === 'reward') {
          const preference = ['wick', 'pen', 'lens', 'glass', 'ward', 'battery', 'afterglow', 'stroke', 'gold'];
          const relic = [...run.rewards].sort((a, b) => preference.indexOf(a) - preference.indexOf(b))[0];
          save = dispatch(save, { type: 'reward', relic, revision: run.revision });
        } else {
          const choices = singles(run.cells).map(cell => ({ cell, skill: false, report: previewAction(run, cell) }));
          if (run.mana === 8) run.cells.forEach((value, cell) => { if (!value) choices.push({ cell, skill: true, report: previewAction(run, cell, true) }); });
          expect(choices.length).toBeGreaterThan(0);
          choices.sort((a, b) => (b.report.defeated ? 10000 : 0) + Math.min(run.enemyHp, b.report.damage) - b.report.received * 15 - ((a.report.defeated ? 10000 : 0) + Math.min(run.enemyHp, a.report.damage) - a.report.received * 15));
          const choice = choices[0];
          save = dispatch(save, play(run, choice.cell, choice.skill));
        }
        expect(parseSave(JSON.stringify(save))).toEqual(save);
      }
      if (save.run!.phase === 'won') wins++;
      lengths.push(save.run!.stats.moves);
    }
    mkdirSync('.runtime', { recursive: true });
    writeFileSync('.runtime/balance-sample.json', JSON.stringify({ method: 'Deterministic informed play, not a human playtest', runs: 12, wins, moves: lengths, averageMoves: lengths.reduce((a, b) => a + b, 0) / lengths.length }, null, 2));
    expect(wins).toBeGreaterThanOrEqual(9);
  }, 30000);
});
