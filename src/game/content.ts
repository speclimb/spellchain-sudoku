import type { CharacterId, GreaterRelicId, RelicId, RepeatableRewardId, RewardId, Run, SkillId } from './types';
import { relicGrowthDescription, relicLevel, relicTierLevel, relicValues, skillDescriptionFor, skillLevel, skillOf, type SkillRun, type RelicRun } from './growth';
export interface Character { id: CharacterId; name: string; symbol: string; title: string; passive: string; skill: string; skillName: string; unlock: number; affinity: RelicId[] }
export const CHARACTERS: Character[] = [
  { id: 'fuse', name: '導火術師', symbol: '✦', title: '連鎖をつなぐ者', passive: '連鎖詠唱数＋1', skillName: '星火連環', skill: '任意の空きマスから始動。この手の連鎖詠唱数をさらに＋4。', unlock: 0, affinity: ['wick', 'echo', 'rekindle', 'lens'] },
  { id: 'scribe', name: '紋章術師', symbol: '◇', title: '完成を力に変える者', passive: '完成ダメージ＋10／単位', skillName: '大紋章の詠唱', skill: '任意の空きマスから始動。この手の完成ダメージを3倍。', unlock: 3, affinity: ['pen', 'ward', 'rekindle', 'stroke'] },
  { id: 'lumen', name: '蓄光術師', symbol: '☾', title: '魔力を解き放つ者', passive: '通常詠唱で得る魔力＋1', skillName: '月光解放', skill: '任意の空きマスから始動。この詠唱の通常攻撃ダメージを2倍。', unlock: 12, affinity: ['battery', 'amplifier', 'afterglow', 'stroke'] },
];
export const primeIds: RelicId[] = ['duality', 'trinity', 'quint', 'sept'];
export const greaterIds: GreaterRelicId[] = ['stroke', 'trinity', 'duality', 'quint', 'sept', 'lens', 'wick'];
export interface Relic { id: RelicId; name: string; symbol: string; kind: string; description: string; unlock: number }
const relicDefinitions: Omit<Relic, 'description'>[] = [
  { id: 'wick', name: '長い導火線', symbol: '〰', kind: '連鎖', unlock: 0 },
  { id: 'echo', name: '共鳴石', symbol: '◈', kind: '連鎖', unlock: 0 },
  { id: 'rekindle', name: '再燃の輪', symbol: '◎', kind: '連鎖', unlock: 0 },
  { id: 'pen', name: '刻印のペン', symbol: '✒', kind: '完成', unlock: 0 },
  { id: 'ward', name: '守護の紋章', symbol: '⬡', kind: '守護', unlock: 0 },
  { id: 'stroke', name: '一筆の杖', symbol: 'Ⅰ', kind: '技巧', unlock: 0 },
  { id: 'battery', name: '蓄電石', symbol: '⋈', kind: '魔力', unlock: 0 },
  { id: 'amplifier', name: '魔力増幅器', symbol: '✵', kind: '魔力', unlock: 0 },
  { id: 'afterglow', name: '残光の灯', symbol: '☼', kind: '魔力', unlock: 0 },
  { id: 'lens', name: '弱点のレンズ', symbol: '⌖', kind: '技巧', unlock: 0 },
  { id: 'glass', name: '硝子の杖', symbol: '⟡', kind: '代償', unlock: 0 },
  { id: 'trinity', name: '三の護符', symbol: 'Ⅲ', kind: '確率', unlock: 0 },
  { id: 'duality', name: '二の護符', symbol: 'Ⅱ', kind: '確率', unlock: 0 },
  { id: 'quint', name: '五の護符', symbol: 'Ⅴ', kind: '確率', unlock: 0 },
  { id: 'sept', name: '七の護符', symbol: 'Ⅶ', kind: '確率', unlock: 0 },
  { id: 'gold', name: '黄金のインク', symbol: '✧', kind: '回復・得点', unlock: 0 },
];
/** Catalog entries describe a new Lv.1 relic using the live effect calculator. */
function initialRelic(id: RelicId): RelicRun {
  return { inventory: [id], acquisitionRank: {}, tier: {}, expansionVersion: 1, relicBalanceVersion: 1, relicLevels: { [id]: 1 } };
}
export const RELICS: Relic[] = relicDefinitions.map(relic => ({ ...relic, description: relicGrowthDescription(initialRelic(relic.id), relic.id) }));

export const ENEMIES = [
  { name: '迷い火の精', title: 'THE WANDERING EMBER', hp: 1400, attack: 3, symbol: 'ember', lore: '一枚の魔法陣では消えない灯り。詠唱をつないで育てよう。' },
  { name: '書架の使い魔', title: 'THE ARCHIVE FAMILIAR', hp: 2200, attack: 3, symbol: 'wing', lore: '眠っていた数字が、羽音に目を覚ます。' },
  { name: '紋章の番人', title: 'THE SIGIL KEEPER', hp: 3200, attack: 4, symbol: 'guardian', lore: '三度目の詠唱に、番人は力を解き放つ。' },
  { name: '夜を読む眼', title: 'THE MIDNIGHT ORACLE', hp: 4600, attack: 4, symbol: 'eye', lore: 'その瞳は、まだ描かれていない連鎖を見ている。' },
  { name: '星喰いの影', title: 'THE STAR DEVOURER', hp: 6500, attack: 5, symbol: 'star', lore: '集めた遺物と育った詠唱が、闇の中で共鳴する。' },
  { name: '零の古竜', title: 'THE DRAGON OF ZERO', hp: 9000, attack: 6, symbol: 'dragon', lore: '幾重もの魔法陣を越えて、あなたの詠唱を夜空に刻め。' },
];
/** Keep old encounters on their original balance until their already-rolled reward is taken. */
export function enemyOf(stage: number, balanceVersion: 1 | 2 = 2) {
  if (balanceVersion === 1) {
    const archetypeIndex = stage % ENEMIES.length, archetype = ENEMIES[archetypeIndex];
    const depth = Math.max(0, stage - 5);
    return {
      ...archetype, archetypeIndex, encounter: stage + 1, cycle: Math.floor(stage / ENEMIES.length) + 1,
      isBoss: archetypeIndex === 5,
      hp: depth ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(ENEMIES[5].hp * 1.5 ** depth)) : archetype.hp,
      attack: depth ? Math.min(Number.MAX_SAFE_INTEGER, 6 + depth * 2 + depth * depth) : archetype.attack,
      strongEvery: archetypeIndex === 2 || archetypeIndex === 5 ? 3 : 0,
    };
  }
  // Four ordinary encounters lead into a milestone boss. Boss artwork alternates,
  // while the HP curve stays smooth so no random relic proc is needed to progress.
  const encounter = stage + 1, cycle = Math.floor(stage / 5) + 1, isBoss = encounter % 5 === 0;
  const archetypeIndex = isBoss ? (cycle % 2 ? 4 : 5) : stage % 5;
  const archetype = ENEMIES[archetypeIndex];
  const depth = Math.max(0, encounter - 5), lateDepth = Math.max(0, depth - 10);
  return {
    ...archetype, archetypeIndex, encounter, cycle, isBoss,
    hp: stage < 4 ? archetype.hp : Math.min(Number.MAX_SAFE_INTEGER, Math.round(6500 + 1300 * depth + 150 * depth ** 2 + 100 * lateDepth ** 2)),
    attack: stage < 4 ? archetype.attack : Math.min(Number.MAX_SAFE_INTEGER, 5 + Math.floor(depth / 2) + Math.floor(Math.max(0, depth - 5) ** 2 / 8)),
    strongEvery: isBoss || archetypeIndex === 2 ? 3 : 0,
  };
}
export const REPEATABLE_REWARDS: { id: RepeatableRewardId; name: string; symbol: string; kind: string; description: string }[] = [
  { id: 'training', name: '術式の鍛錬', symbol: '✦', kind: '鍛錬', description: '術式レベル＋1。攻撃倍率＋0.2・連鎖詠唱数＋1・最大HP＋4、HPを10回復。何度でも選べる。' },
  { id: 'vitality', name: '生命の器', symbol: '♡', kind: '成長', description: '最大HP＋12、HPを12回復。何度でも選べる。' },
  { id: 'magic-boon', name: '魔力の祝福', symbol: '✵', kind: '祝福', description: 'これから5戦、戦闘開始時に魔力を8へ。蓄電の超過分はそのまま。同じ祝福は重ならず、再取得で残り5戦へ更新。' },
  { id: 'defense-boon', name: '守護の祝福', symbol: '⬡', kind: '祝福', description: 'これから5戦、守護を引いた後の反撃を25％軽減。二の護符と合計で最大60％。同じ祝福は重ならず、再取得で残り5戦へ更新。' },
  { id: 'recovery', name: '癒しの泉', symbol: '✚', kind: '回復', description: 'HPを全回復。何度でも選べる。' },
];
export const characterOf = (id: CharacterId) => CHARACTERS.find(c => c.id === id)!;
export const relicOf = (id: RelicId) => RELICS.find(r => r.id === id)!;
/** Owned items use their actual saved effects; catalog entries use current Lv.1 values. */
export function relicDescription(id: RelicId, run?: Run): string {
  if (!run) return relicOf(id).description;
  return relicGrowthDescription({ ...run, inventory: run.inventory.includes(id) ? run.inventory : [...run.inventory, id] }, id);
}
export function skillDescription(run: SkillRun): string {
  return skillDescriptionFor(run, run.character);
}
/** Preview the selected relic, including archived growth and the next battle's rules. */
function relicRewardState(run: Run, id: RewardId): { next: Run; relicId: RelicId } {
  const greater = id.startsWith('greater:'), apex = id.startsWith('apex:');
  const relicId = (greater ? id.slice(8) : apex ? id.slice(5) : id) as RelicId;
  const next = structuredClone(run), before = relicLevel(run, relicId);
  const archived = !before ? run.stowedRelics?.[relicId] : undefined;
  const tier = archived?.tier ?? relicTierLevel(run, relicId);
  if (!before) {
    next.inventory.push(relicId);
    next.acquisitionRank[relicId] = archived?.rank ?? 1;
    next.relicLevels = { ...next.relicLevels, [relicId]: archived?.level ?? 1 };
    if (archived) next.tier[relicId] = archived.tier;
  } else if (!greater && !apex) {
    if (run.expansionVersion && run.rewardStep !== 'legacy') next.relicLevels = { ...next.relicLevels, [relicId]: Math.min(10, before + 1) };
    if (primeIds.includes(relicId)) next.acquisitionRank[relicId] = Math.min(3, (run.acquisitionRank[relicId] ?? 1) + 1);
  }
  if (greater) next.tier[relicId] = Math.max(2, tier);
  if (apex) next.tier[relicId] = Math.min(3, tier + 1);
  if (run.rewardStep !== 'skill') next.relicBalanceVersion = 1;
  return { next, relicId };
}
export function rewardProgression(id: RewardId, run: Run): string {
  if (id.startsWith('skill:')) {
    const before = skillLevel(run, id.slice(6) as SkillId);
    return `${before ? `Lv.${before}` : '未習得'} → Lv.${Math.min(10, before + 1)}`;
  }
  if (id === 'skill-upgrade') return `${characterOf(run.character).skillName} · Lv.${skillLevel(run, run.character)} → Lv.${Math.max(2, skillLevel(run, run.character))}`;
  const baseId = id.replace(/^(greater:|apex:)/, '') as RelicId;
  if (!RELICS.some(relic => relic.id === baseId)) return '';
  const { next } = relicRewardState(run, id), before = relicLevel(run, baseId), after = relicLevel(next, baseId);
  const archived = !before ? run.stowedRelics?.[baseId] : undefined;
  const tier = (value: number) => ['通常', '上位', '極位'][value - 1];
  if (id.startsWith('greater:') || id.startsWith('apex:')) {
    const from = archived?.tier ?? (before ? relicTierLevel(run, baseId) : 0), to = relicTierLevel(next, baseId);
    return from === to ? `Lv.${after}・${tier(to)}で再取得` : `${from ? tier(from) : '未所持'} → ${tier(to)}`;
  }
  if (archived) return `Lv.${after}・${tier(relicTierLevel(next, baseId))}で再取得`;
  if (before && before === after && primeIds.includes(baseId)) {
    const percent = (value: number) => `${Number((value * 100).toFixed(3))}％`;
    return `発動率 ${percent(relicValues(run, baseId).chance)} → ${percent(relicValues(next, baseId).chance)}`;
  }
  return before ? `Lv.${before} → Lv.${after}` : `Lv.${after}・${tier(relicTierLevel(next, baseId))}`;
}
export function rewardOf(id: RewardId, run?: Run) {
  if (id.startsWith('skill:')) {
    const skillId = id.slice(6) as SkillId, skill = skillOf(skillId);
    const context: SkillRun = run ?? { character: 'fuse', skillRank: 1, expansionVersion: 1, skillLevels: {} };
    const before = run ? skillLevel(run, skillId) : 0, after = Math.min(10, before + 1);
    const next = { ...context, expansionVersion: 1 as const, skillLevels: { ...context.skillLevels, [skillId]: after } };
    return { ...skill, id, name: `${skill.name} ${before ? `Lv.${before}→${after}` : 'Lv.1を習得'}`, kind: after === 5 || after === 10 ? 'スキル進化' : before ? 'スキル強化' : '新しいスキル',
      description: `選択後：${skillDescriptionFor(next, skillId)}${run && !before && skillId !== run.character ? ` ${(run.equippedSkills?.length ?? 0) < 2 ? '空き枠へ自動装備。' : '追加装備2枠が満杯です。報酬画面で入れ替えられます。'}` : ''}` };
  }
  if (id === 'skill-upgrade') return {
    id, name: '固有スキル強化', symbol: '✦', kind: 'ボス報酬',
    description: run ? `選択後：${skillDescriptionFor({ ...run, skillRank: 2, skillLevels: { ...run.skillLevels, [run.character]: Math.max(2, skillLevel(run, run.character)) } }, run.character)}` : '固有スキルをLv.2へ強化。',
  };
  const greater = id.startsWith('greater:'), apex = id.startsWith('apex:');
  const relicId = (greater ? id.slice(8) : apex ? id.slice(5) : id) as RelicId;
  const relic = RELICS.find(r => r.id === relicId);
  if (relic) {
    if (!run) {
      const state = initialRelic(relicId); if (greater || apex) { state.tier[relicId] = greater ? 2 : 3; if (apex) state.relicLevels = { [relicId]: 5 }; }
      return { ...relic, id, name: `${greater ? '上位・' : apex ? '極位・' : ''}${relic.name}`, description: relicGrowthDescription(state, relicId) };
    }
    const { next } = relicRewardState(run, id), before = relicLevel(run, relicId), after = relicLevel(next, relicId);
    const archived = !before && run.stowedRelics?.[relicId];
    const evolution = greater || apex, tier = relicTierLevel(next, relicId);
    const legacyRankUp = !evolution && before && (!run.expansionVersion || run.rewardStep === 'legacy');
    return { ...relic, id,
      name: evolution ? `${tier === 3 ? '極位' : '上位'}・${relic.name}` : archived ? `${relic.name} Lv.${after}を再取得` : legacyRankUp ? `${relic.name}（発動率強化）` : `${relic.name} ${before ? `Lv.${before}→${after}` : `Lv.${after}`}`,
      kind: evolution ? '遺物進化' : archived ? '再取得' : before ? '遺物強化' : '新しい遺物',
      description: `選択後：${relicGrowthDescription(next, relicId)}${archived ? evolution && tier > archived.tier ? ' 保存した育成を復元し、段階を進化。' : ' 保存したレベル・段階・発動率で再取得。' : ''}` };
  }
  return REPEATABLE_REWARDS.find(r => r.id === id)!;
}
