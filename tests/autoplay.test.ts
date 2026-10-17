import { describe, expect, it, vi } from 'vitest';
import { selectAutoplayOrigin } from '../src/game/autoplay';
import { legalOrigins, longestOrigins, newSave, previewAction, resolveAction, startRun } from '../src/game/engine';
import { Random } from '../src/game/sudoku';
import type { Phase, Run } from '../src/game/types';

function fixture(): Run {
  return startRun(newSave(), 'fuse', 71).run!;
}

function boardWith(blanks: number[]): Run {
  const run = fixture();
  run.solution = Array.from({ length: 81 }, (_, cell) => {
    const row = Math.floor(cell / 9), col = cell % 9;
    return (row * 3 + Math.floor(row / 3) + col) % 9 + 1;
  });
  run.cells = run.solution.map((value, cell) => blanks.includes(cell) ? 0 : value);
  run.givens = run.cells.map(Boolean); run.marks.fill(null); run.enemyHp = 1_000_000_000;
  return run;
}

describe('autoplay origin selection', () => {
  it('prioritizes the longest chain even when a shorter cast deals more damage', () => {
    const run = boardWith([0, 1, 40]);
    run.inventory = ['lens']; run.relicLevels = { lens: 10 }; run.tier.lens = 3; run.marks[40] = 'weak';
    const longer = previewAction(run, 0), shorter = previewAction(run, 40);
    expect(longer.path).toHaveLength(2); expect(shorter.path).toHaveLength(1);
    expect(shorter.guaranteedDamage).toBeGreaterThan(longer.guaranteedDamage!);
    const result = selectAutoplayOrigin(run)!;
    expect([0, 1]).toContain(result.cell); expect(result.preview.path).toHaveLength(2);
  });

  it('selects the greatest guaranteed damage among equally long chains', () => {
    const run = boardWith([0, 40]); run.marks[40] = 'weak';
    const result = selectAutoplayOrigin(run)!;
    expect(previewAction(run, 0).path).toHaveLength(result.preview.path.length);
    expect(result.cell).toBe(40);
    expect(result.preview.guaranteedDamage).toBeGreaterThan(previewAction(run, 0).guaranteedDamage!);
  });

  it('breaks exact ties by row and then column', () => {
    const run = boardWith([8, 9, 40]);
    expect(new Set(legalOrigins(run).map(cell => previewAction(run, cell).guaranteedDamage)).size).toBe(1);
    expect(selectAutoplayOrigin(run)!.cell).toBe(8);
    const sameRow = boardWith([0, 1]);
    expect(previewAction(sameRow, 0).guaranteedDamage).toBe(previewAction(sameRow, 1).guaranteedDamage);
    expect(selectAutoplayOrigin(sameRow)!.cell).toBe(0);
  });

  it('ignores a larger possible trinity proc in favor of guaranteed damage', () => {
    const run = boardWith([0, 40]);
    const swap = (value: number) => value === 1 ? 3 : value === 3 ? 1 : value;
    run.solution = run.solution.map(swap); run.cells = run.cells.map(value => value ? swap(value) : 0);
    run.inventory = ['trinity']; run.marks[40] = 'weak';
    const lucky = previewAction(run, 0), certain = previewAction(run, 40);
    expect(lucky.forecast!.damageMax).toBeGreaterThan(certain.guaranteedDamage!);
    expect(lucky.guaranteedDamage).toBeLessThan(certain.guaranteedDamage!);
    expect(selectAutoplayOrigin(run)!.cell).toBe(40);
  });

  it('does not activate skills or spend reconnect items even when both extend the chain', () => {
    const run = boardWith([0, 40]);
    run.spellLevel = 200; run.rescueItems = 1; run.rescueMilestones = 1;
    run.mana = 8; run.freeSkillTokens = 1; run.skillLevels!.bridge = 10; run.equippedSkills = ['bridge'];
    expect(previewAction(run, 0, false, undefined, true).path).toHaveLength(2);
    expect(previewAction(run, 0, true, 'bridge').path).toHaveLength(2);
    const result = selectAutoplayOrigin(run)!;
    expect(result.preview.path).toHaveLength(1);
    expect(result.preview).toMatchObject({ skill: false, rescueRequested: false, rescueItemsBefore: 1, rescueItemsAfter: 1 });
    expect(result.preview.path.some(event => event.rescue || event.bridge)).toBe(false);
    expect(result.preview.skillId).toBeUndefined();
  });

  it('uses the complete carried-sheet chain without changing the source board or random stream', () => {
    const run = fixture(), root = run.givens.findIndex(given => !given);
    run.cells = [...run.solution]; run.cells[root] = 0;
    run.inventory = ['wick']; run.tier.wick = 2; run.spellLevel = 8; run.enemyHp = 1_000_000_000;
    const before = structuredClone(run), result = selectAutoplayOrigin(run)!;
    expect(result.cell).toBe(root); expect(result.preview.segments!.length).toBeGreaterThan(1);
    expect(result.preview.path.some(event => event.sheetStart)).toBe(true);
    expect(result.preview.path.length).toBe(longestOrigins(run).length);
    expect(run).toEqual(before);
    const committed = resolveAction(run, { type: 'play', cell: result.cell, skill: false, useRescue: false, revision: run.revision });
    expect(committed.lastReport!.path).toEqual(result.preview.path);
  });

  it('does not roll effects, mutate resources, or change its choice with the proc seed', () => {
    const run = boardWith([0, 40]); run.inventory = ['trinity', 'quint', 'sept']; run.marks[40] = 'weak';
    const before = structuredClone(run), random = vi.spyOn(Random.prototype, 'next');
    try {
      expect(selectAutoplayOrigin(run)!.cell).toBe(40);
      expect(selectAutoplayOrigin(run)!.cell).toBe(40);
      expect(random).not.toHaveBeenCalled(); expect(run).toEqual(before);
      for (const seed of [1, 10, 100, 1000]) expect(selectAutoplayOrigin({ ...run, seed })!.cell).toBe(40);
    } finally { random.mockRestore(); }
  });

  it('compares the shared damage preview after enemy armor is applied', () => {
    const run = fixture(); run.stage = 6;
    const candidates = longestOrigins(run).cells.map(cell => ({ cell, preview: previewAction(run, cell) }));
    expect(candidates.some(candidate => candidate.preview.armorPrevented! > 0)).toBe(true);
    const expected = candidates.sort((a, b) => b.preview.damage - a.preview.damage || a.cell - b.cell)[0];
    expect(selectAutoplayOrigin(run)).toEqual(expected);
  });

  it.each<Phase>(['reward', 'won', 'lost'])('returns no choice during %s', phase => {
    const run = boardWith([0]); run.phase = phase;
    expect(selectAutoplayOrigin(run)).toBeNull();
  });

  it('returns no choice when there are no legal ordinary origins', () => {
    const run = boardWith([0]); run.cells.fill(0); run.givens.fill(false); run.mana = 8;
    expect(legalOrigins(run, true)).toHaveLength(81);
    expect(selectAutoplayOrigin(run)).toBeNull();
    expect(selectAutoplayOrigin(boardWith([]))).toBeNull();
  });
});
