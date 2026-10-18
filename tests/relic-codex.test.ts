import { describe, expect, it } from 'vitest';
import { RELICS } from '../src/game/content';
import { relicGrowthDescription, relicValues } from '../src/game/growth';
import { applyGrowthReward } from '../src/game/rewards';
import { newSave, startRun } from '../src/game/engine';
import { catalogRelicDescription, catalogRelicState, relicCodex, relicGrowthRows } from '../src/ui/relic-codex';

describe('relic archive growth', () => {
  it('uses the live current-balance calculator at all 480 level/tier combinations', () => {
    for (const { id } of RELICS) for (const tier of [1, 2, 3]) for (let lv = 1; lv <= 10; lv++) {
      const state = catalogRelicState(id, lv, tier);
      expect(state.relicBalanceVersion).toBe(1);
      expect(catalogRelicDescription(id, lv, tier)).toContain(relicGrowthDescription(state, id));
      expect(catalogRelicDescription(id, lv, tier)).not.toMatch(/無料|旧効果|自動入力回数/);
      const value = relicValues(state, id);
      expect(value.level).toBe(lv); expect(value.tier).toBe(tier);
    }
  });
  it('matches real ordinary reward progression for every relic and evolution tier', () => {
    for (const { id } of RELICS) for (const tier of [1, 2, 3]) {
      const run = startRun(newSave(), 'fuse', 51).run!;
      run.rewardStep = 'relic';
      for (let lv = 1; lv <= 10; lv++) {
        expect(applyGrowthReward(run, id)).toBe(true);
        run.tier[id] = tier;
        expect(relicValues(catalogRelicState(id, lv, tier), id)).toEqual(relicValues(run, id));
      }
    }
  });
  it('shows acquisition-aware rates, additive multiplier equivalents and growth caps', () => {
    expect(catalogRelicDescription('trinity', 2, 1)).toContain('45％');
    expect(catalogRelicDescription('trinity', 3, 1)).toContain('60％');
    expect(catalogRelicDescription('trinity', 10, 3)).toContain('80％');
    expect(catalogRelicDescription('amplifier', 10, 3)).toContain('1.81倍相当');
    expect(catalogRelicDescription('glass', 10, 3)).toContain('1.48倍相当');
    expect(catalogRelicDescription('quint', 10, 3)).toContain('所持上限3枚');
    expect(catalogRelicDescription('duality', 10, 3)).toContain('合計上限60％');
    expect(catalogRelicDescription('battery', 10, 3)).toContain('4まで蓄え');
    expect(catalogRelicDescription('echo', 5, 1)).toContain('最大2回');
    expect(catalogRelicDescription('echo', 10, 1)).toContain('最大3回');
    expect(catalogRelicDescription('wick', 1, 2)).toContain('次のシートへ続く');
  });
  it('highlights only the owned level and tier without mutating a run or archived growth', () => {
    const run = startRun(newSave(), 'fuse', 51).run!;
    run.inventory = ['trinity']; run.relicLevels = { trinity: 6 }; run.tier = { trinity: 2 }; run.acquisitionRank = { trinity: 1 };
    run.stowedRelics = { echo: { level: 5, tier: 2, rank: 1 } };
    const before = structuredClone(run);
    expect(relicGrowthRows('trinity', 2, run).match(/class="current-level"/g)).toHaveLength(1);
    expect(relicGrowthRows('trinity', 1, run)).not.toContain('class="current-level"');
    expect(relicGrowthRows('echo', 2, run)).not.toContain('class="current-level"');
    expect(relicCodex(run)).toContain('所持中：上位 Lv.6');
    expect(relicCodex(run)).toContain('取得回数によって異なる');
    expect(relicCodex(run)).toContain(`所持中の実際の効果：${relicGrowthDescription(run, 'trinity')}`);
    expect(relicGrowthDescription(run, 'trinity')).toContain('43％');
    expect(relicGrowthRows('trinity', 2, run)).toContain('73％');
    expect(relicGrowthRows('trinity', 2, run)).toContain('所持中と同じLv・段階（参考）');
    expect(run).toEqual(before);
  });
  it('uses campaign values in both introductory cards and every reference level, while retaining endless defaults', () => {
    const run = startRun(newSave(), 'fuse', 51, 'campaign').run!;
    run.stage = 19;
    const before = structuredClone(run), html = relicCodex(run);
    expect(html).toContain('Lv.が1上昇（最大8）');
    expect(html).toContain('通常攻撃ダメージ＋15％');
    expect(html).toContain('反撃前にHP3回復');
    expect(relicCodex()).not.toContain('第20戦以降は2上昇');
    expect(catalogRelicDescription('glass', 1, 1)).not.toBe(catalogRelicDescription('glass', 1, 1, 1));
    for (const { id } of RELICS) for (const tier of [1, 2, 3]) {
      const rows = relicGrowthRows(id, tier, run);
      for (let lv = 1; lv <= 8; lv++) {
        const reference = catalogRelicState(id, lv, tier, 1, run);
        const actual = { ...run, inventory: [id], acquisitionRank: { [id]: Math.min(3, lv) }, tier: { [id]: tier }, relicLevels: { [id]: lv } };
        expect(relicValues(reference, id)).toEqual(relicValues(actual, id));
        expect(rows).toContain(catalogRelicDescription(id, lv, tier, 1));
      }
    }
    expect(run).toEqual(before);
  });
});
