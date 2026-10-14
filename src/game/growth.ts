import type { CharacterId, RelicId, Run, SkillId } from './types';

export const MAX_GROWTH_LEVEL = 10;
export const MAX_EQUIPPED_SKILLS = 2;
export interface SkillDefinition { id: SkillId; name: string; symbol: string; kind: string; description: string }
export const SKILLS: SkillDefinition[] = [
  { id: 'fuse', name: '星火連環', symbol: '✦', kind: '連鎖', description: '自動入力を増やし、成長すると同じ数字へ飛び火する。' },
  { id: 'scribe', name: '大紋章の詠唱', symbol: '◇', kind: '完成', description: '行・列・区画の完成ダメージを増幅する。' },
  { id: 'lumen', name: '月光解放', symbol: '☾', kind: '攻撃', description: 'この詠唱の通常攻撃ダメージを増幅する。' },
  { id: 'bridge', name: '連星渡り', symbol: '↝', kind: '連鎖', description: '接続先が途切れたら、自動入力を1回使い、最も近い確定マスへ再接続する。' },
  { id: 'pierce', name: '貫星弾', symbol: '⌖', kind: '弱点', description: '実際に埋めた弱点マスごとに追加攻撃。Lv.5から弱点3マス以上で追撃する。' },
  { id: 'bastion', name: '護星砲', symbol: '⬡', kind: '守護', description: '詠唱中の最大シート守護値に応じた追加攻撃。Lv.5から一時守護を得る。' },
];
export const skillOf = (id: SkillId): SkillDefinition => SKILLS.find(skill => skill.id === id)!;
const level = (value: number | undefined, fallback: number) => Math.min(10, Math.max(1, Math.floor(Number.isFinite(value) ? value! : fallback)));
export type SkillRun = Pick<Run, 'character' | 'skillRank'> & Partial<Pick<Run, 'expansionVersion' | 'skillLevels' | 'equippedSkills'>>;
export function skillLevel(run: SkillRun, id: SkillId): number {
  if (!run.expansionVersion) return id === run.character ? run.skillRank : 0;
  if (run.skillLevels?.[id] !== undefined) return level(id === run.character ? Math.max(run.skillLevels[id]!, run.skillRank) : run.skillLevels[id], 1);
  return id === run.character ? run.skillRank : 0;
}
export const ownedSkills = (run: SkillRun): SkillId[] => SKILLS.filter(skill => skillLevel(run, skill.id) > 0).map(skill => skill.id);
/** The intrinsic skill never occupies an additional slot. No cast combines skills. */
export function selectedSkill(run: SkillRun, skill: boolean, requested?: SkillId): SkillId | undefined {
  if (!skill) return undefined;
  const id = requested ?? run.character;
  if (!skillLevel(run, id) || id !== run.character && !run.equippedSkills?.includes(id)) throw new Error('習得して装備したスキルを選んでください。');
  return id;
}
export interface SkillValues {
  level: number; evolution: number; auto: number; fuseHops: number; reconnects: number;
  completionMultiplier: number; damageMultiplier: number; weakAttack: number; weakBurst: number;
  shieldAttack: number; temporaryShield: number;
}
export function skillValues(run: SkillRun, id: SkillId): SkillValues {
  const lv = skillLevel(run, id), index = Math.max(0, lv - 1);
  const result: SkillValues = { level: lv, evolution: lv >= 10 ? 3 : lv >= 5 ? 2 : 1, auto: 0, fuseHops: 0, reconnects: 0,
    completionMultiplier: 1, damageMultiplier: 1, weakAttack: 0, weakBurst: 0, shieldAttack: 0, temporaryShield: 0 };
  if (!lv) return result;
  if (id === 'fuse') { result.auto = [4, 4, 5, 6, 7, 8, 9, 10, 11, 12][index]; result.fuseHops = lv >= 10 ? 3 : lv >= 5 ? 2 : lv >= 2 ? 1 : 0; }
  if (id === 'scribe') result.completionMultiplier = [3, 4, 4.25, 4.5, 5, 5.2, 5.4, 5.6, 5.8, 6.2][index];
  if (id === 'lumen') result.damageMultiplier = [2, 2.5, 2.65, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.75][index];
  if (id === 'bridge') { result.auto = [0, 1, 2, 3, 3, 4, 5, 6, 7, 8][index]; result.reconnects = lv >= 10 ? 3 : lv >= 5 ? 2 : 1; }
  if (id === 'pierce') { result.weakAttack = [24, 28, 32, 36, 40, 43, 46, 49, 52, 55][index]; result.weakBurst = lv >= 5 ? [60, 68, 76, 84, 92, 100][lv - 5] : 0; }
  if (id === 'bastion') { result.shieldAttack = [1.5, 1.75, 2, 2.2, 2.5, 2.7, 2.9, 3.1, 3.3, 3.6][index]; result.temporaryShield = lv >= 5 ? [6, 7, 8, 9, 10, 14][lv - 5] : 0; }
  return result;
}
export function relicLevel(run: Run, id: RelicId): number {
  if (!run.inventory.includes(id)) return 0;
  return run.expansionVersion ? level(run.relicLevels?.[id], run.acquisitionRank[id] ?? 1) : 1;
}
export function relicTierLevel(run: Run, id: RelicId): number { return Math.max(1, Math.min(run.expansionVersion ? 3 : 2, Math.floor(run.tier[id] ?? 1))); }
export const relicTierLabel = (run: Run, id: RelicId): string => ['通常', '上位', '極位'][relicTierLevel(run, id) - 1];
export interface RelicValues {
  level: number; tier: number; auto: number; echoes: number; echoDamage: number; rekindleAuto: number;
  completion: number; ward: number; strokeCells: number; strokeMultiplier: number; charge: number; overflow: number;
  skillMultiplier: number; afterglowAuto: number; weakDamage: number; damageMultiplier: number; scoreMultiplier: number;
  chance: number; primeValue: number; carry: boolean;
}
/** One replacement value per effect: tier and level never reapply an old multiplier. */
export function relicValues(run: Run, id: RelicId): RelicValues {
  const lv = relicLevel(run, id), tier = relicTierLevel(run, id), n = run.expansionVersion ? Math.max(0, lv - 1) : 0, t = tier - 1;
  const result: RelicValues = { level: lv, tier, auto: 0, echoes: 0, echoDamage: 0, rekindleAuto: 0, completion: 0, ward: 0,
    strokeCells: 0, strokeMultiplier: 1, charge: 0, overflow: 0, skillMultiplier: 1, afterglowAuto: 0, weakDamage: 8,
    damageMultiplier: 1, scoreMultiplier: 1, chance: 0, primeValue: 0, carry: false };
  if (!lv) return result;
  // Finite, diminishing growth for rates. The first three prime acquisitions
  // retain exactly 30/45/60%; rank and tier are persisted independently of level.
  const diminishing = [0, .05, .1, .14, .18, .21, .24, .265, .29, .31][n];
  const chanceBonus = [0, 0, 0, .06, .10, .13, .155, .175, .19, .20][n];
  if (id === 'wick') { result.auto = 2 + n + (tier === 3 ? 2 : 0); result.carry = tier >= 2; }
  if (id === 'echo') { result.echoes = lv >= 10 && run.expansionVersion ? 3 : lv >= 5 && run.expansionVersion ? 2 : 1; result.echoDamage = n * 2 + t * 6; }
  if (id === 'rekindle') result.rekindleAuto = 3 + n + t * 2;
  if (id === 'pen') result.completion = 20 + n * 5 + t * 10;
  if (id === 'ward') result.ward = 3 + n + t * 2;
  if (id === 'stroke') { result.strokeCells = [3, 5, 7][t] + Math.floor(n / 3); result.strokeMultiplier = 2 + diminishing; }
  if (id === 'battery') { result.charge = 2 + n + t; result.overflow = Math.min(6, 2 + Math.floor(n / 3) + t); }
  if (id === 'amplifier') result.skillMultiplier = 1.5 + diminishing + t * .2;
  if (id === 'afterglow') result.afterglowAuto = 2 + n + t * 2;
  if (id === 'lens') result.weakDamage = 20 + n * 4 + t * 12;
  if (id === 'glass') result.damageMultiplier = 1.25 + diminishing * .5 + t * .1;
  if (id === 'gold') result.scoreMultiplier = 1.5 + diminishing + t * .25;
  if (['duality', 'trinity', 'quint', 'sept'].includes(id)) {
    const rank = Math.min(3, Math.max(1, Math.floor(run.acquisitionRank[id] ?? 1)));
    result.chance = Math.min(.8, [.3, .45, .6][rank - 1] + chanceBonus);
    const primeGrowth = [0, .05, .1, .14, .18, .21, .24, .265, .29, .31][Math.max(0, n - 2)];
    if (id === 'trinity') result.primeValue = [1.5, 2, 2.4][t] + primeGrowth;
    if (id === 'duality') result.primeValue = Math.min(.6, [.25, .5, .6][t] + primeGrowth * .25);
    if (id === 'quint') result.primeValue = Math.min(3, tier);
    if (id === 'sept') result.primeValue = [7, 14, 21][t] + Math.max(0, n - 2);
  }
  return result;
}
const numberText = (value: number): string => Number(value.toFixed(3)).toString();
const percent = (value: number): string => `${numberText(value * 100)}％`;
export function skillDescriptionFor(run: SkillRun, id: SkillId): string {
  const value = skillValues(run, id);
  if (!value.level) return `未習得。${skillOf(id).description}`;
  const opening = '任意の空きマスから始動。';
  if (id === 'fuse') return `${opening}自動入力＋${value.auto}。${value.fuseHops ? `接続が途切れると残り自動入力を1回使い、直前と同じ数字へ最大${value.fuseHops}回飛び火。` : 'Lv.2で同じ数字への飛び火を習得。'}`;
  if (id === 'scribe') return `${opening}完成ダメージ${numberText(value.completionMultiplier)}倍。`;
  if (id === 'lumen') return `${opening}通常攻撃ダメージ${numberText(value.damageMultiplier)}倍。`;
  if (id === 'bridge') return `${opening}自動入力＋${value.auto}。接続が途切れた時、残り自動入力を1回使って最も近い確定マスへ最大${value.reconnects}回再接続。同距離は上→左。`;
  if (id === 'pierce') return `${opening}弱点1マスごとに${value.weakAttack}×術式倍率の追加攻撃。${value.weakBurst ? `弱点3マス以上でさらに${value.weakBurst}×術式倍率を1回追撃。` : 'Lv.5で弱点3マスの追撃を習得。'}追加攻撃に通常・護符倍率やシート完成加算は重ならない。`;
  return `${opening}詠唱中の最大シート守護×${numberText(value.shieldAttack)}×術式倍率の追加攻撃。${value.temporaryShield ? `この手だけ守護＋${value.temporaryShield}。` : 'Lv.5で一時守護を習得。'}複数シートの守護は合算しない。追加攻撃に通常・護符倍率やシート完成加算は重ならない。`;
}
export function skillNextDescription(run: SkillRun, id: SkillId): string {
  const lv = skillLevel(run, id);
  if (lv >= 10) return 'Lv.10・最大レベル。';
  const next = { ...run, expansionVersion: 1 as const, skillLevels: { ...run.skillLevels, [id]: lv + 1 } };
  return `次：Lv.${lv + 1}${lv + 1 === 5 || lv + 1 === 10 ? '・進化' : ''}。${skillDescriptionFor(next, id)}`;
}
export function relicGrowthDescription(run: Run, id: RelicId): string {
  const v = relicValues(run, id);
  if (!v.level) return '未所持。';
  if (id === 'wick') return `自動入力＋${v.auto}。${v.carry ? 'シート完成時、残り回数で次のシートへ連鎖（始動も1回消費）。' : '上位でシート間の連鎖を解放。'}`;
  if (id === 'echo') return `起点と同じ数字へ最大${v.echoes}回、無料で飛び火。飛び火1マスごとに基本ダメージ＋${v.echoDamage}。`;
  if (id === 'rekindle') return `詠唱全体で最初の行・列・区画完成時、自動入力＋${v.rekindleAuto}。1回だけ。`;
  if (id === 'pen') return `行・列・区画の完成ダメージ＋${v.completion}／単位。`;
  if (id === 'ward') return `完成1単位につきシート守護＋${v.ward}。同じシートの反撃に毎手適用。`;
  if (id === 'stroke') return `最初の${v.strokeCells}マスの基本・完成・弱点ダメージを${numberText(v.strokeMultiplier)}倍。旧倍率と重複しない。`;
  if (id === 'battery') return `通常詠唱の魔力＋${v.charge}。超過分を${v.overflow}まで蓄え、有料スキル直後に戻す。無料券を先に使い魔力を温存。`;
  if (id === 'amplifier') return `スキル詠唱の通常攻撃ダメージを${numberText(v.skillMultiplier)}倍。`;
  if (id === 'afterglow') return `スキル使用後、次の通常詠唱だけ自動入力＋${v.afterglowAuto}。戦闘を越えて保持。`;
  if (id === 'lens') return `弱点マスの追加ダメージ${v.weakDamage}。${v.tier === 1 ? '上位でさらに＋12、極位で通常より＋24。' : v.tier === 2 ? '通常より＋12。極位でさらに＋12。' : '通常より＋24。'}弱点を埋めるたびに有効。`;
  if (id === 'glass') return `通常攻撃ダメージ${numberText(v.damageMultiplier)}倍。初取得時のみ最大HP−8（強化では再減少しない）。`;
  if (id === 'gold') return `攻撃由来の得点${numberText(v.scoreMultiplier)}倍。攻撃ダメージと撃破固定500点は変えない。`;
  const digit = { duality: 2, trinity: 3, quint: 5, sept: 7 }[id as 'duality' | 'trinity' | 'quint' | 'sept'];
  const prefix = `数字「${digit}」を埋めた詠唱ごとに1回、${percent(v.chance)}で`;
  if (id === 'trinity') return `${prefix}通常攻撃${numberText(v.primeValue)}倍。完成加算・追加攻撃は増幅しない。旧倍率と重複しない。`;
  if (id === 'duality') return `${prefix}守護を引いた後の反撃を${percent(v.primeValue)}軽減。祝福との合計上限60％。`;
  if (id === 'quint') return `${prefix}無料スキル券${v.primeValue}枚（所持上限${v.primeValue}枚、最大3枚）。券所持中・無料スキル中は抽選しない。`;
  return `${prefix}次の詠唱へ自動入力＋${v.primeValue}を予約。予約は1件で、重ねて加算しない。`;
}
export function relicNextDescription(run: Run, id: RelicId): string {
  const lv = relicLevel(run, id), tier = relicTierLevel(run, id);
  const tierHint = tier >= 3 ? '極位に到達。' : `ボスで${tier === 1 ? '上位' : 'Lv.5以降に極位'}へ進化可能。`;
  if (lv >= 10) return `Lv.10・最大レベル。${tierHint}`;
  const next = structuredClone(run);
  next.expansionVersion = 1; next.relicLevels = { ...next.relicLevels, [id]: lv + 1 };
  if (!next.inventory.includes(id)) next.inventory.push(id);
  if (['duality', 'trinity', 'quint', 'sept'].includes(id)) next.acquisitionRank[id] = Math.min(3, (run.acquisitionRank[id] ?? (lv ? 1 : 0)) + 1);
  return `次：Lv.${lv + 1}。${relicGrowthDescription(next, id)} ${tierHint}`;
}
export const intrinsicSkill = (character: CharacterId): SkillId => character;
