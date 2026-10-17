import { describe, expect, it } from 'vitest';
import { dispatch, newSave, previewAction, startRun } from '../src/game/engine';
import { parseHistory } from '../src/game/history-validation';
import { parseSave } from '../src/game/storage';
import { historyCastDetails } from '../src/ui/play-history';

function fixture(level: number, items: number) {
  const save = newSave(); save.meta.clears = 99;
  const next = startRun(save, 'lumen', 71), run = next.run!;
  run.spellLevel = level; run.rescueMilestones = level >= 200 ? Math.floor(level / 100) - 1 : 0;
  run.rescueItems = items; run.cells = [...run.solution]; run.cells[2] = 0; run.cells[13] = 0; run.enemyHp = 1;
  return next;
}

describe('limited rescue item history', () => {
  it('records use once only on commit, round trips it, and renders separate item units', () => {
    const save = fixture(200, 1), run = save.run!;
    const before = structuredClone(save);
    previewAction(run, 2, false, undefined, true); previewAction(run, 2, false, undefined, true);
    expect(save).toEqual(before);
    const next = dispatch(save, { type: 'play', cell: 2, skill: false, useRescue: true, revision: run.revision });
    const cast = next.history!.runs.at(-1)!.battles[0].casts[0];
    expect(cast).toMatchObject({ rescueItemsBefore: 1, rescueItemsAfter: 0, rescueItemsGranted: 0, rescueRequested: true });
    expect(historyCastDetails(cast)).toContain('接続の栞');
    expect(historyCastDetails(cast)).toContain('1 → 0個');
    expect(historyCastDetails(cast)).toContain('接続救済に使う');
    expect(parseHistory(structuredClone(next.history))).toEqual(next.history);
    expect(parseSave(JSON.stringify(next))).toEqual(next);
  });

  it('records a level-200 grant after the cast, without using it in that same cast', () => {
    const save = fixture(199, 0), run = save.run!;
    const next = dispatch(save, { type: 'play', cell: 2, skill: false, useRescue: true, revision: run.revision });
    const cast = next.history!.runs.at(-1)!.battles[0].casts[0];
    expect(next.run!.lastReport!.path).toHaveLength(1);
    expect(cast).toMatchObject({ rescueItemsBefore: 0, rescueItemsAfter: 1, rescueItemsGranted: 1 });
    expect(next.run!.spellLevel).toBe(200);
    expect(parseSave(JSON.stringify(next))).toEqual(next);
  });

  it('preserves older history without inventing items, and rejects partial or invalid accounting', () => {
    const save = fixture(200, 1), run = save.run!;
    const next = dispatch(save, { type: 'play', cell: 2, skill: false, revision: run.revision });
    const legacy = structuredClone(next.history!);
    const cast = legacy.runs[0].battles[0].casts[0];
    delete cast.rescueItemsBefore; delete cast.rescueItemsAfter; delete cast.rescueItemsGranted; delete cast.rescueRequested;
    expect(parseHistory(legacy)).toEqual(legacy);
    expect(historyCastDetails(cast)).not.toContain('接続の栞');
    for (const mutate of [
      (c: any) => { delete c.rescueItemsGranted; },
      (c: any) => { c.rescueItemsAfter = 2; },
      (c: any) => { c.rescueItemsBefore = -1; },
      (c: any) => { c.rescueItemsGranted = .5; },
      (c: any) => { c.rescueRequested = 'yes'; },
    ]) {
      const invalid = structuredClone(next.history!); mutate(invalid.runs[0].battles[0].casts[0]);
      expect(parseHistory(invalid)).toBeUndefined();
    }
  });
  it('records reserving an item and accepts old automatic item history with no selection', () => {
    const save = fixture(200, 1), run = save.run!;
    const reserved = dispatch(save, { type: 'play', cell: 2, skill: false, revision: run.revision });
    const reservedCast = reserved.history!.runs[0].battles[0].casts[0];
    expect(reservedCast).toMatchObject({ rescueRequested: false, rescueItemsBefore: 1, rescueItemsAfter: 1 });
    expect(historyCastDetails(reservedCast)).toContain('温存する');
    expect(parseSave(JSON.stringify(reserved))).toEqual(reserved);
    const used = dispatch(save, { type: 'play', cell: 2, skill: false, useRescue: true, revision: run.revision });
    const history = structuredClone(used.history!), cast = history.runs[0].battles[0].casts[0];
    delete cast.rescueRequested;
    expect(parseHistory(history)).toEqual(history);
    expect(historyCastDetails(cast)).toContain('旧記録（使用指定の記録なし）');
    cast.rescueRequested = false;
    expect(parseHistory(history)).toBeUndefined();
  });
});
