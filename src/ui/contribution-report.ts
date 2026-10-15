import { relicOf } from '../game/content';
import { ownedSkills, relicLevel, relicNextDescription, relicTierLabel, skillLevel, skillNextDescription, skillOf } from '../game/growth';
import type { BattleLedger, EffectMetric, RelicId, Run, SkillId, SkillMetric } from '../game/types';

const fmt = (n: number): string => n.toLocaleString('ja-JP');
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const emptyEffect = (): EffectMetric => ({ heldCasts: 0, opportunities: 0, triggers: 0, damage: 0, addedInputs: 0, fuelGranted: 0, fuelUsed: 0, mana: 0, prevented: 0, tokensGranted: 0, tokensUsed: 0, score: 0, healed: 0 });

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
      for (const key of Object.keys(entry) as (keyof EffectMetric)[]) entry[key] = (entry[key] ?? 0) + (value[key] ?? 0);
    }
  }
  return total;
}

export function effectRows(metric: EffectMetric): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (metric.damage) rows.push({ label: '同じ連鎖で増えたダメージ（超過含む）', value: `＋${fmt(metric.damage)}` });
  if (metric.fuelGranted || metric.fuelUsed) {
    rows.push({ label: '連鎖詠唱数の追加 / 消費', value: `${fmt(metric.fuelGranted)} / ${fmt(metric.fuelUsed)}` });
  }
  if (metric.addedInputs) rows.push({ label: '連鎖詠唱数を消費しない入力', value: `${fmt(metric.addedInputs)}マス` });
  if (metric.mana) rows.push({ label: '追加の魔力', value: `＋${fmt(metric.mana)}` });
  if (metric.healed) rows.push({ label: '反撃前に回復したHP', value: `＋${fmt(metric.healed)}` });
  if (metric.prevented) rows.push({ label: '防いだHPダメージ', value: fmt(metric.prevented) });
  if (metric.tokensGranted || metric.tokensUsed) rows.push({ label: '詠唱符の獲得 / 使用', value: `${fmt(metric.tokensGranted)} / ${fmt(metric.tokensUsed)}枚` });
  if (metric.score) rows.push({ label: '追加スコア', value: `＋${fmt(metric.score)}` });
  return rows;
}

function activity(metric: EffectMetric): { priority: number; amount: number; text: string } {
  // Priorities choose a readable sample, never combine unlike units into a score.
  if (metric.damage) return { priority: 6, amount: metric.damage, text: `同じ連鎖で増えたダメージ ＋${fmt(metric.damage)}` };
  if (metric.addedInputs || metric.fuelUsed) return { priority: 5, amount: metric.addedInputs || metric.fuelUsed, text: metric.addedInputs ? `連鎖詠唱数を消費せず${fmt(metric.addedInputs)}マス入力` : `連鎖詠唱数を${fmt(metric.fuelUsed)}消費` };
  if (metric.prevented) return { priority: 4, amount: metric.prevented, text: `HPダメージを${fmt(metric.prevented)}防御` };
  if (metric.healed) return { priority: 4, amount: metric.healed, text: `反撃前にHPを${fmt(metric.healed)}回復` };
  if (metric.tokensUsed || metric.tokensGranted) return { priority: 3, amount: metric.tokensUsed || metric.tokensGranted, text: `詠唱符 ${fmt(metric.tokensGranted)}枚獲得 / ${fmt(metric.tokensUsed)}枚使用` };
  if (metric.mana) return { priority: 2, amount: metric.mana, text: `追加の魔力 ＋${fmt(metric.mana)}` };
  if (metric.score) return { priority: 1, amount: metric.score, text: `追加スコア ＋${fmt(metric.score)}` };
  if (metric.fuelGranted) return { priority: 0, amount: metric.fuelGranted, text: `連鎖詠唱数＋${fmt(metric.fuelGranted)}` };
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
    <p class="report-sample">${total.battles}戦・${fmt(total.casts)}詠唱を集計${history?.partial ? ' · 記録開始後の詠唱のみ' : ''}${total.casts < 10 ? ' · 記録が少ないため参考値' : ''}</p>
    <div class="report-totals"><div><span>HPに与えたダメージ</span><strong>${fmt(total.hpDamage)}</strong></div><div><span>超過ダメージ</span><strong>${fmt(total.overkill)}</strong></div><div><span>獲得スコア</span><strong>${fmt(total.score)}</strong></div></div>
    ${highlights.length ? `<ul class="report-highlights" aria-label="主な働き">${highlights.map(({ id, activity: value }) => `<li><span class="highlight-symbol">${relicOf(id).symbol}</span><span><b>${esc(relicOf(id).name)}</b><small>${esc(value.text)}</small></span></li>`).join('')}</ul>` : `<p class="report-empty">${total.casts ? '記録された効果はまだありません。発動機会と所持中の詠唱数も、詳細で確認できます。' : '次の詠唱から記録します。記録開始前の戦いは含まれません。'}</p>`}
    <p class="report-caution">遺物で増えたダメージは、同じ連鎖でその遺物の効果がなかった場合との差です。敵の残りHPを超えた分も含みます。複数の効果が重なるため、各遺物の数値を足しても全体のダメージにはなりません。防いだHPダメージも同じ方法で比べているため、合計できません。</p>
    <details class="contribution-details"><summary>すべての働きと、次の成長を見る <span>${skills.length}術式 / ${relicIds.length}遺物</span></summary>
      <h4>スキルの実績</h4><p class="report-explainer">そのスキルを装備して使用した詠唱全体の実績です。術師・遺物などの効果と超過分を含み、スキル単体が増やしたダメージではありません。通常詠唱は含みません。</p>
      <div class="contribution-items">${skills.map(id => {
        const item = skillOf(id), metric = total.skills[id], level = skillLevel(run, id);
        return `<article class="contribution-item" data-skill-report="${id}"><div class="contribution-item-heading"><span>${item.symbol}</span><h5>${esc(item.name)} <small>Lv.${level}</small></h5><b>${metric?.uses ?? 0}回使用</b></div>${metric?.uses ? metricList([{ label: '発揮ダメージ', value: fmt(metric.damage) }, { label: '1回あたりの平均', value: fmt(Math.round(metric.damage / metric.uses * 10) / 10) }, { label: '敵HP / 超過', value: `${fmt(metric.hpDamage)} / ${fmt(metric.overkill)}` }]) : '<p class="report-no-opportunity">この期間は未使用。弱いという意味ではありません。</p>'}<p class="report-next"><b>次の成長</b>${esc(skillNextDescription(run, id))}</p></article>`;
      }).join('')}</div>
      <h4>遺物の実績</h4><p class="report-explainer">連鎖詠唱数は追加された順に消費し、どの遺物の分を使ったか記録します。追加された数・消費した数と、連鎖詠唱数を消費しない入力は分けて表示します。発動率は機会の数とあわせて見てください。</p>
      <div class="contribution-items">${relicIds.map(id => {
        const item = relicOf(id), metric = total.relics[id], rows = metric ? effectRows(metric) : [], held = run.inventory.includes(id), stowed = run.stowedRelics?.[id];
        const rank = held ? `Lv.${relicLevel(run, id)} · ${relicTierLabel(run, id)}` : stowed ? `保管中 · Lv.${stowed.level} · ${['通常', '上位', '極位'][stowed.tier - 1]}` : '手放した遺物';
        return `<article class="contribution-item" data-relic-report="${id}"><div class="contribution-item-heading"><span>${item.symbol}</span><h5>${esc(item.name)} <small>${esc(rank)}</small></h5></div><p class="effect-opportunities">所持中 ${metric?.heldCasts ?? 0}詠唱 · 機会 ${metric?.opportunities ?? 0}回 · 発動 ${metric?.triggers ?? 0}回${(metric?.opportunities ?? 0) < 10 ? ' · 記録が少ないため参考値' : ''}</p>${rows.length ? metricList(rows) : `<p class="report-no-opportunity">${!metric?.heldCasts ? 'この期間に所持していた記録はありません。' : !metric.opportunities ? '発動機会なし。効果が弱いという意味ではありません。' : '発動機会はありましたが、効果による数値の変化は記録されませんでした。'}</p>`}${held ? `<p class="report-next"><b>次の成長</b>${esc(relicNextDescription(run, id))}</p>` : `<p class="report-next">${stowed ? '報酬で再取得すると、保存したレベル・段階へ戻ります。' : '現在は所持していません。この期間に発揮した効果を表示しています。'}</p>`}</article>`;
      }).join('') || '<p class="report-empty">遺物を手に入れると、ここに記録されます。</p>'}</div>
      <p class="report-explainer">総ダメージ ${fmt(total.damage)} = 敵HP ${fmt(total.hpDamage)} + 超過 ${fmt(total.overkill)}。スコアは別集計です。記録開始は通算${fmt((history?.sinceCast ?? run.castCounter) + 1)}詠唱目から。</p>
    </details>
  </section>`;
}
