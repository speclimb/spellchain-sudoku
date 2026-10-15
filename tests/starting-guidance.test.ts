import { describe, expect, it } from 'vitest';
import { dispatch, legalOrigins, longestOrigins, newSave, previewAction, startRun } from '../src/game/engine';
import { relicDescription, rewardOf } from '../src/game/content';
import { relicGrowthDescription, relicValues } from '../src/game/growth';
import { parseSave } from '../src/game/storage';
import { originView } from '../src/ui/board-view';

describe('standard longest-origin guidance', () => {
  it('shows all tied best legal origins without any relic from the first turn in both modes', () => {
    for (const character of ['fuse', 'scribe', 'lumen'] as const) {
      const save = newSave(); save.meta.clears = 99;
      const run = startRun(save, character, 51).run!; run.mana = 8;
      const before = structuredClone(run);
      for (const skill of [false, true]) {
        const lengths = legalOrigins(run, skill).map(cell => ({ cell, length: previewAction(run, cell, skill).path.length }));
        const length = Math.max(...lengths.map(entry => entry.length));
        const expected = { length, cells: lengths.filter(entry => entry.length === length).map(entry => entry.cell) };
        const view = originView(run, skill, false);
        expect(view.maximum).toEqual(expected); expect([...view.longest]).toEqual(expected.cells);
        expect(view.maximum).toEqual(longestOrigins(run, skill));
      }
      expect(run).toEqual(before);
      expect(originView(run, false, true).longest.size).toBe(0);
      expect(originView(run, false, true).legal.size).toBe(0);
      run.phase = 'reward'; expect(originView(run, false, false).longest.size).toBe(0);
    }
  });
});

describe('weakness lens tier damage', () => {
  it('scales weak and aimed-root damage independently while preserving versionless upper values', () => {
    const run = startRun(newSave(), 'fuse', 51).run!;
    expect(relicValues(run, 'lens').weakDamage).toBe(8);
    run.inventory = ['lens'];
    for (let lv = 1; lv <= 10; lv++) for (let tier = 1; tier <= 3; tier++) {
      run.relicLevels = { lens: lv }; run.tier.lens = tier;
      const damage = 16 + (lv - 1) * 2 + (tier - 1) * 4;
      expect(relicValues(run, 'lens').weakDamage).toBe(damage);
      expect(relicValues(run, 'lens').weakRootDamage).toBe(8 + Math.floor((lv - 1) / 2) + (tier - 1) * 4);
      expect(relicGrowthDescription(run, 'lens')).toContain(`追加ダメージ${damage}`);
      expect(relicGrowthDescription(run, 'lens')).not.toContain('★');
    }
    delete run.expansionVersion; delete run.relicBalanceVersion; run.tier.lens = 2;
    expect(relicValues(run, 'lens').weakDamage).toBe(32);
    expect(relicDescription('lens', run)).toContain('32');
    expect(rewardOf('greater:lens', run).description).toContain('32');
  });
  it('agrees across preview, actual damage, contribution and persisted history at every tier', () => {
    for (const tier of [1, 2, 3]) {
      const save = startRun(newSave(), 'fuse', 51), run = save.run!;
      run.inventory = ['lens']; run.relicLevels = { lens: 5 }; run.tier.lens = tier;
      const cell = legalOrigins(run).find(cell => previewAction(run, cell).path.some(event => run.marks[event.cell] === 'weak'))!;
      expect(cell).toBeDefined();
      const preview = previewAction(run, cell), without = structuredClone(run); without.inventory = [];
      const baseline = previewAction(without, cell);
      expect(preview.path).toEqual(baseline.path);
      expect(preview.damage).toBeGreaterThan(baseline.damage);
      expect(preview.ledger!.relics.lens!.damage).toBe(preview.damage - baseline.damage);
      const next = dispatch(save, { type: 'play', cell, skill: false, revision: run.revision });
      const report = next.run!.lastReport!, history = next.history!.runs[0].battles[0].casts[0];
      expect(report.damage).toBe(preview.damage);
      expect(history.relics.lens).toMatchObject({ level: 5, tier, metric: { damage: preview.damage - baseline.damage } });
      expect(history.damage).toBe(preview.damage);
      expect(parseSave(JSON.stringify(next))).toEqual(next);
    }
  });
});
