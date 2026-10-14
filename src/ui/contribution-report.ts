import { relicOf } from '../game/content';
import { ownedSkills, relicLevel, relicNextDescription, relicTierLabel, skillLevel, skillNextDescription, skillOf } from '../game/growth';
import type { BattleLedger, EffectMetric, RelicId, Run, SkillId, SkillMetric } from '../game/types';

const fmt = (n: number): string => n.toLocaleString('ja-JP');
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const emptyEffect = (): EffectMetric => ({ heldCasts: 0, opportunities: 0, triggers: 0, damage: 0, addedInputs: 0, fuelGranted: 0, fuelUsed: 0, mana: 0, prevented: 0, tokensGranted: 0, tokensUsed: 0, score: 0 });

/** Aggregate only the recorded observation window, without estimating missing casts. */
export function contributionSummary(run: Run, bossOnly = false): BattleLedger & { battles: number } {
  const recent = (run.contributions?.battles ?? []).slice(-5);
  const battles = bossOnly ? recent.filter(battle => battle.stage === run.stage && battle.boss) : recent;
  const total: BattleLedger & { battles: number } = { stage: run.stage, boss: bossOnly, casts: 0, damage: 0, hpDamage: 0, overkill: 0, score: 0, skills: {}, relics: {}, battles: battles.length };
  for (const battle of battles) {
    for (const key of ['casts', 'damage', 'hpDamage', 'overkill', 'score'] as const) total[key] += battle[key];
    for (const [id, value] of Object.entries(battle.skills) as [SkillId, SkillMetric][]) {
      const entry = total.skills[id] ??= { uses: 0, damage: 0, hpDamage: 0, overkill: 0, level: value.level };
      entry.uses += value.uses; entry.damage += value.damage; entry.hpDamage += value.hpDamage; entry.overkill += value.overkill; entry.level = value.level;
    }
    for (const [id, value] of Object.entries(battle.relics) as [RelicId, EffectMetric][]) {
      const entry = total.relics[id] ??= emptyEffect();
      for (const key of Object.keys(entry) as (keyof EffectMetric)[]) entry[key] += value[key] ?? 0;
    }
  }
  return total;
}

export function effectRows(metric: EffectMetric): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (metric.damage) rows.push({ label: '同経路・発揮ダメージ差（超過含む）', value: `＋${fmt(metric.damage)}` });
  if (metric.fuelGranted || metric.fuelUsed) {
    rows.push({ label: '自動入力の付与 / 使用', value: `${fmt(metric.fuelGranted)} / ${fmt(metric.fuelUsed)}回` });
  }
  if (metric.addedInputs) rows.push({ label: '無料で直接入力したマス', value: `${fmt(metric.addedInputs)}マス` });
  if (metric.mana) rows.push({ label: '追加の魔力', value: `＋${fmt(metric.mana)}` });
  if (metric.prevented) rows.push({ label: '防いだHPダメージ', value: fmt(metric.prevented) });
  if (metric.tokensGranted || metric.tokensUsed) rows.push({ label: '無料券の獲得 / 使用', value: `${fmt(metric.tokensGranted)} / ${fmt(metric.tokensUsed)}回` });
  if (metric.score) rows.push({ label: '追加スコア', value: `＋${fmt(metric.score)}` });
  return rows;
}

function activity(metric: EffectMetric): { priority: number; amount: number; text: string } {
  // Priorities choose a readable sample, never combine unlike units into a score.
  if (metric.damage) return { priority: 6, amount: metric.damage, text: `発揮ダメージ差 ＋${fmt(metric.damage)}` };
  if (metric.addedInputs || metric.fuelUsed) return { priority: 5, amount: metric.addedInputs || metric.fuelUsed, text: metric.addedInputs ? `無料で${fmt(metric.addedInputs)}マス直接入力` : `自動入力を${fmt(metric.fuelUsed)}回使用` };
  if (metric.prevented) return { priority: 4, amount: metric.prevented, text: `HPダメージを${fmt(metric.prevented)}防御` };
  if (metric.tokensUsed || metric.tokensGranted) return { priority: 3, amount: metric.tokensUsed || metric.tokensGranted, text: `無料券 ${fmt(metric.tokensGranted)}回獲得 / ${fmt(metric.tokensUsed)}回使用` };
  if (metric.mana) return { priority: 2, amount: metric.mana, text: `追加の魔力 ＋${fmt(metric.mana)}` };
  if (metric.score) return { priority: 1, amount: metric.score, text: `追加スコア ＋${fmt(metric.score)}` };
  if (metric.fuelGranted) return { priority: 0, amount: metric.fuelGranted, text: `自動入力を${fmt(metric.fuelGranted)}回付与` };
  return { priority: -1, amount: 0, text: metric.opportunities ? 'この期間の効果は未発動' : 'この期間は発動機会なし' };
}

function metricList(rows: { label: string; value: string }[]): string {
  return `<dl class="contribution-metrics">${rows.map(row => `<div><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`).join('')}</dl>`;
}

export function contributionReport(run: Run, bossOnly = false): string {
  const total = contributionSummary(run, bossOnly), history = run.contributions;
  const entries = (Object.entries(total.relics) as [RelicId, EffectMetric][]).map(([id, metric]) => ({ id, metric, activity: activity(metric) }));
  entries.sort((a, b) => b.activity.priority - a.activity.priority || b.activity.amount - a.activity.amount || a.id.localeCompare(b.id));
  const highlights = entries.filter(entry => entry.activity.priority >= 0).slice(0, 3);
  const skills = [...new Set([...ownedSkills(run), ...Object.keys(total.skills) as SkillId[]])];
  const relicIds = [...new Set([...run.inventory, ...entries.map(entry => entry.id)])];
  return `<section class="contribution-report" aria-label="戦いの記録" data-window="${bossOnly ? 'boss' : 'recent'}">
    <div class="contribution-heading"><div><span class="micro">SPELL RECORD</span><h3>育てた力の、働き。</h3></div><div class="report-window" role="group" aria-label="記録の対象"><button data-report-window="recent" aria-pressed="${!bossOnly}">直近5戦</button><button data-report-window="boss" aria-pressed="${bossOnly}">このボス戦</button></div></div>
    <p class="report-sample">${total.battles}戦・${fmt(total.casts)}詠唱を集計${history?.partial ? ' · 旧保存からの再開後のみ' : ''}${total.casts < 10 ? ' · 少数サンプル' : ''}</p>
    <div class="report-totals"><div><span>HPに与えたダメージ</span><strong>${fmt(total.hpDamage)}</strong></div><div><span>超過ダメージ</span><strong>${fmt(total.overkill)}</strong></div><div><span>獲得スコア</span><strong>${fmt(total.score)}</strong></div></div>
    ${highlights.length ? `<ul class="report-highlights" aria-label="主な働き">${highlights.map(({ id, activity: value }) => `<li><span class="highlight-symbol">${relicOf(id).symbol}</span><span><b>${esc(relicOf(id).name)}</b><small>${esc(value.text)}</small></span></li>`).join('')}</ul>` : `<p class="report-empty">${total.casts ? '記録された効果はまだありません。発動機会と所持中の詠唱数も、詳細で確認できます。' : '計測は次の詠唱から始まります。以前の戦いの数値は推定しません。'}</p>`}
    <p class="report-caution">ダメージ差は超過分を含みます。遺物の発揮ダメージ差は「同じ経路から、その効果だけを外した差」です。効果が重なるため足し合わせず、100%の配分や強さの順位とは見ません。軽減量も効果を1つ外した差なので重なりがあり、合計しません。</p>
    <details class="contribution-details"><summary>すべての働きと、次の成長を見る <span>${skills.length}術式 / ${relicIds.length}遺物</span></summary>
      <h4>スキルの実績</h4><p class="report-explainer">そのスキルを装備して使用した詠唱全体の実績です。術師・遺物などの効果と超過分を含み、スキル単体が増やしたダメージではありません。通常詠唱は含みません。</p>
      <div class="contribution-items">${skills.map(id => {
        const item = skillOf(id), metric = total.skills[id], level = skillLevel(run, id);
        return `<article class="contribution-item" data-skill-report="${id}"><div class="contribution-item-heading"><span>${item.symbol}</span><h5>${esc(item.name)} <small>Lv.${level}</small></h5><b>${metric?.uses ?? 0}回使用</b></div>${metric?.uses ? metricList([{ label: '発揮ダメージ', value: fmt(metric.damage) }, { label: '1回あたりの平均', value: fmt(Math.round(metric.damage / metric.uses * 10) / 10) }, { label: '敵HP / 超過', value: `${fmt(metric.hpDamage)} / ${fmt(metric.overkill)}` }]) : '<p class="report-no-opportunity">この期間は未使用。弱いという意味ではありません。</p>'}<p class="report-next"><b>次の成長</b>${esc(skillNextDescription(run, id))}</p></article>`;
      }).join('')}</div>
      <h4>遺物の実績</h4><p class="report-explainer">自動入力は付与順で使用を記録。経路全体をその遺物の成果とは数えません。付与・使用回数と無料の直接入力は別の指標です。発動率は機会の数とあわせて見てください。</p>
      <div class="contribution-items">${relicIds.map(id => {
        const item = relicOf(id), metric = total.relics[id], rows = metric ? effectRows(metric) : [];
        return `<article class="contribution-item" data-relic-report="${id}"><div class="contribution-item-heading"><span>${item.symbol}</span><h5>${esc(item.name)} <small>Lv.${relicLevel(run, id)} · ${esc(relicTierLabel(run, id))}</small></h5></div><p class="effect-opportunities">所持中 ${metric?.heldCasts ?? 0}詠唱 · 機会 ${metric?.opportunities ?? 0}回 · 発動 ${metric?.triggers ?? 0}回${(metric?.opportunities ?? 0) < 10 ? ' · 少数サンプル' : ''}</p>${rows.length ? metricList(rows) : `<p class="report-no-opportunity">${!metric?.heldCasts ? 'この期間の所持中データはありません。' : !metric.opportunities ? '発動機会なし。効果が弱いという意味ではありません。' : '発動機会はありましたが、数値効果は記録されませんでした。'}</p>`}<p class="report-next"><b>次の成長</b>${esc(relicNextDescription(run, id))}</p></article>`;
      }).join('') || '<p class="report-empty">遺物を手に入れると、ここに記録されます。</p>'}</div>
      <p class="report-explainer">総ダメージ ${fmt(total.damage)} = 敵HP ${fmt(total.hpDamage)} + 超過 ${fmt(total.overkill)}。スコアは別集計です。記録開始は通算${fmt((history?.sinceCast ?? run.castCounter) + 1)}詠唱目から。</p>
    </details>
  </section>`;
}
