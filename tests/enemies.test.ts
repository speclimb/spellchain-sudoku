import { describe, expect, it } from 'vitest';
import { enemyOf } from '../src/game/content';
import { applyEnemyArmor, enemyAt, enemyForRun, enemyIncoming, enemyIntent } from '../src/game/enemies';
import { ENEMY_ATTACK_ART, enemyAttackArt } from '../src/ui/enemy-attack-art';
import { enemyEmblem } from '../src/ui/enemy-art';

const encounter = (stage: number, turn = 0, enemyRulesVersion: 0 | 1 = 1) => ({ stage, turn, balanceVersion: 2 as const, enemyRulesVersion });

describe('versioned enemy identities and patterns', () => {
  it('preserves the opening four, every fifth boss and the established HP/attack curve', () => {
    expect([0, 1, 2, 3].map(stage => enemyAt(stage).symbol)).toEqual(['ember', 'wing', 'guardian', 'eye']);
    expect([4, 9, 14, 19].map(stage => enemyAt(stage).symbol)).toEqual(['star', 'dragon', 'star', 'dragon']);
    for (let stage = 0; stage < 200; stage++) {
      const enemy = enemyAt(stage), previous = enemyOf(stage);
      expect(enemy.hp).toBe(previous.hp); expect(enemy.attack).toBe(previous.attack);
      expect(enemy.isBoss).toBe((stage + 1) % 5 === 0);
    }
    expect(new Set(Array.from({ length: 20 }, (_, stage) => enemyAt(stage).symbol)).size).toBe(8);
    expect(enemyAt(5).symbol).toBe('frost'); expect(enemyAt(6).symbol).toBe('mirror');
  });
  it.each([1, 2] as const)('preserves every legacy identity and counter until rule opt-in on balance %i', balanceVersion => {
    for (let stage = 0; stage < 40; stage++) for (let turn = 0; turn < 6; turn++) {
      const run = { stage, turn, balanceVersion }, old = enemyOf(stage, balanceVersion);
      const enemy = enemyForRun(run);
      expect(enemy).toMatchObject({ name: old.name, hp: old.hp, attack: old.attack, strongEvery: old.strongEvery, symbol: old.symbol, armor: 0 });
      expect(enemyIncoming(run)).toBe(old.attack * (old.strongEvery && (turn + 1) % old.strongEvery === 0 ? 2 : 1));
      expect(enemyForRun({ ...run, enemyRulesVersion: 0 })).toEqual(enemy);
    }
  });
  it('alternates an explicit harmless charge with a doubled frost strike, without mutation', () => {
    const run = encounter(5), before = JSON.stringify(run), base = enemyForRun(run).attack;
    expect([0, 1, 2, 3, 4, 5].map(turn => enemyIncoming({ ...run, turn }))).toEqual([0, base * 2, 0, base * 2, 0, base * 2]);
    expect(enemyIntent(run)).toMatchObject({ incoming: 0, nextIncoming: base * 2, state: 'charge', style: 'frost' });
    expect(enemyIntent(run).warning).toContain(`攻撃${base * 2}`);
    expect(enemyIntent({ ...run, turn: 1 })).toMatchObject({ incoming: base * 2, nextIncoming: 0, state: 'heavy' });
    expect(JSON.stringify(run)).toBe(before);
  });
  it('uses third-turn heavy attacks for guardians and bosses, exact in every intent', () => {
    for (const stage of [2, 4, 9, 10, 14, 19]) {
      const run = encounter(stage), enemy = enemyForRun(run);
      if (enemy.pattern !== 'third-heavy') continue;
      expect([0, 1, 2, 3, 4, 5].map(turn => enemyIncoming({ ...run, turn }))).toEqual([enemy.attack, enemy.attack, 2 * enemy.attack, enemy.attack, enemy.attack, 2 * enemy.attack]);
    }
    for (let stage = 0; stage < 30; stage++) for (let turn = 0; turn < 6; turn++) {
      const run = encounter(stage, turn), intent = enemyIntent(run);
      expect(intent.incoming).toBe(enemyIncoming(run));
      expect(intent.nextIncoming).toBe(enemyIncoming({ ...run, turn: turn + 1 }));
      expect(intent.behavior).toBe(enemyForRun(run).behavior);
    }
  });
});

describe('mirror armor is local to one final cast damage calculation', () => {
  it('prevents one fifth rounded down, including bonus/proc totals passed to it', () => {
    const run = encounter(6);
    for (const damage of [0, 1, 4, 5, 99, 100, 101, 4273, Number.MAX_SAFE_INTEGER]) {
      const result = applyEnemyArmor(run, damage, 0);
      expect(result.prevented).toBe(Math.floor(damage / 5));
      expect(result.damage + result.prevented).toBe(damage);
      expect(result.broken).toBe(false);
    }
  });
  it('any completed row, column, or box fully breaks armor only for the current cast', () => {
    const run = encounter(6), before = JSON.stringify(run);
    for (const units of [1, 2, 3, 27, 54]) expect(applyEnemyArmor(run, 101, units)).toEqual({ damage: 101, prevented: 0, broken: true });
    expect(applyEnemyArmor(run, 101, 0)).toEqual({ damage: 81, prevented: 20, broken: false });
    expect(JSON.stringify(run)).toBe(before);
  });
  it('supports a pure bypass and leaves ordinary/legacy enemies untouched', () => {
    expect(applyEnemyArmor(encounter(6), 101, 0, true)).toEqual({ damage: 101, prevented: 0, broken: false });
    for (const run of [encounter(0), encounter(5), encounter(6, 0, 0)]) {
      expect(applyEnemyArmor(run, 101, 0)).toEqual({ damage: 101, prevented: 0, broken: false });
      expect(applyEnemyArmor(run, 101, 3)).toEqual({ damage: 101, prevented: 0, broken: false });
    }
  });
});

describe('distinct self-contained enemy art', () => {
  it('provides all eight attacks with unique silhouettes and no remote assets', () => {
    const enemies = [0, 1, 2, 3, 4, 9, 5, 6].map(stage => enemyAt(stage));
    expect(new Set(enemies.map(enemy => enemy.attackStyle)).size).toBe(8);
    expect(new Set(Object.values(ENEMY_ATTACK_ART)).size).toBe(8);
    for (const enemy of enemies) {
      expect(enemyAttackArt(enemy.attackStyle)).toContain(`data-attack-art="${enemy.attackStyle}"`);
      expect(enemyEmblem(enemy.symbol)).toContain(`data-enemy-art="${enemy.symbol}"`);
      expect(enemyAttackArt(enemy.attackStyle)).not.toMatch(/undefined|https?:|<script/);
    }
    expect(new Set(enemies.map(enemy => enemyEmblem(enemy.symbol))).size).toBe(8);
    expect(enemyEmblem('unknown')).toBe(enemyEmblem('ember'));
  });
});
