import { describe, expect, it } from 'vitest';
import { enemyOf } from '../src/game/content';
import { dispatch, newSave, startRun } from '../src/game/engine';
import { ENDGAME_ATTACK_QUADRATIC_DIVISOR, ENDGAME_ATTACK_SLOPE, ENDGAME_BOSS_HP_RATIO, enemyAt, enemyForRun, enemyHealthAt, enemyIncoming, enemyIntent } from '../src/game/enemies';
import { parseSave } from '../src/game/storage';
import { singles } from '../src/game/sudoku';

const encounter = (stage: number, turn = 0, version: 1 | 2 = 2) => ({
  stage, turn, balanceVersion: 2 as const, enemyRulesVersion: 1 as const,
  enemyHealthVersion: 1 as const, endgameBalanceVersion: version,
});

describe('endgame encounter balance opt-in', () => {
  it('keeps saved version-one encounters on the six-per-encounter attack curve', () => {
    for (let stage = 0; stage < 50; stage++) expect(enemyForRun(encounter(stage, 0, 1)).attack).toBe(enemyOf(stage).attack);
    for (const [wave, attack] of [[50, 227], [51, 233], [80, 407], [100, 527], [145, 797]]) {
      expect(enemyForRun(encounter(wave - 1, 0, 1)).attack).toBe(attack);
    }
    for (let stage = 50; stage < 300; stage++) {
      expect(enemyForRun(encounter(stage, 0, 1)).attack - enemyForRun(encounter(stage - 1, 0, 1)).attack).toBe(6);
    }
  });

  it('preserves the first fifty attacks, then adds gradually increasing pressure in version two', () => {
    for (let stage = 0; stage < 50; stage++) expect(enemyForRun(encounter(stage)).attack).toBe(enemyOf(stage).attack);
    for (const [wave, attack] of [[50, 227], [51, 235], [80, 472], [100, 642], [145, 1043], [200, 1567]]) {
      expect(enemyForRun(encounter(wave - 1)).attack).toBe(attack);
    }
    for (let stage = 50; stage < 300; stage++) {
      const depth = stage + 1 - 50;
      expect(enemyForRun(encounter(stage)).attack)
        .toBe(227 + ENDGAME_ATTACK_SLOPE * depth + Math.floor(depth ** 2 / ENDGAME_ATTACK_QUADRATIC_DIVISOR));
      expect(enemyForRun(encounter(stage)).attack).toBeGreaterThan(enemyForRun(encounter(stage, 0, 1)).attack);
      expect(enemyForRun(encounter(stage)).attack).toBeLessThan(enemyOf(stage).attack);
    }
  });

  it('keeps saved version-one bosses on the six-times ordinary HP cap', () => {
    for (let stage = 0; stage < 300; stage++) {
      const base = enemyOf(stage), current = enemyForRun(encounter(stage, 0, 1));
      const ordinary = Math.round(base.hp * (1 + .012 * Math.max(0, stage + 1 - 15)));
      expect(current.hp).toBe(base.isBoss ? Math.min(enemyHealthAt(stage), ordinary * 6) : enemyHealthAt(stage));
      if (stage < 80) expect(current.hp).toBe(enemyHealthAt(stage));
    }
    expect([79, 99, 144].map(stage => enemyHealthAt(stage, 1))).toEqual([13_616_859, 26_739_750, 74_012_160]);
  });

  it('raises the version-two boss cap while preserving ordinary HP and the early bosses', () => {
    for (let stage = 0; stage < 300; stage++) {
      const base = enemyOf(stage), current = enemyForRun(encounter(stage));
      const ordinary = Math.round(base.hp * (1 + .012 * Math.max(0, stage + 1 - 15)));
      expect(current.hp).toBe(base.isBoss ? Math.min(enemyHealthAt(stage), ordinary * ENDGAME_BOSS_HP_RATIO) : enemyHealthAt(stage));
      expect(current.hp).toBeGreaterThanOrEqual(enemyHealthAt(stage, 1));
      if (stage < 100) expect(current.hp).toBe(enemyHealthAt(stage));
    }
    expect(enemyHealthAt(144, 2)).toBe(98_682_880);
  });

  it('preserves every legacy curve and counter when the new flag is absent', () => {
    for (let stage = 0; stage < 200; stage++) for (const balanceVersion of [1, 2] as const) {
      const base = { stage, balanceVersion };
      expect(enemyForRun(base)).toEqual(enemyAt(stage, balanceVersion, 0, 0, 0));
      for (const enemyHealthVersion of [0, 1] as const) {
        expect(enemyForRun({ ...base, enemyRulesVersion: 1, enemyHealthVersion }))
          .toEqual(enemyAt(stage, balanceVersion, 1, enemyHealthVersion, 0));
      }
      for (const version of [1, 2] as const) expect(enemyAt(stage, 1, 0, 1, version)).toEqual(enemyAt(stage, 1, 0, 1, 0));
    }
  });

  it('keeps third-turn heavies and alternating wolf charge/strike on the new base attack', () => {
    const boss = encounter(144), attack = enemyForRun(boss).attack;
    expect([0, 1, 2, 3].map(turn => enemyIncoming({ ...boss, turn }))).toEqual([attack, attack, attack * 2, attack]);
    const wolfStage = Array.from({ length: 20 }, (_, i) => i + 130).find(stage => enemyForRun(encounter(stage)).symbol === 'frost')!;
    const wolf = encounter(wolfStage), strike = enemyForRun(wolf).attack * 2;
    expect([0, 1, 2, 3].map(turn => enemyIncoming({ ...wolf, turn }))).toEqual([0, strike, 0, strike]);
    expect(enemyIntent(wolf)).toMatchObject({ incoming: 0, nextIncoming: strike, state: 'charge' });
    expect(enemyIntent({ ...boss, turn: 2 })).toMatchObject({ incoming: attack * 2, state: 'heavy' });
  });

  it('bounds HP, attacks and multiplied counters by safe integers at extreme depth', () => {
    for (const stage of [999, 9999, 99999, 999999, Number.MAX_SAFE_INTEGER - 1]) {
      for (const version of [1, 2] as const) {
        const run = encounter(stage, 0, version);
        for (const value of [enemyHealthAt(stage, version), enemyForRun(run).hp, enemyForRun(run).attack, enemyIncoming({ ...run, turn: 2 })]) {
          expect(Number.isSafeInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
        }
      }
    }
  });

  it('depends only on encounter versions, regardless of the player build', () => {
    const run = startRun(newSave(), 'fuse', 103).run!;
    run.stage = 144; const enemy = enemyForRun(run);
    run.inventory = ['wick', 'trinity']; run.relicLevels = { wick: 10, trinity: 10 };
    run.spellLevel = 50_000; run.hp = run.maxHp = 1_000_000; run.stats.bestChain = 500_000;
    expect(enemyForRun(run)).toEqual(enemy);
  });

  it('preserves the version-one recorded counterfactuals', () => {
    // Fixed recorded casts isolate the curve change; this is not a board replay.
    const first = encounter(79, 0, 1), shield = 18;
    const firstCounter = enemyIncoming(first) - shield, secondCounter = enemyIncoming({ ...first, turn: 1 }) - shield;
    const afterSecondCounter = 870 - firstCounter + 40 - secondCounter;
    expect(enemyForRun(first).hp - 4_251_916 - 9_262_724).toBe(102_219);
    expect(afterSecondCounter).toBe(132);
    expect(afterSecondCounter + 11 * 10).toBe(242);
    const second = encounter(144, 0, 1), afterFirst = 3280 - (enemyIncoming(second) - shield) + 90;
    expect(afterFirst).toBe(2591);
    expect(39_437_863 + 37_245_633).toBeGreaterThan(enemyForRun(second).hp);
    expect(3280 - [0, 1, 2].reduce((sum, turn) => sum + enemyIncoming({ ...second, turn }) - shield, 0)).toBeGreaterThan(0);
  });

  it('keeps one recovery chance at wave 80 but restores a damage and defense check at wave 145', () => {
    // Fixed recorded casts isolate the curve change; board/item replay is separate.
    const first = encounter(79), shield = 18;
    const afterSecondCounter = 870 - (enemyIncoming(first) - shield) + 40 - (enemyIncoming({ ...first, turn: 1 }) - shield);
    expect(afterSecondCounter).toBeGreaterThan(0);
    expect(afterSecondCounter + 11 * 10).toBe(112);
    const second = encounter(144);
    expect(39_437_863 + 37_245_633).toBeLessThan(enemyForRun(second).hp);
    expect(3280 - [0, 1].reduce((sum, turn) => sum + enemyIncoming({ ...second, turn }) - shield, 0)).toBeGreaterThan(0);
    expect(3280 - [0, 1, 2].reduce((sum, turn) => sum + enemyIncoming({ ...second, turn }) - shield, 0)).toBeLessThan(0);
  });
});

describe('endgame save boundaries', () => {
  it.each([undefined, 1] as const)('leaves a version-%s damaged old boss and its random state exact across loading', version => {
    const save = startRun(newSave(), 'fuse', 103), run = save.run!;
    if (version === undefined) delete run.endgameBalanceVersion; else run.endgameBalanceVersion = version;
    delete run.rescueItems; delete run.rescueMilestones;
    run.stage = 144; run.stats.kills = 144; run.turn = 1; run.enemyHp = enemyHealthAt(144, version) - 1234;
    const loaded = parseSave(JSON.stringify(save));
    expect(loaded).toEqual(save);
    expect(enemyIncoming(loaded.run!)).toBe(version === 1 ? 797 : enemyOf(144).attack);
    expect(enemyForRun(loaded.run!).hp).toBe(enemyHealthAt(144, version));
    expect(parseSave(JSON.stringify(loaded))).toEqual(loaded);
  });

  it.each([undefined, 1] as const)('finishes version-%s two-step boss rewards before adopting new curves at the next encounter', version => {
    let save = startRun(newSave(), 'fuse', 103), run = save.run!;
    if (version === undefined) delete run.endgameBalanceVersion; else run.endgameBalanceVersion = version;
    delete run.rescueItems; delete run.rescueMilestones;
    run.stage = 144; run.stats.kills = 144; run.enemyHp = 1;
    save = dispatch(save, { type: 'play', cell: singles(run.cells)[0], skill: false, revision: run.revision });
    const sampled = parseSave(JSON.stringify(save)), pending = [...sampled.run!.pendingRelicRewards!];
    expect(sampled.run!.endgameBalanceVersion).toBe(version);
    expect(sampled.run!.rewardStep).toBe('skill');
    save = dispatch(sampled, { type: 'reward', relic: sampled.run!.rewards[0], revision: sampled.run!.revision });
    expect(save.run!.stage).toBe(144); expect(save.run!.endgameBalanceVersion).toBe(version);
    expect(save.run!.rewards).toEqual(pending);
    save = dispatch(parseSave(JSON.stringify(save)), { type: 'reward', relic: pending[0], revision: save.run!.revision });
    expect(save.run!).toMatchObject({ stage: 145, endgameBalanceVersion: 2, phase: 'battle' });
    expect(save.run!.enemyHp).toBe(enemyHealthAt(145, 2));
    expect(enemyForRun(save.run!).attack).toBe(1052);
    expect(parseSave(JSON.stringify(save))).toEqual(save);
  });

  it('uses the opted-in boss bound and rejects invalid new versions', () => {
    const save = startRun(newSave(), 'fuse', 103), run = save.run!;
    run.stage = 144; run.stats.kills = 144; run.enemyHp = enemyHealthAt(144, 2);
    expect(parseSave(JSON.stringify(save))).toEqual(save);
    run.enemyHp++;
    expect(() => parseSave(JSON.stringify(save))).toThrow();
    for (const value of [0, -1, 3, '1', null]) {
      const invalid = startRun(newSave(), 'fuse', 103) as any;
      invalid.run.endgameBalanceVersion = value;
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
  });
});
