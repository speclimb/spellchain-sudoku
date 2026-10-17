import { describe, expect, it } from 'vitest';
import bank from '../src/game/puzzles.json';
import { createBoardLayout, isChainFriendly, longestNaturalChain, MIN_BOARD_CHAIN, transformPuzzle } from '../src/game/board-generation';
import type { PuzzleSource } from '../src/game/board-generation';
import { dispatch, longestOrigins, newSave, previewAction, startRun } from '../src/game/engine';
import { enemyForRun } from '../src/game/enemies';
import { parseSave } from '../src/game/storage';
import { Random, solveSingles } from '../src/game/sudoku';
import type { Mark } from '../src/game/types';

// An old source whose ordinary route can be shortened by a legal permutation.
// Keep this independent of the regenerated bank so the rejection stays exercised.
const rejectionSource: PuzzleSource = {
  id: 'layout-rejection-regression',
  puzzle: '821000030754069800063008040082570409075600320096003057540006000638702094010045680',
  solution: '821457936754369812963128745382571469175694328496283157549836271638712594217945683',
};
const rawLayout = (source: PuzzleSource) => ({ cells: [...source.puzzle].map(Number), solution: [...source.solution].map(Number) });

function firstSourceSeeds(): Map<number, number> {
  const seeds = new Map<number, number>();
  for (let seed = 1; seed <= bank.length * 100 && seeds.size < bank.length; seed++) {
    const first = new Random(seed).shuffle(bank.map((_, index) => index))[0];
    if (!seeds.has(first)) seeds.set(first, seed);
  }
  expect(seeds.size).toBe(bank.length);
  return seeds;
}

describe('chain-friendly fresh board generation', () => {
  it('replaces a rejected geometry and preserves the authoritative random stream, including forced fallback', () => {
    expect(isChainFriendly(rawLayout(rejectionSource))).toBe(true);
    const legacyRandom = new Random(5), rejected = transformPuzzle(rejectionSource, legacyRandom);
    expect(longestNaturalChain(rejected)).toBe(21);
    expect(isChainFriendly(rejected)).toBe(false);

    for (const retries of [0, 15]) {
      const random = new Random(5), layout = createBoardLayout(rejectionSource, random, retries);
      expect(layout).not.toEqual(rejected);
      expect(isChainFriendly(layout)).toBe(true);
      expect(solveSingles(layout.cells)).toEqual(layout.solution);
      expect(random.state).toBe(legacyRandom.state);
      const replayRandom = new Random(5);
      expect(createBoardLayout(rejectionSource, replayRandom, retries)).toEqual(layout);
      expect(replayRandom.state).toBe(legacyRandom.state);
    }
  });

  it('returns independent arrays when a generated layout is reused from the cache', () => {
    const original = createBoardLayout(rejectionSource, new Random(5));
    const expected = structuredClone(original);
    original.cells.fill(0); original.solution.fill(9);
    const next = createBoardLayout(rejectionSource, new Random(5));
    expect(next).toEqual(expected);
    next.cells[0] = 0; next.solution[0] = 0;
    expect(createBoardLayout(rejectionSource, new Random(5))).toEqual(expected);
  });

  it('certifies each shipped source as a fallback and matches the real cast engine for every source and Echo level', () => {
    const sourceSeeds = firstSourceSeeds();
    for (const [sourceIndex, seed] of sourceSeeds) {
      const source = bank[sourceIndex];
      expect(isChainFriendly(rawLayout(source)), source.id).toBe(true);
      const run = startRun(newSave(), 'fuse', seed).run!;
      // This oracle certifies the natural route, without the optional Lv.100 rescue.
      delete run.endgameBalanceVersion;
      expect(run.puzzleOrder[run.puzzleCursor]).toBe(sourceIndex);
      expect(run.cells.filter(value => !value)).toHaveLength(36);
      run.spellLevel = 100;
      for (const echoes of [0, 1, 2, 3]) {
        run.inventory = echoes ? ['echo'] : [];
        run.relicLevels = echoes ? { echo: echoes === 1 ? 1 : echoes === 2 ? 5 : 10 } : {};
        const before = structuredClone(run);
        const actual = longestOrigins(run).length;
        expect(actual, `${source.id}, Echo ${echoes}`).toBeGreaterThanOrEqual(MIN_BOARD_CHAIN);
        expect(longestNaturalChain({ cells: run.cells, solution: run.solution }, echoes)).toBe(actual);
        expect(run).toEqual(before);
      }
    }
  });

  it('preserves the source deck and legacy random draws for fresh marks', () => {
    for (const seed of [1, 5, 17, 71, 0xffffffff]) {
      const random = new Random(seed), order = random.shuffle(bank.map((_, index) => index));
      transformPuzzle(bank[order[0]], random);
      const run = startRun(newSave(), 'fuse', seed).run!;
      const marked = random.shuffle(run.cells.flatMap((value, cell) => value ? [] : [cell])).slice(0, 6);
      const marks = Array<Mark>(81).fill(null);
      marked.forEach((cell, index) => { marks[cell] = index < 3 ? 'weak' : 'shield'; });
      expect(run.puzzleOrder).toEqual(order);
      expect(run.puzzleCursor).toBe(0);
      expect(run.marks).toEqual(marks);
      expect(run.randomState).toBe(random.state);
    }
  });

  it('keeps an already saved short board intact when loading', () => {
    const save = startRun(newSave(), 'fuse', 17), run = save.run!;
    const oldLayout = transformPuzzle(rejectionSource, new Random(5));
    run.cells = oldLayout.cells; run.solution = oldLayout.solution; run.givens = run.cells.map(Boolean);
    run.marks.fill(null);
    run.cells.flatMap((value, cell) => value ? [] : [cell]).slice(0, 6).forEach((cell, index) => { run.marks[cell] = index < 3 ? 'weak' : 'shield'; });
    expect(longestNaturalChain(oldLayout)).toBeLessThan(MIN_BOARD_CHAIN);
    const before = structuredClone(save), loaded = parseSave(JSON.stringify(save));
    expect(loaded).toEqual(before);
    expect(loaded.run!.cells).toEqual(oldLayout.cells);
    expect(loaded.run!.randomState).toBe(run.randomState);
  });

  it('replays filtered future sheets identically in preview, execution, and saved results', () => {
    const save = startRun(newSave(), 'fuse', 71), run = save.run!;
    run.stage = 40; run.stats.kills = 40; run.enemyHp = enemyForRun(run).hp;
    run.hp = run.maxHp = 10000; run.spellLevel = 90;
    run.inventory = ['wick']; run.tier.wick = 2;
    const cell = run.cells.findIndex(value => !value);
    run.cells = run.cells.map((value, index) => index === cell ? 0 : value || run.solution[index]);
    const before = structuredClone(save), report = previewAction(run, cell);
    expect(save).toEqual(before);
    expect(report.segments!.length).toBeGreaterThan(1);
    for (const segment of report.segments!.slice(1)) {
      expect(isChainFriendly(segment)).toBe(true);
      expect(segment.cells.filter(value => !value)).toHaveLength(36);
    }
    const action = { type: 'play' as const, cell, skill: false, revision: run.revision };
    const first = dispatch(save, action), replay = dispatch(structuredClone(before), action);
    expect(first.run!.lastReport).toEqual(report);
    expect(replay).toEqual(first);
    expect(parseSave(JSON.stringify(first))).toEqual(first);
  });
});
