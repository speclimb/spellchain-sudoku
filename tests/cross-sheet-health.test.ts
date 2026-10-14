import { describe, expect, it } from 'vitest';
import { enemyOf } from '../src/game/content';
import { dispatch, newSave, startRun } from '../src/game/engine';
import { enemyAt, enemyForRun, enemyHealthAt, enemyIncoming } from '../src/game/enemies';
import { parseSave } from '../src/game/storage';
import { singles } from '../src/game/sudoku';
import type { Save } from '../src/game/types';

function lateSave(stage = 19): Save {
  const save = startRun(newSave(), 'fuse', 103), run = save.run!;
  run.stage = stage; run.stats.kills = stage; run.enemyHp = enemyOf(stage).hp;
  delete run.enemyHealthVersion;
  return save;
}

describe('fixed-wave separate ordinary and boss HP', () => {
  it('preserves the first fifteen encounters and every attack value', () => {
    for (let stage = 0; stage < 200; stage++) {
      const old = enemyAt(stage, 2, 1, 0), current = enemyAt(stage);
      expect(current.attack).toBe(old.attack);
      expect(current.pattern).toBe(old.pattern); expect(current.armor).toBe(old.armor);
      if (stage < 15) expect(current.hp).toBe(old.hp);
      else expect(current.hp).toBeGreaterThan(old.hp);
      for (let turn = 0; turn < 6; turn++) {
        const base = { stage, turn, balanceVersion: 2 as const, enemyRulesVersion: 1 as const };
        expect(enemyIncoming({ ...base, enemyHealthVersion: 1 })).toBe(enemyIncoming({ ...base, enemyHealthVersion: 0 }));
      }
    }
  });
  it('grows monotonically within each enemy category, with stronger milestone growth', () => {
    let normal = 0, boss = 0;
    for (let stage = 0; stage < 200; stage++) {
      const enemy = enemyAt(stage);
      if (enemy.isBoss) { expect(enemy.hp).toBeGreaterThan(boss); boss = enemy.hp; }
      else { expect(enemy.hp).toBeGreaterThan(normal); normal = enemy.hp; }
      if (enemy.isBoss && stage >= 19) {
        expect(enemy.hp / enemyOf(stage).hp).toBeGreaterThan(enemyHealthAt(stage - 1) / enemyOf(stage - 1).hp);
      }
    }
  });
  it('depends only on encounter and version, never on unlocks, player HP or damage growth', () => {
    const run = startRun(newSave(), 'fuse', 103).run!;
    run.stage = 44;
    const original = enemyForRun(run);
    run.inventory = ['wick', 'trinity']; run.tier.wick = 2;
    run.relicLevels = { wick: 10, trinity: 10 }; run.skillLevels = { fuse: 10 };
    run.spellLevel = 500; run.hp = run.maxHp = 50_000; run.stats.bestChain = 900;
    expect(enemyForRun(run)).toEqual(original);
    expect(enemyForRun({ ...run, enemyHealthVersion: 0 }).hp).toBe(enemyOf(44).hp);
    expect(enemyAt(44, 1, 0, 1)).toEqual(enemyAt(44, 1, 0, 0));
  });
  it('caps huge wave HP safely without a player-damage gate', () => {
    for (const stage of [999, 9999, 99999, 999999, Number.MAX_SAFE_INTEGER - 1]) {
      expect(Number.isSafeInteger(enemyHealthAt(stage))).toBe(true);
      expect(enemyHealthAt(stage)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      expect(enemyHealthAt(stage)).toBeGreaterThan(0);
    }
    expect(enemyHealthAt(999999)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('HP version save compatibility', () => {
  it('loads an old in-progress battle without changing its HP, board, resources or random stream', () => {
    const old = lateSave(), before = structuredClone(old);
    old.run!.enemyHp -= 1234;
    before.run!.enemyHp -= 1234;
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded).toEqual({ ...before, run: { ...before.run, enemyHealthVersion: 0 } });
    expect(enemyForRun(loaded.run!).hp).toBe(enemyOf(19).hp);
    expect(parseSave(JSON.stringify(loaded))).toEqual(loaded);
  });
  it('preserves a sampled two-step boss reward until final selection, then adopts current HP once', () => {
    let save = lateSave(); save.run!.enemyHp = 1;
    save = dispatch(save, { type: 'play', cell: singles(save.run!.cells)[0], skill: false, revision: save.run!.revision });
    const loaded = parseSave(JSON.stringify(save)), rewards = [...loaded.run!.rewards], pending = [...loaded.run!.pendingRelicRewards!];
    expect(loaded.run!.enemyHealthVersion).toBe(0); expect(loaded.run!.rewardStep).toBe('skill');
    const again = parseSave(JSON.stringify(loaded));
    expect(again.run!.rewards).toEqual(rewards); expect(again.run!.pendingRelicRewards).toEqual(pending);
    save = dispatch(again, { type: 'reward', relic: rewards[0], revision: again.run!.revision });
    expect(save.run!.stage).toBe(19); expect(save.run!.enemyHealthVersion).toBe(0);
    expect(save.run!.rewards).toEqual(pending);
    save = dispatch(parseSave(JSON.stringify(save)), { type: 'reward', relic: pending[0], revision: save.run!.revision });
    expect(save.run!.stage).toBe(20); expect(save.run!.enemyHealthVersion).toBe(1);
    expect(save.run!.enemyHp).toBe(enemyHealthAt(20));
    expect(parseSave(JSON.stringify(save))).toEqual(save);
  });
  it('uses the chosen version for exact HP bounds and rejects invalid versions', () => {
    const current = lateSave(44); current.run!.enemyHealthVersion = 1; current.run!.enemyHp = enemyHealthAt(44);
    expect(parseSave(JSON.stringify(current))).toEqual(current);
    current.run!.enemyHp++;
    expect(() => parseSave(JSON.stringify(current))).toThrow();
    const old = lateSave(44); old.run!.enemyHp = enemyHealthAt(44);
    expect(() => parseSave(JSON.stringify(old))).toThrow();
    for (const value of [-1, 2, '1', null]) {
      const invalid = lateSave() as any; invalid.run.enemyHealthVersion = value;
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
  });
  it('starts new adventures on the new fixed-wave version', () => {
    const save = startRun(newSave(), 'fuse', 103);
    expect(save.run!.enemyHealthVersion).toBe(1);
    expect(save.run!.enemyHp).toBe(enemyHealthAt(0));
    expect(parseSave(JSON.stringify(save))).toEqual(save);
  });
});
