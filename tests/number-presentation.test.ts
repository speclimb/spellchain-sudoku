import { describe, expect, it } from 'vitest';
import { formatEffectText, formatNumber, numberText, percentText } from '../src/format-number';
import { RELICS } from '../src/game/content';
import { newSave, startRun } from '../src/game/engine';
import { relicGrowthDescription, relicValues, SKILLS, skillDescriptionFor } from '../src/game/growth';
import type { Preview } from '../src/game/types';
import { catalogRelicDescription, catalogRelicState } from '../src/ui/relic-codex';
import { accessiblePrediction, damageBreakdown, procEffect, rangeText } from '../src/ui/report-presentation';

describe('display-only numeric formatting', () => {
  it('removes floating-point tails and unnecessary zeros, preserving useful hundredths', () => {
    expect(numberText(1.6400000000000001)).toBe('1.64');
    expect(numberText(2)).toBe('2');
    expect(numberText(2.5)).toBe('2.5');
    expect(numberText(1.807)).toBe('1.81');
    expect(numberText(1.005)).toBe('1.01');
    expect(numberText(-0.001)).toBe('0');
    expect(formatNumber(1234567.8999999999)).toBe('1,234,567.9');
    expect(percentText(0.7300000000000001)).toBe('73');
    expect(percentText(0.31625)).toBe('31.63');
    expect(rangeText(1.6400000000000001, 2.1299999999999999)).toBe('1.64〜2.13');
  });

  it('formats the screenshot multiplier in prediction and confirmed/history proc descriptions', () => {
    const value = 1.6400000000000001;
    const effect = procEffect('trinity', value);
    expect(effect).toBe('通常攻撃 ×1.64（シート完成加算・スキル追加攻撃は対象外）');
    const report = { path: [], baseDamage: 100, damage: 100, received: 0, healed: 0,
      forecast: { chance: .73, multiplier: value, damageMax: 164, receivedMin: 0, receivedMax: 0, healedMin: 0, healedMax: 0 } } as unknown as Preview;
    const before = structuredClone(report);
    expect(damageBreakdown(report, true)).toContainEqual({ label: '三の護符（73%）', value: '発動時 ×1.64' });
    report.forecast!.procs = [{ id: 'trinity', chance: .73, value }];
    expect(accessiblePrediction(report)).toContain(effect);
    expect(damageBreakdown(report, true)).toContainEqual({ label: '三の護符（73%）', value: effect });
    delete report.forecast!.procs;
    expect(report).toEqual(before);
    const confirmed = { ...report, proc: { triggered: true, multiplier: value } } as Preview;
    expect(damageBreakdown(confirmed)).toContainEqual({ label: '三の護符 · 発動', value: '×1.64' });
    expect(confirmed.proc!.multiplier).toBe(value);
  });

  it('renders every growth description with at most two decimals without mutating raw effect values', () => {
    for (const { id } of RELICS) for (const tier of [1, 2, 3]) for (let level = 1; level <= 10; level++) {
      const state = catalogRelicState(id, level, tier), before = structuredClone(state), raw = relicValues(state, id);
      expect(catalogRelicDescription(id, level, tier)).not.toMatch(/\d+\.\d{3}/);
      expect(relicGrowthDescription(state, id)).not.toMatch(/\d+\.\d{3}/);
      expect(state).toEqual(before);
      expect(relicValues(state, id)).toEqual(raw);
    }
    const state = catalogRelicState('amplifier', 10, 3);
    expect(relicValues(state, 'amplifier').skillMultiplier).toBe(1.35 + .31 * .7 + 2 * .12);
    expect(catalogRelicDescription('amplifier', 10, 3)).toContain('80.7％');
    expect(catalogRelicDescription('amplifier', 10, 3)).toContain('1.81倍相当');
    const run = startRun(newSave(), 'fuse', 51).run!;
    for (const { id } of SKILLS) for (let level = 1; level <= 10; level++) {
      run.skillLevels = { [id]: level };
      expect(skillDescriptionFor(run, id)).not.toMatch(/\d+\.\d{3}/);
    }
  });

  it('cleans frozen effect strings only when displaying them and preserves historical wording', () => {
    const archived = { description: '旧効果：通常攻撃 ×1.6400000000000001。得点1.807倍、反撃31.625％軽減。Lv.10、123456点。' };
    const original = JSON.stringify(archived);
    expect(formatEffectText(archived.description)).toBe('旧効果：通常攻撃 ×1.64。得点1.81倍、反撃31.63％軽減。Lv.10、123456点。');
    expect(JSON.stringify(archived)).toBe(original);
  });
});
