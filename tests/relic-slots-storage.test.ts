import { describe, expect, it } from 'vitest';
import { RELICS } from '../src/game/content';
import { dispatch, newSave, startRun } from '../src/game/engine';
import { enemyForRun } from '../src/game/enemies';
import { parseSave } from '../src/game/storage';
import { PEERS } from '../src/game/sudoku';
import type { Run, Save } from '../src/game/types';

function fixture(): Save {
  const save = newSave(); save.meta.clears = 99;
  return startRun(save, 'fuse', 73);
}
function rewardFixture(): Save {
  const save = fixture(), run = save.run!;
  run.inventory = RELICS.slice(0, 8).map(relic => relic.id);
  for (const id of run.inventory) { run.relicLevels![id] = 6; run.acquisitionRank[id] = 1; run.tier[id] = 2; }
  run.phase = 'reward'; run.rewardStep = 'relic'; run.enemyHp = 0; run.cells = [...run.solution]; run.stats.kills = 1;
  run.rewards = ['gold', 'training', 'recovery'];
  return save;
}
function healedCast(stage = 18, hp = 1, full = false, skill = false): Save {
  const save = fixture(), run = save.run!;
  run.inventory = ['gold']; run.relicLevels!.gold = 10; run.tier.gold = 3; run.acquisitionRank.gold = 1;
  run.stage = stage; run.stats.kills = stage; run.enemyRulesVersion = 0; run.enemyHp = enemyForRun(run).hp;
  run.hp = hp; run.mana = 8;
  const blanks = run.givens.flatMap((given, cell) => !given && run.marks[cell] === null ? [cell] : []);
  const root = blanks[0], spare = blanks.find(cell => cell !== root && !PEERS[root].includes(cell))!;
  expect(spare).toBeDefined();
  run.cells = [...run.solution]; run.cells[root] = 0;
  if (!full) run.cells[spare] = 0;
  return dispatch(save, { type: 'play', cell: root, skill, revision: run.revision });
}

describe('archived relic growth persistence', () => {
  it('round trips inert archived growth and leaves old versionless over-capacity inventories intact', () => {
    const save = rewardFixture();
    save.run!.stowedRelics = { gold: { level: 9, rank: 1, tier: 3 }, quint: { level: 5, rank: 3, tier: 2 } };
    expect(parseSave(JSON.stringify(save))).toEqual(save);
    const old = fixture();
    delete old.run!.relicBalanceVersion; delete old.run!.stowedRelics;
    old.run!.inventory = RELICS.slice(0, 11).map(relic => relic.id);
    old.run!.maxHp = old.run!.hp = 32;
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded).toEqual(old);
    expect(loaded.run!.inventory).toHaveLength(11);
    expect(loaded.run!.relicBalanceVersion).toBeUndefined();
    expect(loaded.run!.stowedRelics).toBeUndefined();
  });

  it.each([
    ['active owner', (run: Run) => { run.stowedRelics = { wick: { level: 5, rank: 1, tier: 2 } }; }],
    ['outside pool', (run: Run) => { run.pool = run.pool.filter(id => id !== 'gold'); }],
    ['level zero', (run: Run) => { run.stowedRelics!.gold!.level = 0; }],
    ['level eleven', (run: Run) => { run.stowedRelics!.gold!.level = 11; }],
    ['fractional level', (run: Run) => { run.stowedRelics!.gold!.level = 2.5; }],
    ['nonprime rank two', (run: Run) => { run.stowedRelics!.gold!.rank = 2; }],
    ['prime rank four', (run: Run) => { run.stowedRelics!.quint!.rank = 4; }],
    ['tier four', (run: Run) => { run.stowedRelics!.gold!.tier = 4; }],
    ['apex below five', (run: Run) => { run.stowedRelics!.gold!.level = 4; }],
    ['unknown version', (run: Run) => { Object.assign(run, { relicBalanceVersion: 2 }); }],
    ['unknown archived relic', (run: Run) => { Object.assign(run.stowedRelics!, { unknown: { level: 1, rank: 1, tier: 1 } }); }],
    ['archived transient state', (run: Run) => { Object.assign(run.stowedRelics!.gold!, { manaOverflow: 1 }); }],
  ] as const)('rejects %s', (_name, mutate) => {
    const save = rewardFixture();
    save.run!.stowedRelics = { gold: { level: 9, rank: 1, tier: 3 }, quint: { level: 5, rank: 3, tier: 2 } };
    mutate(save.run!);
    expect(() => parseSave(JSON.stringify(save))).toThrow();
  });

  it('commits an exchange once and restores the exact retired growth on reacquisition after reload', () => {
    const save = rewardFixture(), original = structuredClone(save);
    const action = { type: 'reward' as const, relic: 'gold' as const, replace: 'pen' as const, revision: save.run!.revision };
    const exchanged = dispatch(save, action), loaded = parseSave(JSON.stringify(exchanged));
    expect(save).toEqual(original);
    expect(loaded.run!.inventory).toHaveLength(8);
    expect(loaded.run!.inventory).toContain('gold');
    expect(loaded.run!.stowedRelics!.pen).toEqual({ level: 6, rank: 1, tier: 2 });
    expect(() => dispatch(loaded, action)).toThrow();
    const run = loaded.run!;
    run.phase = 'reward'; run.rewardStep = 'relic'; run.enemyHp = 0; run.cells = [...run.solution]; run.stats.kills++;
    run.rewards = ['pen', 'training', 'recovery'];
    const restored = dispatch(loaded, { type: 'reward', relic: 'pen', replace: 'gold', revision: run.revision });
    expect(restored.run!.relicLevels!.pen).toBe(6);
    expect(restored.run!.tier.pen).toBe(2);
    expect(restored.run!.acquisitionRank.pen).toBe(1);
    expect(restored.run!.stowedRelics!.pen).toBeUndefined();
    expect(restored.run!.inventory).toHaveLength(8);
    expect(parseSave(JSON.stringify(restored))).toEqual(restored);
  });
});

describe('pre-counter relic healing save validation', () => {
  it('round trips healing that prevents death and a fatal counter without reviving the run', () => {
    const survived = healedCast();
    expect(survived.run!.lastReport).toMatchObject({ hpBefore: 1, relicHealed: 7, received: 4, healed: 7, levelsGained: 0 });
    expect(survived.run!.hp).toBe(4);
    expect(parseSave(JSON.stringify(survived))).toEqual(survived);
    const died = healedCast(20);
    expect(died.run!.phase).toBe('lost'); expect(died.run!.hp).toBe(0);
    expect(died.run!.lastReport!.relicHealed).toBe(7);
    expect(died.run!.lastReport!.levelsGained).toBe(0);
    expect(parseSave(JSON.stringify(died))).toEqual(died);
  });

  it('separates capped relic healing from later sheet growth and skips healing on skills', () => {
    const capped = healedCast(0, 39);
    expect(capped.run!.lastReport!.relicHealed).toBe(1);
    expect(parseSave(JSON.stringify(capped))).toEqual(capped);
    const growth = healedCast(0, 1, true);
    expect(growth.run!.lastReport).toMatchObject({ relicHealed: 7, healed: 17, levelsGained: 1 });
    expect(parseSave(JSON.stringify(growth))).toEqual(growth);
    const skill = healedCast(0, 20, false, true);
    expect(skill.run!.lastReport!.relicHealed).toBe(0);
    expect(parseSave(JSON.stringify(skill))).toEqual(skill);
  });

  it.each([
    ['missing heal', (run: Run) => { delete run.lastReport!.relicHealed; }],
    ['too large heal', (run: Run) => { run.lastReport!.relicHealed = 8; }],
    ['wrong healed amount', (run: Run) => { run.lastReport!.healed++; }],
    ['old post-counter HP arithmetic', (run: Run) => { run.hp = 7; }],
    ['old relic version', (run: Run) => { delete run.relicBalanceVersion; }],
    ['negative healing contribution', (run: Run) => { run.lastReport!.ledger!.relics.gold!.healed = -1; }],
  ] as const)('rejects %s', (_name, mutate) => {
    const save = healedCast(); mutate(save.run!);
    expect(() => parseSave(JSON.stringify(save))).toThrow();
  });

  it('rejects growth healing that resurrects a fatal counter', () => {
    const save = healedCast(20), run = save.run!;
    run.hp = 10; run.phase = 'battle'; run.lastReport!.healed += 10;
    expect(() => parseSave(JSON.stringify(save))).toThrow();
  });
});
