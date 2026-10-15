import { describe, expect, it } from 'vitest';
import bank from '../src/game/puzzles.json';
import { dispatch, newSave, previewAction, startRun } from '../src/game/engine';
import { parseSave } from '../src/game/storage';
import { Random } from '../src/game/sudoku';

function oldDeck(cursor = 0) {
  const save = startRun(newSave(), 'fuse', 351);
  save.run!.puzzleOrder = new Random(351).shuffle(Array.from({ length: 30 }, (_, index) => index));
  save.run!.puzzleCursor = cursor;
  save.run!.sheet = cursor + 1;
  return save;
}

describe('30-to-100 source bank migration', () => {
  it.each([0, 14, 29])('appends only the new sources and preserves the current state at old cursor %s', cursor => {
    const legacy = oldDeck(cursor), before = structuredClone(legacy);
    const loaded = parseSave(JSON.stringify(legacy)), order = loaded.run!.puzzleOrder;
    expect(order).toHaveLength(100);
    expect(order.slice(0, 30)).toEqual(before.run!.puzzleOrder);
    expect([...order.slice(30)].sort((a, b) => a - b)).toEqual(Array.from({ length: 70 }, (_, index) => index + 30));
    expect(new Set(order).size).toBe(bank.length);
    expect({ ...loaded.run, puzzleOrder: before.run!.puzzleOrder }).toEqual(before.run);
    expect(loaded.history).toEqual(before.history);
    expect(parseSave(JSON.stringify(legacy))).toEqual(loaded);
    expect(parseSave(JSON.stringify(loaded))).toEqual(loaded);
  });

  it('continues from the final old source into an appended source with identical preview and replay', () => {
    const legacy = oldDeck(29), run = legacy.run!;
    const cell = run.cells.findIndex(value => !value);
    run.cells = [...run.solution]; run.cells[cell] = 0;
    const loaded = parseSave(JSON.stringify(legacy)), before = structuredClone(loaded);
    const report = previewAction(loaded.run!, cell);
    const action = { type: 'play' as const, cell, skill: false, revision: run.revision };
    const next = dispatch(loaded, action);
    expect(next.run!.lastReport).toEqual(report);
    expect(loaded).toEqual(before);
    expect(next.run!.puzzleCursor).toBe(30);
    expect(next.run!.puzzleOrder[30]).toBeGreaterThanOrEqual(30);
    expect(dispatch(parseSave(JSON.stringify(before)), action)).toEqual(next);
    expect(parseSave(JSON.stringify(next))).toEqual(next);
  });

  it('rejects truncated or corrupt orders instead of treating them as an old complete deck', () => {
    const changes = [
      (save: ReturnType<typeof oldDeck>) => { save.run!.puzzleOrder[29] = save.run!.puzzleOrder[0]; },
      (save: ReturnType<typeof oldDeck>) => { save.run!.puzzleOrder[29] = 30; },
      (save: ReturnType<typeof oldDeck>) => { save.run!.puzzleCursor = 30; },
      (save: ReturnType<typeof oldDeck>) => { save.run!.puzzleOrder.pop(); },
    ];
    for (const change of changes) {
      const invalid = oldDeck(); change(invalid);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow('問題');
    }
  });
});
