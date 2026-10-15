import { describe, expect, it } from 'vitest';
import { dispatch, newSave, previewAction, sheetShield, spellMultiplier, startRun } from '../src/game/engine';
import { skillValues } from '../src/game/growth';
import { historyCounts } from '../src/game/history';
import { parseSave } from '../src/game/storage';
import { PEERS } from '../src/game/sudoku';
import type { RelicId, Run, Save, SkillId } from '../src/game/types';

type ExtraSkill = Extract<SkillId, 'bridge' | 'pierce' | 'bastion'>;
const damageRelics: RelicId[] = ['pen', 'lens', 'stroke', 'glass', 'amplifier'];

/** Use a real generated board, leaving a small deterministic end-of-sheet path. */
function fixture(id: ExtraSkill, level = 5): { save: Save; root: number } {
  const initial = newSave(); initial.meta.clears = 99;
  const save = startRun(initial, 'fuse', 71), run = save.run!;
  const blanks = run.givens.flatMap((given, cell) => given ? [] : [cell]);
  let path: number[] | undefined;
  for (let row = 0; row < 9 && !path; row++) {
    const sameRow = blanks.filter(cell => Math.floor(cell / 9) === row);
    if (sameRow.length < 3) continue;
    if (id === 'bridge') {
      const tail = sameRow.slice(0, 3);
      const root = blanks.find(cell => !tail.includes(cell) && tail.every(target => !PEERS[cell].includes(target)));
      if (root !== undefined) path = [root, ...tail];
    } else path = sameRow.slice(0, 3);
  }
  if (!path) throw new Error('A connected fixture path was not found.');
  run.cells = [...run.solution]; path.forEach(cell => { run.cells[cell] = 0; });
  run.marks.fill(null);
  const outside = blanks.filter(cell => !path.includes(cell));
  if (id === 'bastion') {
    [path[0], ...outside.slice(0, 2)].forEach(cell => { run.marks[cell] = 'shield'; });
    [path[1], path[2], outside[2]].forEach(cell => { run.marks[cell] = 'weak'; });
  } else {
    path.slice(0, 3).forEach(cell => { run.marks[cell] = 'weak'; });
    outside.slice(0, 3).forEach(cell => { run.marks[cell] = 'shield'; });
  }
  run.skillLevels = { fuse: 1, [id]: level }; run.equippedSkills = [id]; run.mana = 8;
  return { save, root: path[0] };
}
const action = (run: Run, root: number, id: ExtraSkill) => ({ type: 'play' as const, cell: root, skill: true, skillId: id, revision: run.revision });
function removeRelic(run: Run, id: RelicId): Run {
  const lower = structuredClone(run);
  lower.inventory = lower.inventory.filter(relic => relic !== id);
  delete lower.relicLevels?.[id]; delete lower.acquisitionRank[id]; delete lower.tier[id];
  return lower;
}

describe('focused skill contribution accounting', () => {
  it.each<ExtraSkill>(['bridge', 'pierce', 'bastion'])('attributes relic damage inside the %s follow-up on the same path', id => {
    const { save, root } = fixture(id), run = save.run!;
    run.inventory = [...damageRelics]; run.relicLevels = Object.fromEntries(damageRelics.map(relic => [relic, 3]));
    expect(parseSave(JSON.stringify(save))).toEqual(save);
    const report = previewAction(run, root, true, id);
    expect(report.extraDamage).toBeGreaterThan(report.baseDamage!);
    for (const relic of damageRelics) {
      const lower = previewAction(removeRelic(run, relic), root, true, id);
      expect(lower.path).toEqual(report.path);
      expect(report.baseDamage!).toBeGreaterThan(lower.baseDamage!);
      expect(report.extraDamage!).toBeGreaterThan(lower.extraDamage!);
      expect(report.ledger!.relics[relic]!.damage).toBe(report.damage - lower.damage);
    }
    const committed = dispatch(save, action(run, root, id));
    expect(committed.run!.lastReport!.ledger).toEqual(report.ledger);
    const cast = committed.history!.runs.at(-1)!.battles[0].casts[0];
    for (const relic of damageRelics) expect(cast.relics[relic]!.metric.damage).toBe(report.ledger!.relics[relic]!.damage);
    expect(parseSave(JSON.stringify(committed))).toEqual(committed);
  });

  it('attributes Ward opening-guard threshold crossing as well as its fixed cannon damage', () => {
    const { save, root } = fixture('bastion'), run = save.run!;
    // All three shield marks are still empty at the opening; only Ward provides guard.
    const empty = run.cells.flatMap((value, cell) => value ? [] : [cell]);
    run.marks.fill(null); empty.forEach(cell => { run.marks[cell] = 'shield'; });
    run.givens.flatMap((given, cell) => !given && !empty.includes(cell) ? [cell] : []).slice(0, 3)
      .forEach(cell => { run.marks[cell] = 'weak'; });
    run.inventory = ['ward']; run.relicLevels = { ward: 1 };
    const lowerRun = removeRelic(run, 'ward');
    expect(sheetShield(run)).toBeGreaterThanOrEqual(12); expect(sheetShield(lowerRun)).toBe(0);
    const report = previewAction(run, root, true, 'bastion'), lower = previewAction(lowerRun, root, true, 'bastion');
    expect(report.path).toEqual(lower.path); expect(report.baseDamage).toBe(lower.baseDamage);
    expect(lower.temporaryShield).toBe(6);
    expect(lower.extraDamage).toBe(Math.floor(lower.shield * 2.5));
    expect(report.extraDamage! - lower.extraDamage!).toBeGreaterThan(report.baseDamage! * 4);
    expect(report.ledger!.relics.ward!.damage).toBe(report.damage - lower.damage);
    expect(parseSave(JSON.stringify(dispatch(save, action(run, root, 'bastion')))).run!.lastReport).toEqual(expect.objectContaining({ extraDamage: report.extraDamage }));
  });

  it('keeps the focused follow-up outside Trinity in both possible outcomes', () => {
    // Find a real generated row whose three filled targets contain digit 3.
    const { save, root } = fixture('pierce'), run = save.run!;
    const path = previewAction(run, root, true, 'pierce').path;
    const originalThree = run.solution.indexOf(3), target = path[0].cell;
    if (!path.some(event => event.value === 3)) {
      const targetDigit = run.solution[target];
      run.solution = run.solution.map(value => value === targetDigit ? 3 : value === 3 ? targetDigit : value);
      run.cells = run.cells.map((value, cell) => value ? run.solution[cell] : 0);
      expect(run.solution[originalThree]).toBe(targetDigit);
    }
    run.inventory = ['trinity']; run.relicLevels = { trinity: 1 };
    const preview = previewAction(run, root, true, 'pierce');
    expect(preview.forecast?.procs?.some(proc => proc.id === 'trinity')).toBe(true);
    expect(preview.extraDamage!).toBeGreaterThan(preview.baseDamage!);
    expect(preview.damage).toBe(preview.baseDamage! + preview.clearBonus! + preview.extraDamage!);
    expect(preview.forecast!.damageMax).toBe(Math.floor(preview.baseDamage! * 1.5) + preview.clearBonus! + preview.extraDamage!);
    const committed = dispatch(save, action(run, root, 'pierce')), report = committed.run!.lastReport!;
    const triggered = report.procs!.find(proc => proc.id === 'trinity')!.triggered;
    expect(report.damage).toBe(triggered ? preview.forecast!.damageMax : preview.damage);
    expect(report.ledger!.relics.trinity!.damage).toBe(triggered ? report.damage - report.guaranteedDamage! : 0);
    expect(parseSave(JSON.stringify(committed))).toEqual(committed);
  });
});

describe('focused skill persistence', () => {
  it.each<ExtraSkill>(['bridge', 'pierce', 'bastion'])('loads %s decisions and records the committed cast exactly once', id => {
    const { save, root } = fixture(id), before = structuredClone(save), run = save.run!;
    const decision = action(run, root, id), preview = previewAction(run, root, true, id);
    previewAction(run, root, true, id); expect(save).toEqual(before);
    const committed = dispatch(parseSave(JSON.stringify(save)), decision);
    expect(committed.run!.lastReport!.damage).toBe(preview.damage);
    expect(committed.run!.lastReport!.extraDamage).toBe(preview.extraDamage);
    const loaded = parseSave(JSON.stringify(committed)), preserved = structuredClone(loaded);
    expect(historyCounts(loaded.history!)).toEqual({ battles: 1, casts: 1 });
    expect(loaded.run!.contributions!.battles[0].casts).toBe(1);
    expect(loaded.history!.runs.at(-1)!.battles[0].ledger.skills[id]!.uses).toBe(1);
    expect(() => dispatch(loaded, decision)).toThrow('すでに'); expect(loaded).toEqual(preserved);
  });

  it('accepts a stored pre-adjustment additional-skill report without recalculating its damage', () => {
    const { save, root } = fixture('pierce'); save.run!.enemyHp = 1;
    const committed = dispatch(save, action(save.run!, root, 'pierce'));
    const run = committed.run!, report = run.lastReport!, values = skillValues(save.run!, 'pierce');
    // Recreate the previous formula in a completed historical report, leaving its cast settled.
    report.extraDamage = Math.floor((report.weak * values.weakAttack + values.weakBurst) * spellMultiplier(save.run!.spellLevel));
    report.damage = report.baseDamage! + report.clearBonus! + report.extraDamage; report.guaranteedDamage = report.damage;
    expect(report.damage).toBeGreaterThan(report.enemyBefore); expect(report.defeated).toBe(true);
    report.attackScore = report.damage; run.score = report.attackScore + 500;
    report.ledger!.overkill = report.damage - report.enemyBefore;
    const totals = { damage: report.damage, hpDamage: report.enemyBefore, overkill: report.ledger!.overkill };
    const contribution = run.contributions!.battles[0]; Object.assign(contribution, totals, { score: run.score });
    Object.assign(contribution.skills.pierce!, totals);
    const battle = committed.history!.runs.at(-1)!.battles[0];
    Object.assign(battle.ledger, totals, { score: run.score }); Object.assign(battle.ledger.skills.pierce!, totals);
    Object.assign(battle.casts[0], totals, { score: run.score });
    const loaded = parseSave(JSON.stringify(committed));
    expect(loaded).toEqual(committed);
    expect(loaded.run!.lastReport!.extraDamage).toBe(report.extraDamage);
    expect(loaded.history!.runs.at(-1)!.battles[0].casts[0].damage).toBe(report.damage);
  });
});
