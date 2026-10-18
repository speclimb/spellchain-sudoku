import { describe, expect, it } from 'vitest';
import { dispatch, legalOrigins, newSave, resolveAction, startRun } from '../src/game/engine';
import { FUSIONS, applyFusion, availableFusions, canFuse, fusionForRelic, relicInventoryEntries } from '../src/game/fusions';
import { relicNextDescription, relicValues } from '../src/game/growth';
import { prepareRelicReward } from '../src/game/relic-slots';
import { applyGrowthReward, canTakeReward } from '../src/game/rewards';
import { parseSave } from '../src/game/storage';
import { recordHistory } from '../src/game/history';
import type { FusionId, RelicId, Run } from '../src/game/types';

function fixture(id: FusionId = 'eternal-flame') {
  const save = startRun(newSave(), 'fuse', 730);
  const run = save.run!;
  delete run.progressionVersion; // Retain the original Lv.10 and late +2 campaign rules.
  run.mode = 'campaign'; run.campaignVersion = 1;
  run.stage = 4; run.phase = 'reward'; run.rewardStep = 'relic';
  run.enemyHp = 0; run.cells = [...run.solution]; run.stats.kills = 5;
  run.rewards = ['training', 'vitality', 'recovery']; run.pendingRelicRewards = [];
  run.lastReport = null;
  run.inventory = [...FUSIONS.find(fusion => fusion.id === id)!.components];
  for (const relic of run.inventory) { run.relicLevels![relic] = 10; run.tier[relic] = 3; run.acquisitionRank[relic] = ['trinity', 'duality', 'quint', 'sept'].includes(relic) ? 3 : 1; }
  return save;
}

describe('boss relic fusion', () => {
  it.each(FUSIONS.map(fusion => [fusion.id, fusion.name] as const))('%s creates %s without freeing component slots or rerolling rewards', id => {
    const save = fixture(id), run = save.run!, before = structuredClone(run);
    expect(availableFusions(run).map(fusion => fusion.id)).toContain(id);
    applyFusion(run, id);
    expect(run.inventory).toEqual(before.inventory);
    expect(run.rewards).toEqual(before.rewards);
    expect(run.randomState).toBe(before.randomState);
    expect(run.relicLevels).toEqual(before.relicLevels);
    expect(relicInventoryEntries(run)).toHaveLength(1);
    expect(relicInventoryEntries(run)[0].slots).toBe(2);
    expect(run.inventory.some(relic => JSON.stringify(relicValues(run, relic)) !== JSON.stringify(relicValues(before, relic)))).toBe(true);
    expect(parseSave(JSON.stringify(save)).run!.fusions).toEqual([id]);
    expect(() => applyFusion(run, id)).toThrow();
    expect(run.inventory.every(relic => !canTakeReward(run, relic))).toBe(true);
  });

  it('requires a boss relic reward, two fully grown apex ingredients, and unused materials', () => {
    const run = fixture().run!;
    const invalid: Partial<Run>[] = [{ phase: 'battle' }, { rewardStep: 'skill' }, { stage: 5 }, { balanceVersion: 1 }, { lastFusionStage: 4 }, { inventory: ['wick'] }, { relicLevels: { wick: 10, rekindle: 9 } }, { tier: { wick: 3, rekindle: 2 } }];
    for (const changes of invalid) expect(canFuse({ ...run, ...changes }, 'eternal-flame')).toBe(false);
    const original = structuredClone(run);
    expect(() => applyFusion(run, 'unknown' as FusionId)).toThrow();
    expect(run).toEqual(original);
    const pair = fixture('twin-covenant').run!;
    pair.inventory.push('quint'); pair.relicLevels!.quint = 10; pair.tier.quint = 3;
    applyFusion(pair, 'twin-covenant');
    pair.stage = 9;
    expect(canFuse(pair, 'fate-crown')).toBe(false);
  });

  it.each(FUSIONS.map(fusion => fusion.id))('persists %s through the committed reducer and its next real cast', id => {
    const save = fixture(id), source = save.run!, action = { type: 'fuse' as const, fusion: id, revision: source.revision };
    const fused = resolveAction(source, action);
    expect(source.fusions).toBeUndefined();
    expect(fused.revision).toBe(source.revision + 1);
    expect(() => resolveAction(fused, action)).toThrow();
    expect(() => resolveAction(fused, { ...action, revision: fused.revision })).toThrow();
    const battle = resolveAction(fused, { type: 'reward', relic: 'training', revision: fused.revision });
    save.run = resolveAction(battle, { type: 'play', cell: legalOrigins(battle)[0], skill: false, revision: battle.revision });
    expect(parseSave(JSON.stringify(save)).run!.fusions).toEqual([id]);
  });

  it('retiring one visible fused item retires both ingredients, and recovering them requires a new fusion', () => {
    const run = fixture().run!;
    const extra: RelicId[] = ['pen', 'ward', 'stroke', 'battery', 'amplifier', 'afterglow'];
    for (const relic of extra) { run.inventory.push(relic); run.relicLevels![relic] = 1; run.acquisitionRank[relic] = 1; }
    applyFusion(run, 'eternal-flame');
    expect(run.inventory).toHaveLength(8);
    prepareRelicReward(run, 'gold', 'rekindle');
    expect(run.inventory).toHaveLength(6);
    expect(run.fusions).toEqual([]);
    expect(run.stowedRelics!.wick).toEqual({ level: 10, tier: 3, rank: 1 });
    expect(run.stowedRelics!.rekindle).toEqual({ level: 10, tier: 3, rank: 1 });
    applyGrowthReward(run, 'wick'); applyGrowthReward(run, 'rekindle');
    expect(run.inventory).toHaveLength(8);
    expect(fusionForRelic(run, 'wick')).toBeUndefined();
    expect(canFuse(run, 'eternal-flame')).toBe(false);
    run.stage = 9;
    expect(canFuse(run, 'eternal-flame')).toBe(true);
  });

  it('rejects corrupted fusion groups and stage stamps on reload', () => {
    const save = fixture('twin-covenant'); applyFusion(save.run!, 'twin-covenant');
    for (const mutate of [
      (run: Run) => { run.fusions = ['twin-covenant', 'twin-covenant']; },
      (run: Run) => { run.fusions = ['unknown' as FusionId]; },
      (run: Run) => { run.fusions!.push('fate-crown'); },
      (run: Run) => { run.inventory.pop(); },
      (run: Run) => { run.relicLevels!.trinity = 9; },
      (run: Run) => { delete run.lastFusionStage; },
      (run: Run) => { run.lastFusionStage = 3; },
      (run: Run) => { run.lastFusionStage = 9; },
    ]) {
      const broken = structuredClone(save); mutate(broken.run!);
      expect(() => parseSave(JSON.stringify(broken))).toThrow();
    }
  });

  it('accelerates owned campaign growth after battle 20 while preserving endless growth', () => {
    const run = fixture().run!; run.stage = 19; run.relicLevels!.wick = 7;
    expect(relicNextDescription(run, 'wick')).toContain('Lv.9');
    applyGrowthReward(run, 'wick'); expect(run.relicLevels!.wick).toBe(9);
    applyGrowthReward(run, 'wick'); expect(run.relicLevels!.wick).toBe(10);
    delete run.campaignVersion; run.mode = 'endless'; run.relicLevels!.wick = 7;
    applyGrowthReward(run, 'wick'); expect(run.relicLevels!.wick).toBe(8);
  });

  it('retains boss skill, bonus fusion, ordinary reward and fused healing in persisted history', () => {
    let save = fixture('world-script');
    const run = save.run!;
    run.phase = 'battle'; run.rewardStep = undefined; run.rewards = []; run.stats.kills = 4;
    run.cells = run.cells.map((value, cell) => run.givens[cell] ? value : 0); run.enemyHp = 1;
    save = dispatch(save, { type: 'play', cell: legalOrigins(run)[0], skill: false, revision: run.revision });
    expect(save.run!.rewardStep).toBe('skill');
    save = dispatch(save, { type: 'reward', relic: save.run!.rewards[0], revision: save.run!.revision });
    const beforeFusion = save.run!, fusionAction = { type: 'fuse' as const, fusion: 'world-script' as const, revision: beforeFusion.revision };
    save = dispatch(save, fusionAction);
    recordHistory(save, beforeFusion, fusionAction);
    expect(save.history!.runs.at(-1)!.battles.find(battle => battle.stage === 4)!.rewards).toHaveLength(2);
    let restored = parseSave(JSON.stringify(save));
    expect(restored.history).toEqual(save.history);
    expect(restored.history!.runs.at(-1)!.build!.relics.every(relic => relic.name.startsWith('創世の万年筆 / '))).toBe(true);
    restored.run!.rewards = ['training', 'vitality', 'recovery'];
    save = dispatch(restored, { type: 'reward', relic: 'training', revision: restored.run!.revision });
    const rewards = save.history!.runs.at(-1)!.battles.find(battle => battle.stage === 4)!.rewards;
    expect(rewards.map(reward => reward.step)).toEqual(['skill', 'fusion', 'relic']);
    expect(rewards[1]).toMatchObject({ id: 'fusion:world-script', name: '創世の万年筆' });
    expect(parseSave(JSON.stringify(save)).history).toEqual(save.history);
    const battle = save.run!, root = battle.givens.findIndex(given => !given);
    battle.cells = [...battle.solution]; battle.cells[root] = 0;
    battle.hp = battle.maxHp - 30;
    save = dispatch(save, { type: 'play', cell: root, skill: false, revision: battle.revision });
    expect(save.run!.lastReport!.relicHealed).toBe(21);
    expect(parseSave(JSON.stringify(save)).history).toEqual(save.history);
  });
});
