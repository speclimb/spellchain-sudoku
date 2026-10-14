import { describe, expect, it } from 'vitest';
import { dispatch, legalOrigins, newSave, resolveAction, startRun } from '../src/game/engine';
import { boundHistory, forkHistory, historyCounts, historyKey, HISTORY_LIMITS, type PlayHistory } from '../src/game/history';

function fixture() {
  let save = startRun(newSave(), 'fuse', 51);
  save = dispatch(save, { type: 'play', cell: legalOrigins(save.run!)[0], skill: false, revision: save.run!.revision });
  return save;
}
function many(runs: number, battles: number, casts: number): PlayHistory {
  const save = fixture(), base = save.history!.runs[0].battles[0];
  return { version: 1, omittedRuns: 0, runs: Array.from({ length: runs }, (_, r) => ({
    ...save.history!.runs[0], key: `test-${r}`, number: r + 1,
    battles: Array.from({ length: battles }, (_, b) => ({ ...base, stage: b,
      ledger: { ...base.ledger, stage: b, casts },
      casts: Array.from({ length: casts }, (_, c) => ({ ...base.casts[0], id: b * casts + c + 1 })) })) })) };
}

describe('independent history retention review', () => {
  it('retains exactly ten adventures and 1000 battles without trimming the boundary', () => {
    const history = many(10, 100, 1);
    boundHistory(history, Infinity);
    expect(history.runs).toHaveLength(10);
    expect(historyCounts(history)).toEqual({ battles: 1000, casts: 1000 });
    expect(history.omittedRuns).toBe(0);
    expect(history.runs.every(run => run.omittedBattles === 0)).toBe(true);
  });
  it('first drops an eleventh adventure, then trims only oldest excess battles', () => {
    const history = many(11, 101, 1);
    boundHistory(history, Infinity);
    expect(history.runs).toHaveLength(10);
    expect(historyCounts(history).battles).toBe(1000);
    expect(history.omittedRuns).toBe(1);
    expect(history.runs[0].number).toBe(2);
    expect(history.runs[0].omittedBattles).toBe(10);
    expect(history.runs[0].battles[0].stage).toBe(10);
    expect(history.runs.at(-1)!.battles.at(-1)!.stage).toBe(100);
  });
  it('trims oldest cast details across battle boundaries without changing aggregates', () => {
    const history = many(10, 100, 101);
    boundHistory(history, Infinity);
    expect(historyCounts(history)).toEqual({ battles: 1000, casts: HISTORY_LIMITS.casts });
    expect(history.runs[0].battles.slice(0, 9).every(b => b.casts.length === 0)).toBe(true);
    expect(history.runs[0].battles[9].casts).toHaveLength(10);
    expect(history.runs[0].battles[9].casts[0].id).toBe(1001);
    expect(history.runs.every(r => r.battles.every(b => b.ledger.casts === 101))).toBe(true);
  });
  it('copy-on-write shares archives but isolates current battle, containers and pruning', () => {
    const history = many(2, 3, 2), before = structuredClone(history);
    const copy = forkHistory(history, history.runs[1].key)!;
    expect(copy).not.toBe(history);
    expect(copy.runs[0]).not.toBe(history.runs[0]);
    expect(copy.runs[0].battles).not.toBe(history.runs[0].battles);
    expect(copy.runs[0].battles[0]).toBe(history.runs[0].battles[0]);
    expect(copy.runs[1].battles.at(-1)).not.toBe(history.runs[1].battles.at(-1));
    copy.runs[1].battles.at(-1)!.casts[0].damage++;
    boundHistory(copy, 1000);
    expect(history).toEqual(before);
  });
  it('new adventure retirement never mutates an old save or its battle statuses', () => {
    const save = fixture(), before = structuredClone(save);
    const next = startRun(save, 'fuse', 52);
    expect(save).toEqual(before);
    expect(next.history!.runs[0].status).toBe('retired');
    expect(next.history!.runs[0].battles[0].status).toBe('retired');
    expect(next.history!.runs[0].battles[0]).not.toBe(save.history!.runs[0].battles[0]);
  });
  it('dispatch keeps identical gameplay to the reducer while isolating all old history', () => {
    const save = fixture(), before = structuredClone(save);
    const action = { type: 'play' as const, cell: legalOrigins(save.run!)[0], skill: false, revision: save.run!.revision };
    const expected = resolveAction(save.run!, action), next = dispatch(save, action);
    expect(next.run).toEqual(expected);
    expect(save).toEqual(before);
    expect(next.history!.runs.find(r => r.key === historyKey(next))!.battles[0].casts.length).toBe(2);
  });
});
