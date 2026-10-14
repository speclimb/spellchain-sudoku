import { describe, expect, it } from 'vitest';
import { newSave, startRun } from '../src/game/engine';
import { contributionReport, contributionSummary, effectRows } from '../src/ui/contribution-report';
import { damageBreakdown, percentText, procEffect } from '../src/ui/report-presentation';
import type { BattleLedger, EffectMetric, Report } from '../src/game/types';

const metric = (value: Partial<EffectMetric> = {}): EffectMetric => ({ heldCasts: 0, opportunities: 0, triggers: 0, damage: 0, addedInputs: 0, fuelGranted: 0, fuelUsed: 0, mana: 0, prevented: 0, tokensGranted: 0, tokensUsed: 0, score: 0, ...value });
const battle = (stage: number): BattleLedger => ({ stage, boss: stage === 4, casts: 2, damage: 120, hpDamage: 100, overkill: 20, score: 180, skills: { fuse: { uses: 1, damage: 70, hpDamage: 50, overkill: 20, level: stage + 1 } }, relics: { pen: metric({ heldCasts: 2, opportunities: 1, triggers: 1, damage: 30 }), sept: metric({ heldCasts: 2, opportunities: 1, fuelGranted: 7, fuelUsed: 3, addedInputs: 3 }) } });

describe('contribution report presentation', () => {
  it('aggregates only the latest five battles and independently filters the current boss', () => {
    const run = startRun(newSave(), 'fuse', 8).run!;
    run.stage = 4;
    run.contributions = { sinceCast: 0, partial: false, battles: Array.from({ length: 7 }, (_, i) => battle(i)) };
    const recent = contributionSummary(run);
    expect(recent.battles).toBe(5);
    expect(recent.damage).toBe(600);
    expect(recent.hpDamage).toBe(500);
    expect(recent.overkill).toBe(100);
    expect(recent.skills.fuse).toEqual({ uses: 5, damage: 350, hpDamage: 250, overkill: 100, level: 7 });
    expect(recent.relics.sept?.fuelGranted).toBe(35);
    const boss = contributionSummary(run, true);
    expect(boss.battles).toBe(1);
    expect(boss.casts).toBe(2);
    expect(boss.relics.pen?.damage).toBe(30);
  });
  it('keeps fuel, inputs, mana, prevention, coupons and score in separate units', () => {
    const rows = effectRows(metric({ damage: 80, fuelGranted: 14, fuelUsed: 4, addedInputs: 4, mana: 3, prevented: 9, tokensGranted: 2, tokensUsed: 1, score: 40 }));
    expect(rows).toEqual([
      { label: '同経路・発揮ダメージ差（超過含む）', value: '＋80' },
      { label: '自動入力の付与 / 使用', value: '14 / 4回' },
      { label: '無料で直接入力したマス', value: '4マス' },
      { label: '追加の魔力', value: '＋3' },
      { label: '防いだHPダメージ', value: '9' },
      { label: '無料券の獲得 / 使用', value: '2 / 1回' },
      { label: '追加スコア', value: '＋40' },
    ]);
  });
  it('does not imply reserved fuel directly filled cells', () => {
    expect(effectRows(metric({ fuelGranted: 14, fuelUsed: 3 }))).toEqual([{ label: '自動入力の付与 / 使用', value: '14 / 3回' }]);
  });
  it('explains overlap, small samples, unused skills and missing opportunities without ranking strength', () => {
    const run = startRun(newSave(), 'fuse', 3).run!;
    run.stage = 4; run.inventory = ['pen', 'sept', 'gold']; run.relicLevels = { pen: 2, sept: 1, gold: 1 };
    run.skillLevels = { fuse: 1, bridge: 2 }; run.equippedSkills = [];
    run.contributions = { sinceCast: 7, partial: true, battles: [battle(4)] };
    const html = contributionReport(run);
    expect(html).toContain('旧保存からの再開後のみ');
    expect(html).toContain('少数サンプル');
    expect(html).toContain('効果が重なるため足し合わせず');
    expect(html).toContain('この期間は未使用。弱いという意味ではありません。');
    expect(html).toContain('所持中 2詠唱 · 機会 1回 · 発動 1回');
    expect(html).toContain('この期間の所持中データはありません。');
    expect(html).toContain('次の成長');
    expect(html).toContain('1回あたりの平均');
    expect(html).toContain('効果と超過分を含み');
    expect(html).toContain('通算8詠唱目から');
    expect(html.match(/<li>/g)?.length).toBeLessThanOrEqual(3);
  });
  it('distinguishes extra attacks, armor, real HP, overkill and attack score', () => {
    const report = { baseDamage: 100, damage: 96, extraDamage: 20, armorPrevented: 24, attackScore: 144, ledger: { hpDamage: 80, overkill: 16, relics: {} } } as Report;
    const rows = damageBreakdown(report);
    expect(rows).toContainEqual({ label: 'スキルの追加攻撃', value: '＋20' });
    expect(rows).toContainEqual({ label: '敵の装甲による軽減', value: '−24' });
    expect(rows).toContainEqual({ label: '敵HPに与えた分', value: '80' });
    expect(rows).toContainEqual({ label: '超過ダメージ', value: '16' });
    expect(rows).toContainEqual({ label: '攻撃由来のスコア', value: '＋144' });
  });
});


it('preserves fractional high-level proc chances and reductions in visible labels', () => {
  expect(percentText(.755)).toBe('75.5');
  expect(percentText(.775)).toBe('77.5');
  expect(percentText(.6)).toBe('60');
  expect(procEffect('duality', .5125)).toContain('51.25%');
});
