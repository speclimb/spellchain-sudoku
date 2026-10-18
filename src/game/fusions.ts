import type { FusionId, RelicId, Run } from './types';

export interface FusionDefinition {
  id: FusionId; name: string; symbol: string; components: readonly [RelicId, RelicId]; description: string;
}
/** Ingredients retain their ordinary effects. These are additional, bounded bonuses. */
export const FUSIONS: readonly FusionDefinition[] = [
  { id: 'eternal-flame', name: '不滅の星炉', symbol: '♨', components: ['wick', 'rekindle'], description: '連鎖詠唱数をさらに＋6、最初の完成時の再燃をさらに＋6。' },
  { id: 'star-choir', name: '七星の共鳴環', symbol: '✺', components: ['echo', 'sept'], description: '同じ数字への飛び火をさらに＋2回・飛び火ダメージ＋16。七の護符の発動率＋10ポイント・予約連鎖＋12。' },
  { id: 'world-script', name: '創世の万年筆', symbol: '✒', components: ['pen', 'gold'], description: '完成ダメージをさらに＋65／単位。黄金のインクの回復＋8、得点倍率＋0.5。' },
  { id: 'sanctuary', name: '双月の聖域', symbol: '⬡', components: ['ward', 'duality'], description: '完成1単位の守護をさらに強化（通常＋4／エンドレス＋8）。二の護符の発動率＋15ポイント（軽減上限60％は共通）。' },
  { id: 'astral-engine', name: '星界の魔導機関', symbol: '✵', components: ['battery', 'amplifier'], description: '通常詠唱の魔力獲得をさらに＋3・蓄電上限＋2。スキル通常攻撃にさらに＋35％。' },
  { id: 'dawn-heart', name: '暁光の心臓', symbol: '☼', components: ['afterglow', 'quint'], description: '残光の連鎖をさらに＋10。五の護符の発動率＋15ポイント。' },
  { id: 'prism-spear', name: '万象を穿つ光槍', symbol: '⌖', components: ['lens', 'glass'], description: '弱点ダメージをさらに＋60、弱点起点ダメージ＋40。通常攻撃にさらに＋15％。硝子の最大HP−8は維持。' },
  { id: 'sevenfold-script', name: '七星一筆の天図', symbol: 'Ⅰ', components: ['stroke', 'sept'], description: '一筆の対象をさらに＋12マス、倍率＋0.35。七の護符の予約連鎖＋8。' },
  { id: 'twin-covenant', name: '三相守護の盟約', symbol: '◈', components: ['trinity', 'duality'], description: '二・三の護符の発動率をさらに＋10ポイント。三の護符の攻撃倍率＋0.2。' },
  { id: 'fate-crown', name: '運命を紡ぐ星冠', symbol: '♕', components: ['trinity', 'quint'], description: '三の護符の攻撃倍率をさらに＋0.25。五の護符の発動率＋15ポイント。' },
];
export const fusionOf = (id: FusionId): FusionDefinition => FUSIONS.find(fusion => fusion.id === id)!;
export const fusionLevelRequirement = (run: Partial<Pick<Run, 'mode' | 'progressionVersion'>>): number =>
  run.progressionVersion === 1 && run.mode === 'campaign' ? 8 : 10;
export type FusionRun = Pick<Run, 'inventory'> & Partial<Pick<Run, 'fusions'>>;
export function fusionForRelic(run: FusionRun, relic: RelicId): FusionDefinition | undefined {
  return FUSIONS.find(fusion => run.fusions?.includes(fusion.id) && fusion.components.includes(relic)
    && fusion.components.every(id => run.inventory.includes(id)));
}
export function canFuse(run: Run, id: FusionId): boolean {
  const fusion = FUSIONS.find(item => item.id === id);
  return !!fusion && run.expansionVersion === 1 && run.phase === 'reward' && run.rewardStep === 'relic'
    && run.balanceVersion === 2 && (run.stage + 1) % 5 === 0 && run.lastFusionStage !== run.stage
    && !run.fusions?.includes(id) && fusion.components.every(component => run.inventory.includes(component)
      && (run.relicLevels?.[component] ?? 0) >= fusionLevelRequirement(run) && run.tier[component] === 3 && !fusionForRelic(run, component));
}
export const availableFusions = (run: Run): FusionDefinition[] => FUSIONS.filter(fusion => canFuse(run, fusion.id));
/** Called only on the reducer's clone. No RNG and no reward-menu reroll. */
export function applyFusion(run: Run, id: FusionId): void {
  if (!canFuse(run, id)) throw new Error(`融合はボスの遺物報酬で1回。素材2個を極位・Lv.${fusionLevelRequirement(run)}以上まで育ててください。`);
  run.fusions = [...(run.fusions ?? []), id];
  run.lastFusionStage = run.stage;
  run.lastReport = null;
}
/** One visible entry per item, while inventory.length remains the slot cost. */
export function relicInventoryEntries(run: FusionRun): { relic: RelicId; fusion?: FusionDefinition; slots: number }[] {
  return run.inventory.flatMap(relic => {
    const fusion = fusionForRelic(run, relic);
    return fusion ? fusion.components[0] === relic ? [{ relic, fusion, slots: fusion.components.length }] : [] : [{ relic, slots: 1 }];
  });
}
