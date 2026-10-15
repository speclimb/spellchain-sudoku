import { describe, expect, it } from 'vitest';
import { legalOrigins, newSave, previewAction, resolveAction, sheetShield, spellMultiplier, startRun } from '../src/game/engine';
import { skillValues } from '../src/game/growth';
import { parseSave } from '../src/game/storage';
import type { CharacterId, Preview, Run, SkillId } from '../src/game/types';

type ExtraSkill = 'bridge' | 'pierce' | 'bastion';
const characters: CharacterId[] = ['fuse', 'scribe', 'lumen'];
const levels = [1, 5, 10];
const extras: ExtraSkill[] = ['bridge', 'pierce', 'bastion'];

function fixture(character: CharacterId, level: number, skill: ExtraSkill): Run {
  const save = newSave();
  save.meta.clears = 99;
  const run = startRun(save, character, 71).run!;
  run.mana = 8;
  run.skillRank = level === 1 ? 1 : 2;
  run.skillLevels = { [character]: level, [skill]: level };
  run.equippedSkills = [skill];
  run.spellLevel = level === 1 ? 1 : level === 5 ? 20 : 60;
  if (level > 1) {
    // These real damage/guard relics exercise late scaling. Carry is deliberately
    // absent: this comparison concerns the same remaining sheet, not a new board.
    run.inventory = ['ward', 'pen', 'stroke', 'amplifier', 'glass'];
    for (const relic of run.inventory) {
      run.relicLevels![relic] = level;
      run.tier[relic] = level === 5 ? 2 : 3;
    }
  }
  return run;
}

function partial(run: Run, empty: number[], weak: number[], shield: number[]): Run {
  run.cells = [...run.solution];
  for (const cell of empty) {
    expect(run.givens[cell], `fixture must preserve given at ${cell}`).toBe(false);
    run.cells[cell] = 0;
  }
  run.marks.fill(null);
  for (const [kind, cells] of [['weak', weak], ['shield', shield]] as const) {
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(run.givens[cell], `fixture mark must be an original blank at ${cell}`).toBe(false);
      expect(run.marks[cell]).toBe(null);
      run.marks[cell] = kind;
    }
  }
  return run;
}

function niche(character: CharacterId, level: number, skill: ExtraSkill): Run {
  // On generated seed 71, cell 2 is isolated from the connected row-1 group
  // 13/14/16. All other original blanks have been correctly solved. This gives
  // Bridge three useful recovered inputs; Pierce two nearby weak marks; Bastion
  // two already filled guard marks before starting on the remaining guard mark.
  return partial(fixture(character, level, skill), [2, 13, 14, 16],
    skill === 'pierce' ? [13, 14, 5] : [9, 11, 22],
    skill === 'bastion' ? [13, 5, 8] : [24, 30, 31]);
}

function best(run: Run, skill: SkillId): Preview {
  return legalOrigins(run, true, skill).map(cell => previewAction(run, cell, true, skill))
    .sort((a, b) => b.guaranteedDamage! - a.guaranteedDamage!)[0];
}

function fixedExtra(run: Run, report: Preview, skill: ExtraSkill): number {
  const values = skillValues(run, skill);
  return Math.floor((values.weakAttack * report.weak + (report.weak >= 3 ? values.weakBurst : 0)
    + report.shield * values.shieldAttack) * spellMultiplier(run.spellLevel));
}

describe('additional skills win their deliberate niches', () => {
  for (const character of characters) for (const level of levels) for (const skill of extras) {
    it(`${character} Lv.${level}: ${skill} beats the best intrinsic origin by at least 20%`, () => {
      const run = niche(character, level, skill);
      const intrinsic = best(run, character);
      const extra = previewAction(run, skill === 'bridge' ? 2 : 13, true, skill);
      const context = `${skill} ${extra.guaranteedDamage} vs ${character} ${intrinsic.guaranteedDamage}`;
      expect(extra.guaranteedDamage!, context).toBeGreaterThan(intrinsic.guaranteedDamage! * 1.2);
      expect(extra.extraDamage!, context).toBeGreaterThan(fixedExtra(run, extra, skill));
      expect(run.mana).toBe(8);
    });
  }

  for (const character of characters) for (const level of levels) for (const skill of ['pierce', 'bastion'] as const) {
    it(`${character} Lv.${level}: intrinsic remains stronger without ${skill}'s target setup`, () => {
      const run = fixture(character, level, skill);
      const intrinsic = best(run, character), extra = best(run, skill);
      expect(extra.extraDamage).toBe(fixedExtra(run, extra, skill));
      expect(intrinsic.guaranteedDamage!, `${character} ${intrinsic.guaranteedDamage} vs ${skill} ${extra.guaranteedDamage}`)
        .toBeGreaterThan(extra.guaranteedDamage!);
    });
  }

  for (const character of characters) for (const level of levels) {
    it(`${character} Lv.${level}: Bridge has no follow-up when the same row stays connected`, () => {
      const run = partial(fixture(character, level, 'bridge'), [9, 11, 13, 14, 16], [2, 5, 8], [22, 24, 30]);
      const extra = best(run, 'bridge'), intrinsic = best(run, character);
      expect(extra.path.some(event => event.bridge)).toBe(false);
      expect(extra.extraDamage).toBe(0);
      expect(intrinsic.guaranteedDamage!, `${character} ${intrinsic.guaranteedDamage} vs bridge ${extra.guaranteedDamage}`)
        .toBeGreaterThanOrEqual(extra.guaranteedDamage!);
    });
  }
});

describe('situational follow-ups require real, bounded target conditions', () => {
  it('Bridge needs three recovered inputs, rather than one successful jump alone', () => {
    const short = partial(fixture('lumen', 10, 'bridge'), [2, 13, 14], [9, 11, 22], [24, 30, 31]);
    const before = previewAction(short, 2, true, 'bridge');
    expect(before.path.map(event => event.cell)).toEqual([2, 13, 14]);
    expect(before.path[1].bridge).toBe(true);
    expect(before.extraDamage).toBe(0);
    const enough = niche('lumen', 10, 'bridge'), after = previewAction(enough, 2, true, 'bridge');
    expect(after.path.map(event => event.cell)).toEqual([2, 13, 14, 16]);
    // Only the three recovered inputs, excluding the isolated opening cell.
    expect(after.extraDamage).toBe(318647);
    expect(after.extraDamage!).toBeLessThan(after.baseDamage! * skillValues(enough, 'bridge').situationalAttack);
  });

  it('Pierce needs a weak origin and at least two actually filled weak marks', () => {
    const run = niche('lumen', 10, 'pierce');
    const wrongOrigin = previewAction(run, 16, true, 'pierce');
    expect(wrongOrigin.weak).toBe(2);
    expect(wrongOrigin.extraDamage).toBe(fixedExtra(run, wrongOrigin, 'pierce'));
    partial(run, [2, 13, 14, 16], [13, 5, 8], [24, 30, 31]);
    const onlyOne = previewAction(run, 13, true, 'pierce');
    expect(onlyOne.weak).toBe(1);
    expect(onlyOne.extraDamage).toBe(fixedExtra(run, onlyOne, 'pierce'));
  });

  it('Pierce accepts exactly 25% weak density and rejects a diluted nine-input cast', () => {
    const eight = partial(fixture('lumen', 10, 'pierce'), [2, 5, 8, 9, 11, 13, 14, 16], [2, 11, 22], [24, 30, 31]);
    const focused = previewAction(eight, 2, true, 'pierce');
    expect(focused.path).toHaveLength(8);
    expect(focused.weak).toBe(2);
    expect(focused.extraDamage!).toBeGreaterThan(fixedExtra(eight, focused, 'pierce') + focused.baseDamage!);
    const nine = partial(fixture('lumen', 10, 'pierce'), [2, 5, 8, 9, 11, 13, 14, 16, 22], [8, 16, 24], [30, 31, 32]);
    const diluted = previewAction(nine, 8, true, 'pierce');
    expect(diluted.path).toHaveLength(9);
    expect(diluted.weak).toBe(2);
    expect(diluted.extraDamage).toBe(fixedExtra(nine, diluted, 'pierce'));
  });

  it('does not turn a weak opening into a focus bonus for an entire diluted cross-sheet cast', () => {
    const run = partial(fixture('lumen', 10, 'pierce'), [13, 14, 16], [13, 14, 16], [2, 5, 8]);
    run.inventory = ['wick'];
    run.relicLevels!.wick = 10;
    run.tier.wick = 2;
    const report = previewAction(run, 13, true, 'pierce');
    expect(report.segments!.length).toBeGreaterThan(1);
    expect(report.path.slice(0, 3).every(event => event.mark === 'weak')).toBe(true);
    expect(report.weak).toBeGreaterThanOrEqual(3);
    expect(report.weak * 4).toBeLessThan(report.path.length);
    expect(report.extraDamage).toBe(fixedExtra(run, report, 'pierce'));
  });

  it('Bastion needs a guard origin and twelve guard already present before its temporary guard', () => {
    const run = partial(fixture('lumen', 10, 'bastion'), [2, 13, 14, 16], [9, 11, 22], [13, 14, 5]);
    run.inventory = [];
    expect(sheetShield(run)).toBe(6);
    const notCharged = previewAction(run, 13, true, 'bastion');
    expect(notCharged.temporaryShield).toBe(14);
    expect(notCharged.shield).toBeGreaterThanOrEqual(12);
    expect(notCharged.extraDamage).toBe(fixedExtra(run, notCharged, 'bastion'));
    partial(run, [2, 13, 14, 16], [9, 11, 22], [13, 5, 8]);
    expect(sheetShield(run)).toBe(12);
    const wrongOrigin = previewAction(run, 14, true, 'bastion');
    expect(wrongOrigin.extraDamage).toBe(fixedExtra(run, wrongOrigin, 'bastion'));
    const charged = previewAction(run, 13, true, 'bastion');
    expect(charged.extraDamage!).toBeGreaterThan(fixedExtra(run, charged, 'bastion') + charged.baseDamage!);
  });

  it('keeps the focused preview deterministic through resolution and a save round trip', () => {
    const save = newSave();
    save.meta.clears = 99;
    save.run = niche('lumen', 1, 'pierce');
    const restored = parseSave(JSON.stringify(save));
    const before = JSON.stringify(restored.run);
    const forecast = previewAction(restored.run!, 13, true, 'pierce');
    expect(JSON.stringify(restored.run)).toBe(before);
    const resolved = resolveAction(restored.run!, { type: 'play', cell: 13, skill: true, skillId: 'pierce', revision: restored.run!.revision });
    expect(resolved.lastReport!.path).toEqual(forecast.path);
    expect(resolved.lastReport!.extraDamage).toBe(forecast.extraDamage);
    expect(resolved.lastReport!.damage).toBe(forecast.guaranteedDamage);
    expect(resolved.mana).toBe(0);
    expect(parseSave(JSON.stringify({ ...restored, run: resolved })).run).toEqual(resolved);
  });
});
