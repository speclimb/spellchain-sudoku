import { it, expect } from 'vitest';
import { dispatch, legalOrigins, newSave, startRun } from '../src/game/engine';
import { historyBytes, type HistoryCast } from '../src/game/history';
it('profiles 1000 battles at one and three casts per battle separately from stress limits', () => {
  let save = startRun(newSave(), 'fuse', 31);
  save = dispatch(save, { type: 'play', cell: legalOrigins(save.run!)[0], skill: false, revision: 0 });
  const base = save.history!.runs[0], battle = base.battles[0], cast = battle.casts[0];
  const sizes = [];
  for (const casts of [1, 3]) for (const rich of [false, true]) {
    const c = structuredClone(cast);
    if (rich) for (const id of ['wick','echo','rekindle','pen','ward','stroke','battery','amplifier','afterglow','lens','glass','gold','trinity','duality','quint','sept']) c.relics[id as keyof HistoryCast['relics']] = { level: 10, tier: 3, metric: { heldCasts: 1, opportunities: 1, triggers: 1, damage: 999999, addedInputs: 3, fuelGranted: 10, fuelUsed: 10, mana: 4, prevented: 5, tokensGranted: 3, tokensUsed: 1, score: 50 } };
    const history = { version: 1 as const, omittedRuns: 0, runs: Array.from({ length: 10 }, (_, number) => ({ ...base, number: number + 1, battles: Array.from({ length: 100 }, (_, stage) => ({ ...battle, stage, casts: Array.from({ length: casts }, (_, id) => ({ ...c, id: stage * casts + id + 1 })) })) })) };
    const bytes = historyBytes(history); sizes.push({ castsPerBattle: casts, all16RelicsAllMetrics: rich, bytes });
    expect(bytes).toBeLessThan(26 * 1024 * 1024);
  }
  console.log('NORMAL_HISTORY_SIZE_MODEL', JSON.stringify(sizes));
});
