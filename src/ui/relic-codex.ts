import { numberText } from '../format-number';
import { RELICS, primeIds, relicOf } from '../game/content';
import { relicGrowthDescription, relicLevel, relicMaxLevel, relicTierLevel, relicValues, type RelicRun } from '../game/growth';
import type { RelicId, Run } from '../game/types';

const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const tiers = ['通常', '上位', '極位'];
/** Reference growth follows new acquisition, then one ordinary reward per level.
 * Rank is independent in migrated saves; never change it in the actual run. */
export function catalogRelicState(id: RelicId, level: number, tier: number, campaignVersion?: 1, progression?: Pick<Run, 'mode' | 'progressionVersion'>): RelicRun {
  return { inventory: [id], acquisitionRank: { [id]: Math.min(3, level) }, tier: { [id]: tier },
    expansionVersion: 1, relicBalanceVersion: 1, relicLevels: { [id]: level }, ...(campaignVersion ? { campaignVersion } : {}), mode: progression?.mode, progressionVersion: progression?.progressionVersion };
}
export function catalogRelicDescription(id: RelicId, level: number, tier: number, campaignVersion?: 1, progression?: Pick<Run, 'mode' | 'progressionVersion'>): string {
  const state = catalogRelicState(id, level, tier, campaignVersion, progression), value = relicValues(state, id);
  const multiplier = id === 'amplifier' ? value.skillMultiplier : id === 'glass' ? value.damageMultiplier : undefined;
  return relicGrowthDescription(state, id) + (multiplier === undefined ? '' : ` この遺物単独では${numberText(multiplier)}倍相当。`);
}
export function relicGrowthRows(id: RelicId, tier: number, run?: Run): string {
  const owned = run?.inventory.includes(id), current = owned ? relicLevel(run!, id) : 0;
  return `<ol class="codex-levels">${Array.from({ length: relicMaxLevel(run ?? {}) }, (_, i) => {
    const lv = i + 1, active = owned && current === lv && relicTierLevel(run!, id) === tier;
    return `<li data-level="${lv}" class="${active ? 'current-level' : ''}"><div class="codex-level-label">Lv.${lv}${lv === relicMaxLevel(run ?? {}) ? '（上限）' : ''}${active ? '<span>所持中と同じLv・段階（参考）</span>' : ''}${tier === 3 && lv < 5 ? '<span>参考値（極位への進化はLv.5以上）</span>' : ''}</div><p>${esc(catalogRelicDescription(id, lv, tier, run?.campaignVersion, run))}</p></li>`;
  }).join('')}</ol>`;
}
export function relicCodex(run?: Run): string {
  return RELICS.map(r => {
    const owned = run?.inventory.includes(r.id), tier = owned ? relicTierLevel(run!, r.id) : 1;
    const description = run?.campaignVersion === 1 ? catalogRelicDescription(r.id, 1, 1, 1) : r.description;
    const growth = run?.progressionVersion === 1 ? `同じ遺物の強化でLv.が1上昇（最大${relicMaxLevel(run)}）。通常戦でも低確率で進化が登場します。` : run?.campaignVersion === 1 ? '同じ遺物の取得でLv.が1上昇、通常モードの第20戦以降は2上昇（最大10）。' : '同じ遺物の取得でLv.が1上昇（最大10）。';
    return `<article class="codex-item" data-codex-relic="${r.id}"><span>${r.symbol}</span><div class="codex-content"><small>${r.kind} · 通常 Lv.1</small><h3>${r.name}</h3><p>${esc(description)}</p><b class="unlocked">最初から報酬候補</b>${owned ? `<p class="codex-owned">所持中：${tiers[tier - 1]} Lv.${relicLevel(run!, r.id)}</p>` : ''}<details class="codex-growth"><summary>${r.name}の強化・進化を見る</summary><label class="codex-tier-label">進化段階<select data-codex-tier="${r.id}" aria-label="${r.name}の進化段階">${tiers.map((name, i) => `<option value="${i + 1}" ${tier === i + 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></label>${owned ? `<p class="codex-owned-effect">所持中の実際の効果：${esc(relicGrowthDescription(run!, r.id))}</p>` : ''}<p class="codex-growth-note">${growth}ボス報酬で通常→上位、Lv.5以降は上位→極位へ。進化ではLv.は変わりません。</p>${primeIds.includes(r.id) ? '<p class="codex-growth-note">参考の発動率はLv.1から1レベルずつ取得・強化した場合の値です。旧ルールの2レベル強化では取得回数が異なります。所持中の実際の効果を確認してください。進化だけでは発動率は変わりません。過去の冒険から続けた遺物は取得回数によって異なることがあります。</p>' : ''}<div class="codex-growth-rows">${relicGrowthRows(r.id, tier, run)}</div></details></div></article>`;
  }).join('');
}
export function changeCodexTier(target: EventTarget | null, run?: Run): void {
  if (!(target instanceof HTMLSelectElement) || !target.dataset.codexTier) return;
  const id = target.dataset.codexTier as RelicId;
  if (!RELICS.some(r => r.id === id)) return;
  const tier = Number(target.value);
  if (![1, 2, 3].includes(tier)) return;
  const rows = target.closest('.codex-growth')?.querySelector('.codex-growth-rows');
  if (rows) rows.innerHTML = relicGrowthRows(relicOf(id).id, tier, run);
}
