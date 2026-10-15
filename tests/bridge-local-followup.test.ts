import { describe, expect, it } from 'vitest';
import { dispatch, legalOrigins, newSave, previewAction, spellMultiplier, startRun } from '../src/game/engine';
import { relicValues, skillValues } from '../src/game/growth';
import { historyCounts } from '../src/game/history';
import { parseSave } from '../src/game/storage';
import type { Preview, RelicId, Run } from '../src/game/types';

function fixture(carry = false) {
  const initial = newSave(); initial.meta.clears = 99;
  const save = startRun(initial, 'lumen', 71), run = save.run!;
  run.mana = 8; run.skillLevels = { lumen: 10, bridge: 10 }; run.equippedSkills = ['bridge']; run.spellLevel = 60;
  run.inventory = ['pen', 'stroke', 'amplifier', 'glass', 'ward'];
  if (carry) run.inventory.push('wick');
  for (const id of run.inventory) { run.relicLevels![id] = 10; run.tier[id] = 3; }
  return save;
}
function partial(run: Run, empty: number[]) {
  run.cells = [...run.solution]; run.marks.fill(null);
  for (const cell of empty) { expect(run.givens[cell]).toBe(false); run.cells[cell] = 0; }
}
function best(run: Run): Preview {
  return legalOrigins(run, true, 'bridge').map(cell => previewAction(run, cell, true, 'bridge'))
    .sort((a, b) => b.damage - a.damage)[0];
}
/** Independent per-event reconstruction; no production subtotal is exposed. */
function expectedFollowUp(run: Run, report: Preview): number {
  const start = report.path.findIndex(event => event.bridge);
  if (start < 0 || report.path.length - start < 3) return 0;
  const pen = relicValues(run, 'pen'), lens = relicValues(run, 'lens'), stroke = relicValues(run, 'stroke');
  const raw = report.path.slice(start, start + 3).reduce((sum, event) => {
    const base = Math.min(80, 10 + (event.ordinal - 1) * 2);
    const completion = event.units.length * (20 + (run.character === 'scribe' ? 10 : 0) + pen.completion);
    const weak = event.mark === 'weak' ? lens.weakDamage : 0;
    const echo = event.source === 'echo' ? relicValues(run, 'echo').echoDamage : 0;
    return sum + (base + completion + weak + echo) * (event.ordinal <= stroke.strokeCells ? stroke.strokeMultiplier : 1);
  }, 0);
  const glass = relicValues(run, 'glass').damageMultiplier, amp = relicValues(run, 'amplifier').skillMultiplier;
  const local = Math.floor(raw * spellMultiplier(run.spellLevel) * (run.relicBalanceVersion ? glass + amp - 1 : glass * amp));
  return Math.floor(local * skillValues(run, 'bridge').situationalAttack);
}
const action = (run: Run, cell: number) => ({ type: 'play' as const, cell, skill: true, skillId: 'bridge' as const, revision: run.revision });

describe('Bridge first-reconnect three-input follow-up', () => {
  it.each([[2, 13], [2, 13, 14], [2, 13, 14, 16], [2, 13, 14, 16, 22]])('uses exactly three recovered inputs from %j', (...empty: number[]) => {
    const run = fixture().run!; partial(run, empty);
    const report = previewAction(run, 2, true, 'bridge');
    expect(report.path[1].bridge).toBe(true);
    expect(report.extraDamage).toBe(expectedFollowUp(run, report));
    if (empty.length < 4) expect(report.extraDamage).toBe(0);
    else expect(report.extraDamage).toBeGreaterThan(0);
  });

  it('does not trigger without a reconnect', () => {
    const run = fixture().run!; partial(run, [9, 11, 13, 14, 16]);
    const report = best(run);
    expect(report.path.some(event => event.bridge)).toBe(false); expect(report.extraDamage).toBe(0);
  });

  it('keeps the 82-input three-sheet chain but caps the bonus window once', () => {
    const run = fixture(true).run!, report = best(run);
    expect(report.path).toHaveLength(82); expect(report.segments).toHaveLength(3);
    expect(report.path.filter(event => event.bridge).length).toBeGreaterThan(1);
    expect(report.baseDamage).toBe(357987); expect(report.clearBonus).toBe(82091);
    expect(report.damage).toBe(617843); expect(report.extraDamage).toBe(expectedFollowUp(run, report));
    expect(report.extraDamage).toBe(177765);
    // Ordinary damage and all 36+ inputs survive; neither the old whole-cast
    // multiplier nor an additional window for each reconnect survives.
    expect(report.extraDamage).toBeLessThan(report.baseDamage!);
  });

  it('does not restart or truncate the window at a sheet boundary', () => {
    const run = fixture(true).run!; partial(run, [2, 13]);
    const report = previewAction(run, 2, true, 'bridge');
    const start = report.path.findIndex(event => event.bridge), window = report.path.slice(start, start + 3);
    expect(start).toBe(1); expect(window).toHaveLength(3);
    expect(new Set(window.map(event => event.sheet)).size).toBe(2);
    expect(report.extraDamage).toBe(expectedFollowUp(run, report)); expect(report.extraDamage).toBeGreaterThan(0);
  });

  it.each([undefined, 1] as const)('attributes only the selected inputs under relic version %s', version => {
    const run = fixture().run!; partial(run, [2, 13, 14, 16]); run.relicBalanceVersion = version;
    run.inventory.push('lens'); run.relicLevels!.lens = 10; run.tier.lens = 3;
    run.marks[13] = 'weak';
    const report = previewAction(run, 2, true, 'bridge');
    expect(report.extraDamage).toBe(expectedFollowUp(run, report));
    for (const id of ['pen', 'lens', 'stroke', 'glass', 'amplifier'] as RelicId[]) {
      const lower = structuredClone(run); lower.inventory = lower.inventory.filter(relic => relic !== id);
      const without = previewAction(lower, 2, true, 'bridge');
      expect(without.path).toEqual(report.path);
      expect(without.extraDamage).toBe(expectedFollowUp(lower, without));
      expect(report.ledger!.relics[id]!.damage).toBe(report.damage - without.damage);
    }
  });

  it('does not credit a root-only weak bonus to the recovered-input follow-up', () => {
    const run = fixture().run!; partial(run, [2, 13, 14, 16]); run.marks[2] = 'weak';
    run.inventory.push('lens'); run.relicLevels!.lens = 10;
    const report = previewAction(run, 2, true, 'bridge');
    const lower = structuredClone(run); lower.inventory = lower.inventory.filter(id => id !== 'lens');
    const without = previewAction(lower, 2, true, 'bridge');
    expect(report.baseDamage!).toBeGreaterThan(without.baseDamage!);
    expect(report.extraDamage).toBe(without.extraDamage);
    expect(report.ledger!.relics.lens!.damage).toBe(report.damage - without.damage);
  });

  it('keeps the earlier echo damage out of the local follow-up and its attribution', () => {
    const run = fixture(true).run!;
    run.inventory.push('echo'); run.relicLevels!.echo = 3;
    const report = best(run), lower = structuredClone(run);
    // Both levels have one identical echo input; only its flat attack differs.
    lower.relicLevels!.echo = 1;
    const withoutFlatEcho = previewAction(lower, report.path[0].cell, true, 'bridge');
    expect(report.path.some(event => event.source === 'echo')).toBe(true);
    expect(report.path).toEqual(withoutFlatEcho.path);
    expect(report.extraDamage).toBeGreaterThan(0);
    expect(report.extraDamage).toBe(withoutFlatEcho.extraDamage);
    expect(report.ledger!.relics.echo!.damage).toBe(report.damage - withoutFlatEcho.damage);
  });

  it('excludes Trinity and sheet-clear bonuses from the local follow-up', () => {
    const run = fixture(true).run!; run.inventory.push('trinity'); run.relicLevels!.trinity = 1;
    const report = best(run);
    expect(report.clearBonus!).toBeGreaterThan(0);
    expect(report.forecast!.procs!.some(proc => proc.id === 'trinity')).toBe(true);
    expect(report.extraDamage).toBe(expectedFollowUp(run, report));
    expect(report.forecast!.damageMax).toBe(Math.floor(report.baseDamage! * 1.5) + report.clearBonus! + report.extraDamage!);
  });

  it('keeps preview, commit, history, contribution and reload identical', () => {
    const save = fixture(true), run = save.run!, before = structuredClone(save), forecast = best(run);
    const decision = action(run, forecast.path[0].cell);
    expect(save).toEqual(before);
    const committed = dispatch(parseSave(JSON.stringify(save)), decision), report = committed.run!.lastReport!;
    expect(report.damage).toBe(forecast.damage); expect(report.extraDamage).toBe(forecast.extraDamage);
    expect(report.path).toEqual(forecast.path); expect(report.ledger).toEqual(forecast.ledger);
    const cast = committed.history!.runs.at(-1)!.battles[0].casts[0];
    expect(cast.damage).toBe(report.damage); expect(cast.chain).toBe(82);
    expect(historyCounts(committed.history!)).toEqual({ battles: 1, casts: 1 });
    expect(parseSave(JSON.stringify(committed))).toEqual(committed);
    expect(() => dispatch(committed, decision)).toThrow('すでに');
  });

  it('preserves an already committed old whole-cast report without migration or resettlement', () => {
    const save = fixture(true), run = save.run!, forecast = best(run);
    const committed = dispatch(save, action(run, forecast.path[0].cell));
    const after = committed.run!, report = after.lastReport!;
    report.extraDamage = Math.floor(report.baseDamage! * 7);
    report.damage = report.baseDamage! + report.clearBonus! + report.extraDamage; report.guaranteedDamage = report.damage;
    report.attackScore = report.damage; after.score = report.attackScore + 500;
    report.ledger!.overkill = report.damage - report.enemyBefore;
    const totals = { damage: report.damage, hpDamage: report.enemyBefore, overkill: report.ledger!.overkill };
    const contribution = after.contributions!.battles[0]; Object.assign(contribution, totals, { score: after.score });
    Object.assign(contribution.skills.bridge!, totals);
    const battle = committed.history!.runs.at(-1)!.battles[0];
    Object.assign(battle.ledger, totals, { score: after.score }); Object.assign(battle.ledger.skills.bridge!, totals);
    Object.assign(battle.casts[0], totals, { score: after.score });
    const loaded = parseSave(JSON.stringify(committed));
    expect(loaded).toEqual(committed); expect(loaded.run!.lastReport!.damage).toBe(2945987);
    expect(loaded.history!.runs.at(-1)!.battles[0].casts[0].damage).toBe(2945987);
  });
});
