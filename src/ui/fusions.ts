import { FUSIONS, availableFusions, fusionLevelRequirement, relicInventoryEntries, type FusionDefinition } from '../game/fusions';
import { relicOf, relicDescription } from '../game/content';
import { relicLevel, relicTierLabel } from '../game/growth';
import type { Run } from '../game/types';

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const ingredients = (fusion: FusionDefinition) => fusion.components.map(id => relicOf(id).name).join(' ＋ ');
export function fusionRewards(run: Run): string {
  if (run.rewardStep !== 'relic' || (run.stage + 1) % 5) return '';
  const available = availableFusions(run);
  return `<section class="fusion-rewards" aria-label="遺物の融合"><h3>極位融合 · ボスの追加報酬</h3><p>${run.lastFusionStage === run.stage ? '融合を保存しました。続けて通常の遺物報酬を選べます。' : `素材2個がともに極位・Lv.${fusionLevelRequirement(run)}以上なら、1組を融合できます。素材の効果を引き継いだ強力な遺物になり、2枠を使います。融合後に通常報酬も選べます。`}</p>${available.length ? `<div class="fusion-grid">${available.map(f => `<button class="fusion-card" data-fusion="${f.id}"><strong>${f.symbol} ${f.name}</strong><small>${ingredients(f)}</small><span>${f.description}</span><b>追加報酬として融合 · 2枠</b></button>`).join('')}</div>` : run.lastFusionStage !== run.stage ? '<p class="quiet">今は融合できる組み合わせがありません。遺物図鑑で全10種の素材を確認できます。</p>' : ''}</section>`;
}
export function fusionCodex(run?: Run): string {
  return `<section class="fusion-codex"><h3>極位融合 · 10の組み合わせ</h3><p>ボスの遺物報酬で、極位・Lv.${fusionLevelRequirement(run ?? {})}以上の素材2個から1組を融合。通常報酬とは別に1回選べます。素材の全効果を引き継ぎ、合計2枠を使用します。同じ素材を複数の融合には使えません。</p><div class="fusion-grid">${FUSIONS.map(f => `<article class="fusion-card"><strong>${f.symbol} ${f.name}</strong><small>${ingredients(f)}</small><p>${f.description}</p></article>`).join('')}</div><p class="quiet">交換で手放すと素材2個をまとめて外します。素材の育成は保管され、再取得できます。融合効果を戻すには再びボスで融合してください。</p></section>`;
}
export function inventoryItems(run: Run): string {
  return relicInventoryEntries(run).map(({ relic: id, fusion }) => {
    const item = relicOf(id);
    return `<div class="inventory-item" data-relic="${id}"${fusion ? ` data-fused="${fusion.id}"` : ''}><span>${fusion?.symbol ?? item.symbol}</span><div><strong>${fusion?.name ?? item.name}</strong><span class="relic-rank">${fusion ? `融合 · 極位 · 素材Lv.${fusion.components.map(component => relicLevel(run, component)).join(' / ')} · 2枠` : `${esc(relicTierLabel(run, id))} · Lv.${relicLevel(run, id)}`}</span>${fusion ? `<small>${ingredients(fusion)}</small><p>${fusion.description}</p>${fusion.components.map(component => `<p>${esc(relicDescription(component, run))}</p>`).join('')}` : `<p>${esc(relicDescription(id, run))}</p>`}</div></div>`;
  }).join('');
}
