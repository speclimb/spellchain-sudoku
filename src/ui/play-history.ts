import { formatNumber as fmt, formatEffectText } from '../format-number';
import { APP_BUILD } from '../build-version';
import { characterOf, relicOf } from '../game/content';
import { skillOf } from '../game/growth';
import { HISTORY_LIMITS, historyCounts } from '../game/history';
import type { HistoryBattle, HistoryCast, HistoryRun, PlayHistory } from '../game/history';
import type { EffectMetric, RelicId } from '../game/types';
import { effectRows } from './contribution-report';
import { historicalRewardDescription } from './display-wording';
import { percentText, procEffect, procName } from './report-presentation';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const versionText = (version?: string): string => esc(version ?? '不明（旧記録）');
const versionsText = (item: { gameVersions?: string[]; versionHistoryPartial?: boolean }): string =>
  `${item.gameVersions?.length ? item.gameVersions.map(versionText).join(' / ') : '不明（旧記録）'}${item.gameVersions?.length && item.versionHistoryPartial ? ' / 以前のバージョンは不明' : ''}`;
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

export function historyBuild(run: HistoryRun): string {
  const live = run.status === 'battle' || run.status === 'reward', build = run.build;
  const title = live ? '最新記録時点の構成' : '冒険終了時の構成';
  if (!build) return `<section class="history-build"><h3>${title}</h3><p class="history-notice">この履歴には構成の記録がありません。古い報酬や詠唱から最終構成を推測して表示することはありません。</p></section>`;
  const skills = (role: 'intrinsic' | 'equipped' | 'reserve') => build.skills.filter(item => item.role === role).map(item =>
    `<li data-build-skill="${item.id}"><details><summary><strong>${esc(item.name)}</strong><span>Lv.${item.level} · ${['通常', '進化', '最終進化'][item.evolution - 1]}</span></summary><p>記録時の効果：${esc(formatEffectText(item.description))}</p></details></li>`).join('');
  return `<section class="history-build" aria-label="${title}"><h3>${title}</h3>
    <p class="history-scope">第${fmt(build.stage + 1)}戦 · 通算${fmt(build.cast)}詠唱後 · 術式 Lv.${fmt(build.spellLevel)}${live ? '。冒険が進むと更新されます。' : '。'} 戦闘一覧で開いた戦闘の時点とは異なります。名前を開くと記録時の効果を確認できます。</p>
    <p class="history-version">構成記録版：${versionText(build.gameVersion)}</p>
    <h4>所持遺物 <small>${build.relics.length}個</small></h4>
    <ul class="history-build-grid">${build.relics.map(item => `<li data-build-relic="${item.id}"><details><summary><strong>${esc(item.name)}</strong><span>Lv.${item.level} · ${['通常', '上位', '極位'][item.tier - 1]}</span></summary><p>記録時の効果：${esc(formatEffectText(item.description))}</p></details></li>`).join('') || '<li class="history-build-empty">所持している遺物はありません。</li>'}</ul>
    <h4>固有スキル</h4><ul class="history-build-grid">${skills('intrinsic')}</ul>
    <h4>追加装備スキル <small>${build.skills.filter(item => item.role === 'equipped').length} / 2</small></h4><ul class="history-build-grid">${skills('equipped') || '<li class="history-build-empty">追加装備なし</li>'}</ul>
    ${build.skills.some(item => item.role === 'reserve') ? `<h4>習得済み・未装備</h4><ul class="history-build-grid">${skills('reserve')}</ul>` : ''}
  </section>`;
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
    <p class="history-retention">保存中：${runs.length}冒険・${fmt(counts.battles)}戦・詠唱詳細${fmt(counts.casts)}件。新しい冒険を始めても、直近${HISTORY_LIMITS.runs}冒険・全冒険合計${HISTORY_LIMITS.battles}戦・${fmt(HISTORY_LIMITS.casts)}詠唱詳細を上限に保持します。履歴の保存容量は最大約${Math.round(HISTORY_LIMITS.bytes / 1024 / 1024)}MB。端末・ブラウザの空き容量によっては早く整理されます。古い記録から省略し、サイトデータ削除でも失われるため、大切な履歴はJSONを保存してください。</p>
    ${(history?.omittedRuns ?? 0) > 0 ? `<p class="history-notice">以前の${fmt(history!.omittedRuns)}冒険は保持範囲外です。</p>` : ''}
    ${history?.storageReduced ? '<p class="history-notice">保存容量に合わせて履歴を縮小しました。残っている記録だけを表示しています。</p>' : ''}
    ${run ? `<div class="history-run-heading"><h3>冒険 ${fmt(run.number)} <span>${esc(characterOf(run.character).name)}</span></h3><span class="history-status">${runStatus(run)}</span></div>
      <p class="history-range">保持範囲 · 戦闘：${run.battles.length ? `第${fmt(run.battles[0].stage + 1)}〜${fmt(run.battles.at(-1)!.stage + 1)}戦` : 'なし'}／詠唱詳細：${firstCast && lastCast ? `通算#${fmt(firstCast.id)}〜#${fmt(lastCast.id)}` : 'なし'}</p>
      <p class="history-scope">${run.partial ? '記録を始めた時点からの部分記録です。' : 'この冒険の開始から記録しています。'} 通算${fmt(run.sinceCast + 1)}詠唱目からが記録対象です。${run.partial ? '記録開始前の戦闘・詠唱の詳細は残っていません。' : ''}</p>
      ${run.omittedBattles || omittedCasts ? `<p class="history-notice">この冒険：古い${fmt(run.omittedBattles)}戦を省略。残っている戦闘内でも${fmt(omittedCasts)}詠唱の詳細を省略しています。戦闘の集計値は、その戦闘の記録期間全体の値です。</p>` : ''}
      <p class="history-version">冒険開始版：${versionText(run.startedGameVersion)}<br>プレイした版：${versionsText(run)}</p>
      ${historyBuild(run)}
      <div class="history-list-heading"><h3>戦闘一覧 <small>新しい戦いから</small></h3><span>${fmt(run.battles.length)}戦を保持</span></div>
      <div class="history-battles">${battles.map(battle => `<details class="history-battle" data-history-battle="${battle.stage}"><summary><span class="history-battle-title"><strong>第${fmt(battle.stage + 1)}戦 · ${esc(battle.enemy)}</strong><span class="history-status ${battle.status}">${battle.boss ? 'ボス · ' : ''}${battleStatus(battle)}</span></span><span class="history-battle-stats">${fmt(battle.ledger.casts)}詠唱 · 最大${fmt(battle.maxChain)}連鎖<span>敵HPダメージ ${fmt(battle.ledger.hpDamage)}${battle.partial ? ' · 部分記録' : ''}</span></span></summary><div class="history-battle-content" data-history-content></div></details>`).join('') || '<p class="history-empty">まだ戦闘の記録がありません。次の詠唱から記録します。</p>'}</div>
      ${pages > 1 ? `<nav class="history-pagination" aria-label="戦闘一覧のページ"><button class="secondary" data-history-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>新しい戦いへ</button><span>${page + 1} / ${pages}</span><button class="secondary" data-history-page="${page + 1}" ${page === pages - 1 ? 'disabled' : ''}>古い戦いへ</button></nav>` : ''}` : '<p class="history-empty">まだプレイ履歴がありません。次の詠唱から記録します。記録開始前の戦闘や詠唱は含まれません。</p>'}
    <p class="history-export-note">JSONは、全冒険の保持されている履歴だけを出力します。省略した詠唱詳細と、記録開始前の戦闘・詠唱は含みません。盤面や連鎖経路のリプレイ用データも含みません。</p><button class="secondary history-close" data-action="close">元の画面へ戻る</button>`;
}

export function historyBattleDetails(battle: HistoryBattle, requestedPage = 0): string {
  const pages = Math.max(1, Math.ceil(battle.casts.length / CASTS_PER_PAGE));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  const casts = battle.casts.slice(page * CASTS_PER_PAGE, (page + 1) * CASTS_PER_PAGE);
  const omitted = Math.max(0, battle.ledger.casts - battle.casts.length);
  return `<p class="history-version">この戦闘でプレイした版：${versionsText(battle)}</p><p class="history-scope">${battle.partial ? 'この戦闘は途中からの部分記録です。' : '戦闘の記録期間全体の集計です。'} 詠唱詳細を省略しても、以下の集計には記録済みの全詠唱が含まれます。</p>
    ${rows([{ label: '合計ダメージ', value: fmt(battle.ledger.damage) }, { label: '敵HPに与えた分 / 超過', value: `${fmt(battle.ledger.hpDamage)} / ${fmt(battle.ledger.overkill)}` }, { label: '受けた反撃 / 実HP減少', value: `${fmt(battle.received)} / ${fmt(battle.hpLost)}` }, { label: '完成シート', value: `${fmt(battle.sheetsCompleted)}枚` }, { label: '獲得スコア', value: fmt(battle.ledger.score) }])}
    <details class="history-battle-effects"><summary>この戦闘のスキル・遺物の働き</summary>
      <p class="history-scope">この戦闘の記録期間全体を集計。スキルは選んだ詠唱全体の実績です。遺物で増えたダメージは、同じ連鎖でその効果がなかった場合との差です。敵の残りHPを超えた分も含みます。効果が重なるため、ダメージ差も軽減量も合計できません。</p>
      <h5>スキルの使用</h5>${rows(Object.entries(battle.ledger.skills).map(([id, value]) => ({ label: skillOf(id as NonNullable<HistoryCast['skillId']>).name, value: `${fmt(value!.uses)}回 · 敵HP ${fmt(value!.hpDamage)}` })))}${Object.keys(battle.ledger.skills).length ? '' : '<p class="history-scope">記録期間中にスキルは使っていません。</p>'}
      <h5>遺物の働き</h5><div class="history-relics">${(Object.entries(battle.ledger.relics) as [RelicId, EffectMetric][]).map(([id, value]) => `<article class="history-relic" data-history-battle-relic="${id}"><h6>${esc(relicOf(id).name)}</h6><p class="history-scope">所持中 ${fmt(value.heldCasts)}詠唱 · 発動機会 ${fmt(value.opportunities)}回 · 発動 ${fmt(value.triggers)}回</p>${effectRows(value).length ? rows(effectRows(value)) : `<p class="history-scope">${value.opportunities ? '効果による数値の変化は記録されていません。' : '発動機会なし。効果が弱いという意味ではありません。'}</p>`}</article>`).join('') || '<p class="history-scope">記録された遺物の効果はありません。</p>'}</div>
    </details>
    <h4>選んだ報酬</h4>${battle.rewards.length ? `<ol class="history-rewards">${battle.rewards.map(reward => `<li><small>${reward.step === 'skill' ? '1/2 スキル' : reward.step === 'relic' && battle.boss ? '2/2 遺物' : '報酬'}</small><strong>${esc(reward.name)}</strong><p class="history-version">報酬選択版：${versionText(reward.gameVersion)}</p><p>当時の効果：${esc(formatEffectText(historicalRewardDescription(reward.description)))}</p></li>`).join('')}</ol>` : '<p class="history-scope">記録された報酬選択はありません。</p>'}
    <h4>詠唱の時系列 <small>古い詠唱から</small></h4>
    ${omitted ? `<p class="history-notice">古い${fmt(omitted)}詠唱の詳細は保持範囲外です。以下の${fmt(battle.casts.length)}件が残っています。</p>` : ''}
    <div class="history-casts">${casts.map(cast => `<details class="history-cast" data-history-cast="${cast.id}"><summary><strong>#${fmt(cast.id)} <span>${esc(castName(cast))}</span></strong><span>${fmt(cast.chain)}連鎖 · 敵HP ${fmt(cast.hpDamage)}${cast.sheetFrom !== cast.sheetTo ? ' · シート越え' : ''}</span></summary><div class="history-cast-content" data-history-content></div></details>`).join('') || '<p class="history-empty">保持されている詠唱詳細はありません。</p>'}</div>
    ${pages > 1 ? `<nav class="history-pagination" aria-label="詠唱のページ"><button class="secondary" data-history-casts-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>前の詠唱</button><span>${page + 1} / ${pages}</span><button class="secondary" data-history-casts-page="${page + 1}" ${page === pages - 1 ? 'disabled' : ''}>次の詠唱</button></nav>` : ''}`;
}

export function historyCastDetails(cast: HistoryCast): string {
  const quint = metric(cast.relics.quint?.metric), sept = metric(cast.relics.sept?.metric);
  const relics = Object.entries(cast.relics) as [RelicId, NonNullable<HistoryCast['relics'][RelicId]>][];
  const rescue = cast.rescueItemsBefore === undefined ? '' : `<h5>接続の栞</h5>${rows([
    { label: '詠唱前の指定', value: cast.rescueRequested === undefined ? '旧記録（使用指定の記録なし）' : cast.rescueRequested ? '接続救済に使う（必要な場合だけ消費）' : '温存する' },
    { label: '所持 前 → 後', value: `${fmt(cast.rescueItemsBefore)} → ${fmt(cast.rescueItemsAfter ?? 0)}個` },
    { label: '成長で獲得 / 接続救済で使用', value: `${fmt(cast.rescueItemsGranted ?? 0)} / ${fmt(cast.rescueItemsBefore + (cast.rescueItemsGranted ?? 0) - (cast.rescueItemsAfter ?? 0))}個` },
  ])}`;
  return `<p class="history-version">詠唱実行版：${versionText(cast.gameVersion)}</p><p class="history-scope">通算${fmt(cast.id)}詠唱目 · この戦闘の${fmt(cast.turn)}手目 · 術式 Lv.${cast.spellLevel}</p>
    ${rows([{ label: '詠唱', value: castName(cast) }, { label: '連鎖 / 完成シート', value: `${fmt(cast.chain)}連鎖 / ${fmt(cast.sheetsCompleted)}枚` }, { label: '冒険通算シート', value: cast.sheetFrom === cast.sheetTo ? String(cast.sheetFrom) : `${cast.sheetFrom} → ${cast.sheetTo}（シート越え）` }, { label: '合計ダメージ', value: fmt(cast.damage) }, { label: '敵HPに与えた分 / 超過', value: `${fmt(cast.hpDamage)} / ${fmt(cast.overkill)}` }, { label: '敵HP 前 → 後', value: `${fmt(cast.enemyBefore)} → ${fmt(cast.enemyAfter)}` }, { label: '反撃の攻撃力 / 守護', value: `${fmt(cast.incoming)} / ${fmt(cast.shield)}` }, { label: '受けた反撃 / 実HP減少', value: `${fmt(cast.received)} / ${fmt(cast.hpLost)}` }, { label: '生命力 前 → 後 / 回復', value: `${fmt(cast.hpBefore)} → ${fmt(cast.hpAfter)} / ＋${fmt(cast.healed)}${cast.relicHealed ? `（反撃前 ${fmt(cast.relicHealed)}・成長 ${fmt(cast.healed - cast.relicHealed)}）` : ''}` }, { label: '獲得スコア', value: fmt(cast.score) }])}
    <h5>魔力と蓄電</h5>${rows([{ label: '詠唱に使ったもの', value: !cast.skillId ? '通常詠唱（魔力・詠唱符の消費なし）' : cast.freeSkill ? '詠唱符1枚を消費（魔力・蓄電の消費なし）' : '魔力8を消費' }, { label: '魔力 前 → 後', value: `${fmt(cast.manaBefore)} → ${fmt(cast.manaAfter)}` }, { label: '通常詠唱で増えた魔力', value: `＋${fmt(cast.charged)}` }, { label: '蓄電 前 → 後', value: `${fmt(cast.overflowBefore)} → ${fmt(cast.overflowAfter)}` }, { label: '魔力を消費するスキルの詠唱後、蓄電から戻った魔力', value: `＋${fmt(cast.overflowRestored)}` }])}
    <p class="history-scope">詠唱符は1枚でスキルを詠唱し、魔力・蓄電を消費しません。魔力より先に使います。スキルの詠唱では充電せず、魔力を消費するスキルの詠唱後は蓄電を魔力に戻します。</p>${rescue}
    <h5>詠唱符と、次の詠唱の連鎖詠唱数</h5>${rows([{ label: '詠唱符 獲得 / 使用', value: `${fmt(quint.tokensGranted)} / ${fmt(quint.tokensUsed)}枚` }, { label: '詠唱符 所持 前 → 後', value: `${fmt(cast.tokensBefore)} → ${fmt(cast.tokensAfter)}枚` }, { label: '七の護符の連鎖詠唱数 追加 / 消費', value: `${fmt(sept.fuelGranted)} / ${fmt(sept.fuelUsed)}` }, { label: '七の護符の連鎖詠唱数 詠唱前 → 次の詠唱へ', value: `${fmt(cast.fuelBefore)} → ${fmt(cast.fuelAfter)}` }])}
    <p class="history-scope">七の護符で追加された連鎖詠唱数は、次の詠唱で使えます。連鎖が途中で終わると、追加した連鎖詠唱数を使い切らないことがあります。</p>
    <h5>護符の確定結果</h5>${cast.procs.length ? `<ul class="history-procs">${cast.procs.map(proc => `<li data-history-proc="${proc.id}"><strong>${esc(procName(proc.id))} · ${proc.triggered ? '発動' : '不発'}</strong><span>抽選時 ${percentText(proc.chance)}% · ${proc.triggered ? esc(procEffect(proc.id, proc.value)) : 'この抽選の効果なし'}</span></li>`).join('')}</ul>` : '<p class="history-scope">この詠唱に記録された護符の抽選はありません。対象なし・発動機会なしを、不発とは数えません。</p>'}
    <h5>この詠唱で所持していた遺物</h5><p class="history-scope">遺物で増えたダメージは、同じ連鎖でその効果がなかった場合との差です。敵の残りHPを超えた分も含みます。効果が重なるため、ダメージ差も防いだHPダメージも合計できません。</p>
    <div class="history-relics">${relics.map(([id, entry]) => {
      const value = metric(entry.metric), effect = effectRows(value);
      return `<article class="history-relic" data-history-relic="${id}"><h6>${esc(relicOf(id).name)} <small>Lv.${entry.level} · ${entry.tier >= 3 ? '極位' : entry.tier === 2 ? '上位' : '通常'}</small></h6><p class="history-scope">所持中 ${fmt(value.heldCasts)}詠唱 · 発動機会 ${fmt(value.opportunities)}回 · 発動 ${fmt(value.triggers)}回</p>${effect.length ? rows(effect) : `<p class="history-scope">${value.opportunities ? 'この詠唱では、効果による数値の変化は記録されていません。' : '発動機会なし。効果が弱いという意味ではありません。'}</p>`}</article>`;
    }).join('') || '<p class="history-scope">記録された遺物の効果はありません。</p>'}</div>`;
}

export function downloadPlayHistory(history: PlayHistory): void {
  const data = { format: 'spellchain-sudoku-play-history', version: 1, exportedByVersion: APP_BUILD.id, exportedAt: new Date().toISOString(), scope: '保持されている全冒険の履歴のみ', notes: ['gameVersionは実行・構成記録時の版。startedGameVersionは冒険開始版。gameVersionsは使用版の集合。欠測は不明で、exportedByVersionとは異なります。', '省略された記録と、記録開始前の戦闘・詠唱は含みません。', '戦闘の集計は記録期間全体、詠唱の詳細は保存されている分だけを含みます。', '構成は冒険終了時（進行中は最新記録時点）の保存値です。buildがない古い履歴の構成は不明です。', '構成の名前・効果説明は記録時に保存し、後のバランス変更では再計算しません。', '盤面・連鎖経路のリプレイ用データは含みません。', '遺物で増えたダメージと軽減量は、効果が重なるため合計できません。'], limits: HISTORY_LIMITS, history };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `spellchain-history-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
