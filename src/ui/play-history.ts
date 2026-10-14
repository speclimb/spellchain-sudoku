import { characterOf, relicOf } from '../game/content';
import { skillOf } from '../game/growth';
import { HISTORY_LIMITS, historyCounts } from '../game/history';
import type { HistoryBattle, HistoryCast, HistoryRun, PlayHistory } from '../game/history';
import type { EffectMetric, RelicId } from '../game/types';
import { effectRows } from './contribution-report';
import { percentText, procEffect, procName } from './report-presentation';

const fmt = (n: number): string => n.toLocaleString('ja-JP');
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const BATTLES_PER_PAGE = 10, CASTS_PER_PAGE = 30;
export interface HistoryView { runKey?: string; page: number }
const metric = (value: Partial<EffectMetric> = {}): EffectMetric => ({ heldCasts: 0, opportunities: 0, triggers: 0, damage: 0, addedInputs: 0, fuelGranted: 0, fuelUsed: 0, mana: 0, prevented: 0, tokensGranted: 0, tokensUsed: 0, score: 0, ...value });
const rows = (values: { label: string; value: string }[]): string => `<dl class="history-metrics">${values.map(row => `<div><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`).join('')}</dl>`;
const runStatus = (run: HistoryRun): string => ({ battle: '冒険中', reward: '報酬選択中', lost: '敗北', won: '踏破', retired: '終了' })[run.status];
const battleStatus = (battle: HistoryBattle): string => ({ battle: '戦闘中', victory: '勝利', lost: '敗北', retired: '冒険終了' })[battle.status];
const castName = (cast: HistoryCast): string => cast.skillId ? `${skillOf(cast.skillId).name} Lv.${cast.skillLevel ?? 1}` : '通常詠唱';
export function selectedHistoryRun(history: PlayHistory | undefined, view: HistoryView): HistoryRun | undefined {
  return history?.runs.find(run => run.key === view.runKey) ?? history?.runs.at(-1);
}

/** History is read-only. Only the selected page and opened details are rendered. */
export function playHistory(history: PlayHistory | undefined, view: HistoryView): string {
  const run = selectedHistoryRun(history, view), counts = history ? historyCounts(history) : { battles: 0, casts: 0 };
  const runs = [...(history?.runs ?? [])].reverse();
  const pages = Math.max(1, Math.ceil((run?.battles.length ?? 0) / BATTLES_PER_PAGE));
  const page = Math.max(0, Math.min(view.page, pages - 1));
  const battles = [...(run?.battles ?? [])].reverse().slice(page * BATTLES_PER_PAGE, (page + 1) * BATTLES_PER_PAGE);
  const firstCast = run?.battles.find(battle => battle.casts.length)?.casts[0];
  const lastCast = [...(run?.battles ?? [])].reverse().find(battle => battle.casts.length)?.casts.at(-1);
  const omittedCasts = run?.battles.reduce((n, battle) => n + Math.max(0, battle.ledger.casts - battle.casts.length), 0) ?? 0;
  return `<button class="modal-close" data-action="close" aria-label="履歴を閉じる">×</button>
    <div class="modal-eyebrow">PLAY HISTORY</div><h2>プレイ履歴</h2>
    <p class="modal-intro">確定した詠唱と、選んだ報酬を振り返る。</p>
    <div class="history-toolbar"><label>冒険を選ぶ<select data-history-run aria-label="冒険を選ぶ" ${runs.length ? '' : 'disabled'}>${runs.length ? runs.map(item => `<option value="${esc(item.key)}" ${item.key === run?.key ? 'selected' : ''}>冒険 ${fmt(item.number)} · ${esc(characterOf(item.character).name)} · ${runStatus(item)}</option>`).join('') : '<option>まだ記録がありません</option>'}</select></label><button class="secondary" data-action="history-export" ${runs.length ? '' : 'disabled'}>JSONを保存</button></div>
    <p class="history-retention">保存中：${runs.length}冒険・${fmt(counts.battles)}戦・詠唱詳細${fmt(counts.casts)}件。新しい冒険を始めても、直近${HISTORY_LIMITS.runs}冒険・全冒険合計${HISTORY_LIMITS.battles}戦・${fmt(HISTORY_LIMITS.casts)}詠唱詳細を上限に保持します。大容量保存（IndexedDB）を使用します。安全上限は約${Math.round(HISTORY_LIMITS.bytes / 1024 / 1024)}MB。端末・ブラウザの空き容量によっては早く整理されます。古い記録から省略し、サイトデータ削除でも失われるため、大切な履歴はJSONを保存してください。</p>
    ${(history?.omittedRuns ?? 0) > 0 ? `<p class="history-notice">以前の${fmt(history!.omittedRuns)}冒険は保持範囲外です。</p>` : ''}
    ${history?.storageReduced ? '<p class="history-notice">保存容量に合わせて履歴を縮小しました。残っている記録だけを表示しています。</p>' : ''}
    ${run ? `<div class="history-run-heading"><h3>冒険 ${fmt(run.number)} <span>${esc(characterOf(run.character).name)}</span></h3><span class="history-status">${runStatus(run)}</span></div>
      <p class="history-range">保持範囲 · 戦闘：${run.battles.length ? `第${fmt(run.battles[0].stage + 1)}〜${fmt(run.battles.at(-1)!.stage + 1)}戦` : 'なし'}／詠唱詳細：${firstCast && lastCast ? `通算#${fmt(firstCast.id)}〜#${fmt(lastCast.id)}` : 'なし'}</p>
      <p class="history-scope">${run.partial ? '更新・記録再開後からの部分記録です。' : 'この冒険の開始から記録しています。'} 通算${fmt(run.sinceCast + 1)}詠唱目からが記録対象です。${run.partial ? '記録開始前の戦闘・詠唱の詳細は残っていません。' : ''}</p>
      ${run.omittedBattles || omittedCasts ? `<p class="history-notice">この冒険：古い${fmt(run.omittedBattles)}戦を省略。残っている戦闘内でも${fmt(omittedCasts)}詠唱の詳細を省略しています。戦闘の集計値は、その戦闘の記録期間全体の値です。</p>` : ''}
      <div class="history-list-heading"><h3>戦闘一覧 <small>新しい戦いから</small></h3><span>${fmt(run.battles.length)}戦を保持</span></div>
      <div class="history-battles">${battles.map(battle => `<details class="history-battle" data-history-battle="${battle.stage}"><summary><span class="history-battle-title"><strong>第${fmt(battle.stage + 1)}戦 · ${esc(battle.enemy)}</strong><span class="history-status ${battle.status}">${battle.boss ? 'ボス · ' : ''}${battleStatus(battle)}</span></span><span class="history-battle-stats">${fmt(battle.ledger.casts)}詠唱 · 最大${fmt(battle.maxChain)}連鎖<span>敵HPダメージ ${fmt(battle.ledger.hpDamage)}${battle.partial ? ' · 部分記録' : ''}</span></span></summary><div class="history-battle-content" data-history-content></div></details>`).join('') || '<p class="history-empty">まだ戦闘の記録がありません。次の詠唱から記録します。</p>'}</div>
      ${pages > 1 ? `<nav class="history-pagination" aria-label="戦闘一覧のページ"><button class="secondary" data-history-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>新しい戦いへ</button><span>${page + 1} / ${pages}</span><button class="secondary" data-history-page="${page + 1}" ${page === pages - 1 ? 'disabled' : ''}>古い戦いへ</button></nav>` : ''}` : '<p class="history-empty">まだプレイ履歴がありません。次の詠唱から記録します。更新前の戦闘や詠唱は再現できません。</p>'}
    <p class="history-export-note">JSONは、全冒険の保持されている履歴だけを出力します。省略した詠唱詳細や導入前の記録は含みません。盤面や連鎖経路のリプレイ用データも含みません。</p><button class="secondary history-close" data-action="close">元の画面へ戻る</button>`;
}

export function historyBattleDetails(battle: HistoryBattle, requestedPage = 0): string {
  const pages = Math.max(1, Math.ceil(battle.casts.length / CASTS_PER_PAGE));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  const casts = battle.casts.slice(page * CASTS_PER_PAGE, (page + 1) * CASTS_PER_PAGE);
  const omitted = Math.max(0, battle.ledger.casts - battle.casts.length);
  return `<p class="history-scope">${battle.partial ? 'この戦闘は途中からの部分記録です。' : '戦闘の記録期間全体の集計です。'} 詠唱詳細を省略しても、以下の集計には記録済みの全詠唱が含まれます。</p>
    ${rows([{ label: '合計ダメージ', value: fmt(battle.ledger.damage) }, { label: '敵HPに与えた分 / 超過', value: `${fmt(battle.ledger.hpDamage)} / ${fmt(battle.ledger.overkill)}` }, { label: '受けた反撃 / 実HP減少', value: `${fmt(battle.received)} / ${fmt(battle.hpLost)}` }, { label: '完成シート', value: `${fmt(battle.sheetsCompleted)}枚` }, { label: '獲得スコア', value: fmt(battle.ledger.score) }])}
    <details class="history-battle-effects"><summary>この戦闘のスキル・遺物の働き</summary>
      <p class="history-scope">この戦闘の記録期間全体を集計。スキルは選んだ詠唱全体の実績です。遺物のダメージ差は超過分を含む同経路の差で、相乗効果が重なるため足し合わせません。軽減量も合計しません。</p>
      <h5>スキルの使用</h5>${rows(Object.entries(battle.ledger.skills).map(([id, value]) => ({ label: skillOf(id as NonNullable<HistoryCast['skillId']>).name, value: `${fmt(value!.uses)}回 · 敵HP ${fmt(value!.hpDamage)}` })))}${Object.keys(battle.ledger.skills).length ? '' : '<p class="history-scope">記録期間中にスキルは使っていません。</p>'}
      <h5>遺物の働き</h5><div class="history-relics">${(Object.entries(battle.ledger.relics) as [RelicId, EffectMetric][]).map(([id, value]) => `<article class="history-relic" data-history-battle-relic="${id}"><h6>${esc(relicOf(id).name)}</h6><p class="history-scope">所持中 ${fmt(value.heldCasts)}詠唱 · 発動機会 ${fmt(value.opportunities)}回 · 発動 ${fmt(value.triggers)}回</p>${effectRows(value).length ? rows(effectRows(value)) : `<p class="history-scope">${value.opportunities ? '記録された数値効果はありません。' : '発動機会なし。効果が弱いという意味ではありません。'}</p>`}</article>`).join('') || '<p class="history-scope">記録された遺物の効果はありません。</p>'}</div>
    </details>
    <h4>選んだ報酬</h4>${battle.rewards.length ? `<ol class="history-rewards">${battle.rewards.map(reward => `<li><small>${reward.step === 'skill' ? '1/2 スキル' : reward.step === 'relic' && battle.boss ? '2/2 遺物' : '報酬'}</small><strong>${esc(reward.name)}</strong><p>${esc(reward.description)}</p></li>`).join('')}</ol>` : '<p class="history-scope">記録された報酬選択はありません。</p>'}
    <h4>詠唱の時系列 <small>古い詠唱から</small></h4>
    ${omitted ? `<p class="history-notice">古い${fmt(omitted)}詠唱の詳細は保持範囲外です。以下の${fmt(battle.casts.length)}件が残っています。</p>` : ''}
    <div class="history-casts">${casts.map(cast => `<details class="history-cast" data-history-cast="${cast.id}"><summary><strong>#${fmt(cast.id)} <span>${esc(castName(cast))}</span></strong><span>${fmt(cast.chain)}連鎖 · 敵HP ${fmt(cast.hpDamage)}${cast.sheetFrom !== cast.sheetTo ? ' · シート越え' : ''}</span></summary><div class="history-cast-content" data-history-content></div></details>`).join('') || '<p class="history-empty">保持されている詠唱詳細はありません。</p>'}</div>
    ${pages > 1 ? `<nav class="history-pagination" aria-label="詠唱のページ"><button class="secondary" data-history-casts-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>前の詠唱</button><span>${page + 1} / ${pages}</span><button class="secondary" data-history-casts-page="${page + 1}" ${page === pages - 1 ? 'disabled' : ''}>次の詠唱</button></nav>` : ''}`;
}

export function historyCastDetails(cast: HistoryCast): string {
  const quint = metric(cast.relics.quint?.metric), sept = metric(cast.relics.sept?.metric);
  const relics = Object.entries(cast.relics) as [RelicId, NonNullable<HistoryCast['relics'][RelicId]>][];
  return `<p class="history-scope">通算${fmt(cast.id)}詠唱目 · この戦闘の${fmt(cast.turn)}手目 · 術式 Lv.${cast.spellLevel}</p>
    ${rows([{ label: '詠唱', value: castName(cast) }, { label: '連鎖 / 完成シート', value: `${fmt(cast.chain)}連鎖 / ${fmt(cast.sheetsCompleted)}枚` }, { label: '冒険通算シート', value: cast.sheetFrom === cast.sheetTo ? String(cast.sheetFrom) : `${cast.sheetFrom} → ${cast.sheetTo}（シート越え）` }, { label: '合計ダメージ', value: fmt(cast.damage) }, { label: '敵HPに与えた分 / 超過', value: `${fmt(cast.hpDamage)} / ${fmt(cast.overkill)}` }, { label: '敵HP 前 → 後', value: `${fmt(cast.enemyBefore)} → ${fmt(cast.enemyAfter)}` }, { label: '反撃の攻撃力 / 守護', value: `${fmt(cast.incoming)} / ${fmt(cast.shield)}` }, { label: '受けた反撃 / 実HP減少', value: `${fmt(cast.received)} / ${fmt(cast.hpLost)}` }, { label: '生命力 前 → 後 / 回復', value: `${fmt(cast.hpBefore)} → ${fmt(cast.hpAfter)} / ＋${fmt(cast.healed)}` }, { label: '獲得スコア', value: fmt(cast.score) }])}
    <h5>魔力と蓄電</h5>${rows([{ label: 'スキルの支払い', value: !cast.skillId ? '通常詠唱（スキル消費なし）' : cast.freeSkill ? '無料券1枚を消費（魔力・蓄電を温存）' : '魔力8を消費' }, { label: '魔力 前 → 後', value: `${fmt(cast.manaBefore)} → ${fmt(cast.manaAfter)}` }, { label: '通常詠唱で増えた魔力', value: `＋${fmt(cast.charged)}` }, { label: '蓄電 前 → 後', value: `${fmt(cast.overflowBefore)} → ${fmt(cast.overflowAfter)}` }, { label: '有料スキル後、蓄電から戻った魔力', value: `＋${fmt(cast.overflowRestored)}` }])}
    <p class="history-scope">スキルの詠唱では充電しません。有料スキル後の魔力は、蓄電からの復帰と分けて記録しています。生命力の回復とは別の資源です。</p>
    <h5>無料券と、七の予約</h5>${rows([{ label: '無料券 発行 / 消費', value: `${fmt(quint.tokensGranted)} / ${fmt(quint.tokensUsed)}枚` }, { label: '無料券 保有 前 → 後', value: `${fmt(cast.tokensBefore)} → ${fmt(cast.tokensAfter)}枚` }, { label: '七の自動入力 予約付与 / 実使用', value: `${fmt(sept.fuelGranted)} / ${fmt(sept.fuelUsed)}回` }, { label: '七の予約 前 → 次の詠唱へ', value: `${fmt(cast.fuelBefore)} → ${fmt(cast.fuelAfter)}回` }])}
    <p class="history-scope">予約の付与と実使用は別です。予約があっても、連鎖の終了までにすべて使われるとは限りません。</p>
    <h5>護符の確定結果</h5>${cast.procs.length ? `<ul class="history-procs">${cast.procs.map(proc => `<li data-history-proc="${proc.id}"><strong>${esc(procName(proc.id))} · ${proc.triggered ? '発動' : '不発'}</strong><span>抽選時 ${percentText(proc.chance)}% · ${proc.triggered ? esc(procEffect(proc.id, proc.value)) : 'この抽選の効果なし'}</span></li>`).join('')}</ul>` : '<p class="history-scope">この詠唱に記録された護符の抽選はありません。対象なし・発動機会なしを、不発とは数えません。</p>'}
    <h5>この詠唱で所持していた遺物</h5><p class="history-scope">発揮ダメージ差は同じ経路からその効果だけを外した差で、超過分を含みます。相乗効果が重なるため足し合わせず、100%の配分にはしません。防いだHPダメージも合計しません。</p>
    <div class="history-relics">${relics.map(([id, entry]) => {
      const value = metric(entry.metric), effect = effectRows(value);
      return `<article class="history-relic" data-history-relic="${id}"><h6>${esc(relicOf(id).name)} <small>Lv.${entry.level} · ${entry.tier >= 3 ? '極位' : entry.tier === 2 ? '上位' : '通常'}</small></h6><p class="history-scope">所持中 ${fmt(value.heldCasts)}詠唱 · 発動機会 ${fmt(value.opportunities)}回 · 発動 ${fmt(value.triggers)}回</p>${effect.length ? rows(effect) : `<p class="history-scope">${value.opportunities ? 'この詠唱で記録された数値効果はありません。' : '発動機会なし。効果が弱いという意味ではありません。'}</p>`}</article>`;
    }).join('') || '<p class="history-scope">記録された遺物の効果はありません。</p>'}</div>`;
}

export function downloadPlayHistory(history: PlayHistory): void {
  const data = { format: 'spellchain-sudoku-play-history', version: 1, exportedAt: new Date().toISOString(), scope: '保持されている全冒険の履歴のみ', notes: ['省略済みの冒険・戦闘・詠唱詳細と導入前の記録は含みません。', '戦闘の集計は記録期間全体、castsは保持している詳細のみです。', '盤面・連鎖経路のリプレイ用データは含みません。', '遺物の発揮ダメージ差・軽減量は相乗効果が重なるため合計できません。'], limits: HISTORY_LIMITS, history };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `spellchain-history-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
