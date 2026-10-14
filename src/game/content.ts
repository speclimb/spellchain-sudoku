import type { CharacterId, GreaterRelicId, RelicId, RepeatableRewardId, RewardId, Run, SkillId } from './types';
import { relicGrowthDescription, relicLevel, relicTierLevel, skillDescriptionFor, skillLevel, skillOf, type SkillRun } from './growth';
export interface Character { id: CharacterId; name: string; symbol: string; title: string; passive: string; skill: string; skillName: string; unlock: number; affinity: RelicId[] }
export const CHARACTERS: Character[] = [
  { id: 'fuse', name: '導火術師', symbol: '✦', title: '連鎖をつなぐ者', passive: '自動入力回数＋1', skillName: '星火連環', skill: '任意の空きマスから始動。この手の自動入力回数をさらに＋4。', unlock: 0, affinity: ['wick', 'echo', 'rekindle', 'lens'] },
  { id: 'scribe', name: '紋章術師', symbol: '◇', title: '完成を力に変える者', passive: '完成ダメージ＋10／単位', skillName: '大紋章の詠唱', skill: '任意の空きマスから始動。この手の完成ダメージを3倍。', unlock: 3, affinity: ['pen', 'ward', 'rekindle', 'stroke'] },
  { id: 'lumen', name: '蓄光術師', symbol: '☾', title: '魔力を解き放つ者', passive: '通常入力の手で魔力を追加＋1', skillName: '月光解放', skill: '任意の空きマスから始動。この手の総ダメージを2倍。', unlock: 12, affinity: ['battery', 'amplifier', 'afterglow', 'stroke'] },
];
export const primeIds: RelicId[] = ['duality', 'trinity', 'quint', 'sept'];
export const greaterIds: GreaterRelicId[] = ['stroke', 'trinity', 'duality', 'quint', 'sept', 'lens', 'wick'];
export interface Relic { id: RelicId; name: string; symbol: string; kind: string; description: string; unlock: number }
export const RELICS: Relic[] = [
  { id: 'wick', name: '長い導火線', symbol: '〰', kind: '連鎖', description: '自動入力回数＋2。もう少し先まで、魔法をつなぐ。', unlock: 0 },
  { id: 'echo', name: '共鳴石', symbol: '◈', kind: '連鎖', description: '起点と同じ数字になる空きマスへ1回、無料で飛び火。そこから連鎖を続ける。', unlock: 3 },
  { id: 'rekindle', name: '再燃の輪', symbol: '◎', kind: '連鎖', description: '各手で最初に行・列・区画を完成させると、自動入力回数＋3。', unlock: 6 },
  { id: 'pen', name: '刻印のペン', symbol: '✒', kind: '完成', description: '行・列・区画の完成ダメージ＋20／単位。', unlock: 0 },
  { id: 'ward', name: '守護の紋章', symbol: '⬡', kind: '守護', description: '行・列・区画の完成1単位につき守護＋3。同じシートでは毎手の反撃を軽減し、次のシートでリセット。', unlock: 0 },
  { id: 'stroke', name: '一筆の杖', symbol: 'Ⅰ', kind: '技巧', description: '各手で最初に埋めた3マスのダメージを2倍。連鎖が長くなっても有効。', unlock: 0 },
  { id: 'battery', name: '蓄電石', symbol: '⋈', kind: '魔力', description: '通常入力の手で魔力を追加＋2。超過分を2まで蓄え、次のスキル使用後に残す。', unlock: 0 },
  { id: 'amplifier', name: '魔力増幅器', symbol: '✵', kind: '魔力', description: 'スキルで始めた手の総ダメージを1.5倍。', unlock: 12 },
  { id: 'afterglow', name: '残光の灯', symbol: '☼', kind: '魔力', description: 'スキル使用後、次の通常入力だけ自動入力回数＋2。戦闘を越えて残る。', unlock: 0 },
  { id: 'lens', name: '弱点のレンズ', symbol: '⌖', kind: '技巧', description: '弱点マスの追加ダメージを8から20にする。', unlock: 0 },
  { id: 'glass', name: '硝子の杖', symbol: '⟡', kind: '代償', description: '総ダメージ1.25倍。代わりに最大HP−8。現在HPも新しい上限まで下がる。', unlock: 0 },
  { id: 'trinity', name: '三の護符', symbol: 'Ⅲ', kind: '確率', description: '数字「3」を埋めた手で30％の確率でダメージ1.5倍（シート完成の追加分を除く）。再取得で確率が45％、60％へ上がる（取得は3回まで）。', unlock: 0 },
  { id: 'duality', name: '二の護符', symbol: 'Ⅱ', kind: '確率', description: '数字「2」を埋めた手で30％の確率で、守護を引いた後の反撃を25％軽減。再取得で確率45％、60％（3回まで）。軽減の合計上限は60％。', unlock: 0 },
  { id: 'quint', name: '五の護符', symbol: 'Ⅴ', kind: '確率', description: '数字「5」を埋めた手で30％の確率で、魔力を使わないスキル券を1枚獲得（所持上限1枚）。券を持つ手・無料スキルの手は抽選しない。再取得で確率45％、60％（3回まで）。', unlock: 0 },
  { id: 'sept', name: '七の護符', symbol: 'Ⅶ', kind: '確率', description: '数字「7」を埋めた手で30％の確率で、次の1手の自動入力回数＋7を予約。予約は1件までで加算されない。再取得で確率45％、60％（3回まで）。', unlock: 0 },
  { id: 'gold', name: '黄金のインク', symbol: '✧', kind: '得点', description: '攻撃から得るスコアを1.5倍。ダメージは変化しない。', unlock: 0 },
];
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
  { id: 'training', name: '術式の鍛錬', symbol: '✦', kind: '鍛錬', description: '術式レベル＋1。攻撃倍率＋0.2・自動入力回数＋1・最大HP＋4、HPを10回復。何度でも選べる。' },
  { id: 'vitality', name: '生命の器', symbol: '♡', kind: '成長', description: '最大HP＋12、HPを12回復。何度でも選べる。' },
  { id: 'magic-boon', name: '魔力の祝福', symbol: '✵', kind: '祝福', description: 'これから5戦、戦闘開始時に魔力を8へ。蓄電の超過分はそのまま。同じ祝福は重ならず、再取得で残り5戦へ更新。' },
  { id: 'defense-boon', name: '守護の祝福', symbol: '⬡', kind: '祝福', description: 'これから5戦、守護を引いた後の反撃を25％軽減。二の護符と合計で最大60％。同じ祝福は重ならず、再取得で残り5戦へ更新。' },
  { id: 'recovery', name: '癒しの泉', symbol: '✚', kind: '回復', description: 'HPを全回復。何度でも選べる。' },
];
export const characterOf = (id: CharacterId) => CHARACTERS.find(c => c.id === id)!;
export const relicOf = (id: RelicId) => RELICS.find(r => r.id === id)!;
/** Descriptions use current acquisition rank and tier; missing entries mean rank/tier 1. */
export function relicDescription(id: RelicId, run?: Run): string {
  if (run?.expansionVersion && run.inventory.includes(id)) return relicGrowthDescription(run, id);
  const upper = run?.tier?.[id] === 2;
  if (id === 'stroke') return `各手で最初に埋めた${upper ? 5 : 3}マスのダメージを2倍。連鎖が長くなっても有効。`;
  if (id === 'lens' && upper) return '弱点マスの追加ダメージを32にする（通常より＋12）。弱点を埋めるたびに有効。';
  if (id === 'wick' && upper) return '自動入力回数＋2。シートを完成させても回数が残っていれば、次のシートへ詠唱を続ける。新しいシートの始動にも1回使う。';
  if (primeIds.includes(id)) {
    const rank = run?.acquisitionRank?.[id] ?? 1, chance = [30, 45, 60][rank - 1];
    const effect = id === 'trinity' ? `ダメージ${upper ? 2 : 1.5}倍（シート完成の追加分を除く）`
      : id === 'duality' ? `守護を引いた後の反撃を${upper ? 50 : 25}％軽減（合計上限60％）`
      : id === 'quint' ? `魔力を使わないスキル券を${upper ? 2 : 1}枚獲得（所持上限${upper ? 2 : 1}枚）。券を持つ手・無料スキルの手は抽選しない`
      : `次の1手の自動入力回数＋${upper ? 14 : 7}を予約（予約は1件、加算なし）`;
    const digit = { duality: 2, trinity: 3, quint: 5, sept: 7 }[id as 'duality' | 'trinity' | 'quint' | 'sept'];
    return `数字「${digit}」を埋めた手で${chance}％の確率で${effect}。${rank < 3 ? `再取得で確率が${rank === 1 ? '45％、60％' : '60％'}へ上がる（取得は3回まで）。` : '取得上限の3回に到達。'}`;
  }
  return relicOf(id).description;
}
export function skillDescription(run: SkillRun): string {
  if (run.expansionVersion) return skillDescriptionFor(run, run.character);
  if (run.skillRank !== 2) return characterOf(run.character).skill;
  if (run.character === 'fuse') return '任意の空きマスから始動。自動入力回数＋4。つながる確定マスがなくなった時、残り回数を1使い、直前と同じ数字の空きマスへ1回だけ飛び火して続ける。';
  if (run.character === 'scribe') return '任意の空きマスから始動。この手の完成ダメージを4倍。';
  return '任意の空きマスから始動。この手の総ダメージを2.5倍。';
}
export function rewardOf(id: RewardId, run?: Run) {
  if (id.startsWith('skill:')) {
    const skillId = id.slice(6) as SkillId, skill = skillOf(skillId);
    if (!run) return { ...skill, id, name: `${skill.name}を習得`, description: skill.description };
    const before = skillLevel(run, skillId), after = Math.min(10, before + 1);
    const next = { ...run, expansionVersion: 1 as const, skillLevels: { ...run.skillLevels, [skillId]: after } };
    return { ...skill, id, name: `${skill.name} Lv.${before}→${after}`, kind: after === 5 || after === 10 ? 'スキル進化' : before ? 'スキル強化' : '新スキル',
      description: `${before ? skillDescriptionFor(run, skillId) : '未習得'} → ${skillDescriptionFor(next, skillId)}${!before && skillId !== run.character ? ` ${(run.equippedSkills?.length ?? 0) < 2 ? '空きスロットへ自動装備。' : '追加装備2枠が満杯。報酬後に入れ替え可能。'}` : ''}` };
  }
  if (run?.expansionVersion && run.rewardStep !== 'legacy' && (id.startsWith('greater:') || id.startsWith('apex:'))) {
    const relicId = (id.startsWith('greater:') ? id.slice(8) : id.slice(5)) as RelicId, relic = relicOf(relicId);
    const before = relicTierLevel(run, relicId), after = id.startsWith('greater:') ? 2 : Math.min(3, before + 1);
    const next = structuredClone(run); next.tier[relicId] = after;
    if (!next.inventory.includes(relicId)) { next.inventory.push(relicId); next.relicLevels = { ...next.relicLevels, [relicId]: 1 }; }
    return { ...relic, id, name: `${after === 3 ? '極位' : '上位'}・${relic.name}`, kind: `段階${before}→${after}`,
      description: `${run.inventory.includes(relicId) ? relicGrowthDescription(run, relicId) : '未所持'} → ${relicGrowthDescription(next, relicId)} レベル・素数護符の取得回数は保持。旧効果へ重ね掛けしない。` };
  }
  if (id.startsWith('apex:')) {
    const relicId = id.slice(5) as RelicId, relic = relicOf(relicId);
    return { ...relic, id, name: `極位・${relic.name}`, kind: 'ボス報酬', description: '遺物の段階を上げ、効果を置き換える。極位への進化はLv.5以上。' };
  }
  if (id === 'skill-upgrade') return {
    id, name: '固有スキル強化', symbol: '✦', kind: 'ボス報酬',
    description: run ? `${characterOf(run.character).skillName}をランク2へ。${skillDescription({ character: run.character, skillRank: 2 })}` : '固有スキルをランク1から2へ強化。術式レベルとは別の成長。',
  };
  if (id.startsWith('greater:')) {
    const relicId = id.slice(8) as GreaterRelicId, relic = relicOf(relicId);
    const changes: Record<GreaterRelicId, string> = {
      stroke: '2倍になる範囲が各手の最初の3マスから5マスへ広がる。倍率は重複しない。',
      trinity: '発動時のダメージが1.5倍から2倍へ（シート完成の追加分を除く）。発動確率はそのまま。倍率は重複しない。',
      duality: '発動時の反撃軽減が25％から50％へ。守護を引いた後に適用し、祝福との合計上限は60％。発動確率はそのまま。',
      quint: '発動時の無料スキル券が1枚から2枚へ、所持上限も2枚へ。券を先に使い、魔力と超過分はそのまま残す。券を持つ手・無料スキルの手は抽選しない。',
      sept: '次の1手へ予約する自動入力回数が＋7から＋14へ。予約は1件までで加算されない。発動確率はそのまま。',
      lens: '弱点マスの追加ダメージを20から32へ強化（＋12）。弱点を埋めるたびに有効。',
      wick: '自動入力回数＋2を保ち、シート完成後の残り回数で次のシートへ詠唱を続ける。次の始動に1回使う。連鎖数と各手1回の効果は引き継ぐ。',
    };
    return { ...relic, id, name: `上位・${relic.name}`, kind: 'ボス報酬', description: `${relic.name}を上位へ置き換える。${changes[relicId]}` };
  }
  const relic = RELICS.find(r => r.id === id);
  if (relic) {
    if (run?.expansionVersion && run.rewardStep !== 'legacy') {
      const before = relicLevel(run, relic.id), after = Math.min(10, before + 1), next = structuredClone(run);
      next.relicLevels = { ...next.relicLevels, [relic.id]: after };
      if (!next.inventory.includes(relic.id)) next.inventory.push(relic.id);
      if (primeIds.includes(relic.id)) next.acquisitionRank[relic.id] = Math.min(3, (run.acquisitionRank[relic.id] ?? (before ? 1 : 0)) + 1);
      return { ...relic, name: `${relic.name} Lv.${before}→${after}`, kind: before ? '遺物強化' : '新しい遺物',
        description: `${before ? relicGrowthDescription(run, relic.id) : '未所持'} → ${relicGrowthDescription(next, relic.id)}` };
    }
    if (primeIds.includes(relic.id) && run?.inventory.includes(relic.id)) {
      const nextRank = Math.min(3, (run.acquisitionRank[relic.id] ?? 1) + 1);
      return { ...relic, name: `${relic.name}（取得${nextRank}回目）`, description: `発動確率を${[30, 45, 60][nextRank - 1]}％へ強化。効果と上位段階はそのまま。取得は3回まで。` };
    }
    return { ...relic, description: relicDescription(relic.id, run) };
  }
  return REPEATABLE_REWARDS.find(r => r.id === id)!;
}
