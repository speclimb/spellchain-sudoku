import { describe, expect, it } from 'vitest';
import { dispatch, newSave, previewAction, resolveAction, startRun } from '../src/game/engine';
import { parseSave } from '../src/game/storage';
import { candidates, col, near, PEERS, row, singles, UNITS } from '../src/game/sudoku';
import type { ChainTrace, Run } from '../src/game/types';

function fixture(seed = 17): Run {
  const save = newSave(); save.meta.clears = 12;
  return startRun(save, 'fuse', seed).run!;
}
function boardWith(blanks: number[]): Run {
  const run = fixture();
  run.solution = Array.from({ length: 81 }, (_, cell) => (row(cell) * 3 + Math.floor(row(cell) / 3) + col(cell)) % 9 + 1);
  run.cells = run.solution.map((value, cell) => blanks.includes(cell) ? 0 : value);
  run.marks.fill(null); run.enemyHp = 800;
  return run;
}
const trace = (run: Run, cell: number, skill = false): ChainTrace => previewAction(run, cell, skill).chain!;

describe('explanatory chain trace', () => {
  it('accounts for the fuse normal five-cell chain and skill nine-cell chain without charging the root', () => {
    const run = boardWith([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const normal = trace(run, 0);
    expect(normal.initialAuto).toBe(4);
    expect(normal.bonuses).toEqual([{ label: '基本', amount: 3 }, { label: '導火術師', amount: 1 }]);
    expect(normal.steps.map(s => s.cell)).toEqual([0, 1, 2, 3, 4]);
    expect(normal.steps.map(s => [s.remainingBefore, s.remainingAfter])).toEqual([[4, 4], [4, 3], [3, 2], [2, 1], [1, 0]]);
    expect(normal.stopReason).toBe('limit'); expect(normal.remainingAuto).toBe(0);
    run.mana = 8;
    const skill = trace(run, 0, true);
    expect(skill.initialAuto).toBe(8); expect(skill.steps).toHaveLength(9);
    expect(skill.bonuses.at(-1)).toEqual({ label: '導火術師スキル', amount: 4 });
    expect(skill.remainingAuto).toBe(0); expect(skill.stopReason).toBe('board-complete');
  });

  it('lists every active automatic allowance and ignores afterglow on a skill', () => {
    const run = boardWith([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    run.inventory = ['wick', 'afterglow']; run.afterglow = true; run.mana = 8;
    const normal = trace(run, 0);
    expect(normal.initialAuto).toBe(8);
    expect(normal.bonuses).toEqual([
      { label: '基本', amount: 3 }, { label: '導火術師', amount: 1 },
      { label: '長い導火線', amount: 2 }, { label: '残光の灯', amount: 2 },
    ]);
    const skill = trace(run, 0, true);
    expect(skill.initialAuto).toBe(10);
    expect(skill.bonuses.some(b => b.label === '残光の灯')).toBe(false);
  });

  it('shows shared row, column and box units plus all minimum-distance tie choices', () => {
    const run = boardWith([30, 39, 40, 41, 50]);
    const t = trace(run, 40);
    expect(t.steps[0].from).toBeNull(); expect(t.steps[0].sharedUnits).toEqual([]);
    expect(t.steps[0].eligibleCells).toEqual(singles(run.cells));
    expect(t.steps[1]).toMatchObject({ from: 40, cell: 39, source: 'chain', sharedUnits: [4, 22], eligibleCells: [39, 41, 30, 50], tiedCells: [39, 41] });
    expect(t.steps[2]).toMatchObject({ from: 39, cell: 30, sharedUnits: [12, 22] });
    for (const step of t.steps) {
      if (step.from !== null) expect(step.sharedUnits).toEqual(UNITS.flatMap((u, id) => u.includes(step.from!) && u.includes(step.cell) ? [id] : []));
    }
  });

  it('distinguishes already single cells from cells made single during this spell', () => {
    let existing = false, newlySingle = false;
    for (let seed = 0; seed < 10 && !(existing && newlySingle); seed++) {
      const run = fixture(seed);
      for (const root of singles(run.cells)) {
        const t = trace(run, root), board = [...run.cells];
        for (const step of t.steps) {
          expect(step.candidateValues).toEqual(candidates(board, step.cell));
          expect(step.initiallySingle).toBe(candidates(run.cells, step.cell).length === 1);
          if (step.source === 'chain') {
            expect(step.candidateValues).toEqual([run.solution[step.cell]]);
            if (step.initiallySingle) existing = true;
            else newlySingle = true;
            expect(step.eligibleCells).toEqual(PEERS[step.from!].filter(i => !board[i] && candidates(board, i).length === 1).sort((a, b) => near(step.from!, a, b)));
          }
          board[step.cell] = run.solution[step.cell];
        }
      }
    }
    expect(existing).toBe(true); expect(newlySingle).toBe(true);
  });

  it('records echo candidates by matching digit, charges no allowance and continues at the echo destination', () => {
    const run = fixture(17); run.inventory = ['echo'];
    const root = singles(run.cells).find(i => run.cells.some((v, j) => !v && j !== i && run.solution[j] === run.solution[i]))!;
    const t = trace(run, root), echo = t.steps[1];
    const options = run.cells.flatMap((v, i) => !v && i !== root && run.solution[i] === run.solution[root] ? [i] : []).sort((a, b) => near(root, a, b));
    expect(echo).toMatchObject({ source: 'echo', from: root, cell: options[0], sharedUnits: [], eligibleCells: options, remainingBefore: 4, remainingAfter: 4 });
    expect(t.steps[2].from).toBe(echo.cell); expect(t.steps[2].source).toBe('chain');
  });

  it('attributes rekindle exactly once even on multi-unit completion, including root and echo fills', () => {
    const rootRun = boardWith([0]); rootRun.inventory = ['rekindle'];
    const root = trace(rootRun, 0);
    expect(root.steps[0]).toMatchObject({ remainingBefore: 4, remainingAfter: 7, addedAuto: 3 });
    expect(root.stopReason).toBe('board-complete');
    // Same-value cells cannot share a unit. Keep a peer of the root blank so
    // only the echo completes units, then check that its free step can refuel.
    const echoRun = boardWith([0, 1, 9, 15]); echoRun.inventory = ['echo', 'rekindle'];
    const echoTrace = trace(echoRun, 0);
    expect(echoTrace.steps[0].addedAuto).toBe(0);
    expect(echoTrace.steps[1]).toMatchObject({ source: 'echo', cell: 15, remainingBefore: 4, remainingAfter: 7, addedAuto: 3 });
    expect(echoTrace.steps.reduce((sum, s) => sum + s.addedAuto, 0)).toBe(3);
    for (const s of echoTrace.steps) expect(s.remainingAfter).toBe(s.remainingBefore - (s.source === 'chain' ? 1 : 0) + s.addedAuto);
  });

  it('distinguishes a missing next target from an exhausted allowance and excludes victory sweep cells', () => {
    const run = boardWith([0, 40]);
    const t = trace(run, 0);
    expect(t.stopReason).toBe('no-target'); expect(t.remainingAuto).toBe(4); expect(t.steps).toHaveLength(1);
    run.enemyHp = 1;
    const report = previewAction(run, 0);
    expect(report.sweep).toEqual([40]); expect(report.chain).toEqual(t);
    expect(report.chain!.stopReason).not.toBe('board-complete');
  });

  it('keeps repeated previews and execution identical without changing source or the random stream', () => {
    const run = fixture(); run.inventory = ['echo', 'rekindle'];
    const before = structuredClone(run), root = singles(run.cells)[0];
    const forecast = previewAction(run, root);
    expect(previewAction(run, root)).toEqual(forecast);
    const played = resolveAction(run, { type: 'play', cell: root, skill: false, revision: run.revision });
    expect(played.lastReport).toEqual(forecast); expect(run).toEqual(before);
    if (!forecast.defeated) expect(played.randomState).toBe(run.randomState);
  });

  it('restores old version-1 reports without trace and round trips new reports', () => {
    const save = startRun(newSave(), 'fuse', 42);
    const played = dispatch(save, { type: 'play', cell: singles(save.run!.cells)[0], skill: false, revision: 0 });
    expect(parseSave(JSON.stringify(played))).toEqual(played);
    const legacy = structuredClone(played); delete legacy.run!.lastReport!.chain;
    expect(parseSave(JSON.stringify(legacy))).toEqual(legacy);
    const broken = structuredClone(played); broken.run!.lastReport!.chain!.steps[0].remainingAfter++;
    expect(() => parseSave(JSON.stringify(broken))).toThrow('連鎖の説明が不正です。');
  });
});
