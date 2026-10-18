import { col, row } from '../game/sudoku';
import { chainCapacity } from '../game/engine';
import type { Preview, Report, Run, SkillId } from '../game/types';
import { skillLevel, skillOf } from '../game/growth';
import { canRescueChain, RESCUE_COST, RESCUE_ITEM_LEVEL, RESCUE_ITEM_INTERVAL, rescueMilestonesAt } from '../game/endgame';
import { outcomeText, retaliationText } from './report-presentation';

export const cellName = (cell: number): string => `${row(cell) + 1}行${col(cell) + 1}列`;
const unitName = (unit: number): string => unit < 9 ? `同じ行（${unit + 1}行目）` : unit < 18 ? `同じ列（${unit - 8}列目）` : '同じ3×3区画';

export function capacityText(run: Run, skill: boolean, report?: Report | null, skillId: SkillId = run.character, useRescue = false): string {
  const count = report?.chain?.initialAuto ?? chainCapacity(run, skill, skillId);
  const extra = run.inventory.includes('echo') || run.inventory.includes('rekindle');
  const carry = (run.campaignVersion === 1 && run.spellLevel >= 30) || (run.inventory.includes('wick') && (run.tier.wick ?? 1) >= 2);
  const maximum = carry ? count + 1 : Math.min(count + 1, run.cells.filter(value => !value).length);
  const rescue = run.endgameBalanceVersion === 2
    ? ` · 接続の栞 ${run.rescueItems ?? 0}個（次は術式Lv.${RESCUE_ITEM_LEVEL + rescueMilestonesAt(run.spellLevel) * RESCUE_ITEM_INTERVAL}で1個）${canRescueChain(run) ? useRescue ? ` · この詠唱で使用・再接続時に1個と連鎖詠唱数${RESCUE_COST}を消費` : ' · 温存中（詠唱前に使用を選べます）' : ''}`
    : canRescueChain(run) ? ` · 接続救済1回（${RESCUE_COST}消費）` : '';
  return `起点1マス ＋ 連鎖詠唱数${count}${extra ? '（遺物で追加あり）' : ` ＝ 最大${maximum}連鎖`}${carry ? ' · 残り連鎖詠唱数を次のシートへ' : ''}${run.reservedAuto ? ` · 七の護符の追加＋${run.reservedAuto}を含む` : ''}${skill && skillId === 'fuse' && skillLevel(run, skillId) >= 2 ? ' · 行き止まりで飛び火あり' : ''}${skill && skillId === 'bridge' ? ' · 行き止まりから確定マスへ橋渡し' : ''}${rescue}`;
}

export function stopText(report: Report): string {
  if (!report.chain) return '';
  switch (report.chain.stopReason) {
    case 'limit': return '残り連鎖詠唱数が0になったので終了';
    case 'no-target': return `次につながる確定マスがないので終了（残り連鎖詠唱数${report.chain.remainingAuto}）`;
    case 'board-complete': return 'シートを完成させて終了';
  }
}

/** The explanation consumes the simulation's trace; it never makes gameplay decisions. */
export function explainStep(report: Preview, index: number): { title: string; detail: string; budget: string; note: string } {
  const trace = report.chain;
  if (!trace) return { title: '全体の予告', detail: '新しい起点を選ぶと、連鎖を順に確認できます。', budget: '', note: '' };
  const step = trace.steps[index], event = report.path[index];
  if (!step || !event) return {
    title: stopText(report),
    detail: trace.stopReason === 'no-target' ? '最後に埋めたマスと同じ行・列・3×3区画に、数字が1つに決まった空きマスがありません。他の場所に確定マスがあっても、ここからはつながりません。' : trace.stopReason === 'limit' ? '残り連鎖詠唱数を使い切りました。次につながるマスがあっても、この手はここまでです。起点を選び直すと、通るマスが変わります。' : report.forecast ? `盤面が完成し、完成加算が攻撃に加わります。${outcomeText(report)}。敵が生き残る場合だけ反撃を受けます。` : report.defeated ? '盤面を完成させ、この攻撃で敵のHPも0になります。シート完成と敵撃破の両方で成長します。' : report.sheetAdvanced ? '盤面は完成しますが、敵のHPは残ります。反撃を受けた後に成長し、同じ敵との次のシートへ進みます。' : '盤面は完成しますが、敵の反撃でHPが尽きるため、ここで冒険が終わります。',
    budget: `残り連鎖詠唱数 ${trace.remainingAuto} · 合計${report.path.length}連鎖`,
    note: report.forecast ? `確定${report.damage}ダメージ${report.forecast.damageMax !== report.damage ? `、確率発動で最大${report.forecast.damageMax}ダメージ` : ''}。被ダメージは${retaliationText(report)}。${outcomeText(report)}。` : report.defeated ? `この${report.path.length}連鎖で敵を撃破。${report.sweep.length ? `残り${report.sweep.length}マスの一掃は連鎖に数えず、得点・魔力も増えません。` : ''}` : `連鎖の後に${report.damage}ダメージで攻撃し、反撃でHPが${report.received}減ります。`,
  };
  if (step.sheetStart) return {
    title: `シート${event.sheet}へ連鎖を継続：${cellName(step.cell)}に「${event.value}」`,
    detail: '前のシートを完成させたので、残り連鎖詠唱数を次のシートへ引き継ぎます。新しいシートで最も長くつながる確定マスを選び、残り連鎖詠唱数を1消費して埋めます。同じ長さなら上・左を優先します。',
    budget: `残り連鎖詠唱数 ${step.remainingBefore} → ${step.remainingAfter}（1消費）${step.addedAuto ? ` ＋ ${step.addedAuto}補充` : ''}`,
    note: 'シートをまたいでも1回の詠唱です。攻撃と敵の反撃は、すべての連鎖が終わってから1回だけ。守護は新しいシートで積み直し、今回の反撃には詠唱中で最も高いシート守護を使います。',
  };
  const certainty = step.initiallySingle ? 'このマスは、起点を入れる前から数字が確定していました。' : 'このマスは、ここまでの入力で数字が1つに確定しました。';
  const nearest = step.tiedCells.length > 1 ? '同じ近さの候補があるので、上の行、次に左の列を優先します。' : step.eligibleCells.length > 1 ? 'つながる候補のうち、縦の距離＋横の距離が最も短いマスです。' : 'ここからつながる確定マスは、この1つです。';
  const title = step.rescue ? '接続救済：離れた確定マスへ再接続' : step.bridge ? `${skillOf('bridge').name}：離れた確定マスへ橋渡し` : step.hop ? `星火連環：同じ数字「${event.value}」へ飛び火` : step.source === 'root' ? `起点：${cellName(step.cell)}に「${event.value}」` : step.source === 'echo' ? `共鳴石：同じ数字「${event.value}」へ飛び火` : `${step.sharedUnits.map(unitName).join('・')}でつながる`;
  const detail = step.rescue ? `${cellName(step.from!)}で連鎖が行き止まりになったため、残り連鎖詠唱数を${RESCUE_COST}消費し、最も近い確定マス${cellName(step.cell)}へ再接続します。この消費には移動先の入力1マスを含みます。` : step.bridge ? `${cellName(step.from!)}で連鎖が行き止まりになったため、残り連鎖詠唱数を1消費し、離れた確定マス${cellName(step.cell)}へ橋渡しして連鎖を続けます。` : step.hop ? `${cellName(step.from!)}で連鎖が行き止まりになったため、残り連鎖詠唱数を1消費して${cellName(step.cell)}へ。直前のマスと同じ数字の空きマスへ飛び、そこから連鎖を続けます。` : step.source === 'root' ? report.skill ? '選んだスキルで、空きマスを正解で埋めます。数字が未確定でも起点にできます。' : `行・列・3×3区画には同じ数字を置けません。このマスに入れられる数字は「${event.value}」だけなので、起点にできます。` : step.source === 'echo' ? `${cellName(step.from!)}から${cellName(step.cell)}へ。連鎖詠唱数を消費せず、起点と同じ正解の数字を持つ近い空きマスを埋めます。次はこの飛び先から連鎖します。` : `${cellName(step.from!)} → ${cellName(step.cell)}に「${event.value}」。${certainty}${nearest}`;
  return {
    title: (report.segments?.length ?? 0) > 1 ? `シート${event.sheet} · ${title}` : title, detail,
    budget: `残り連鎖詠唱数 ${step.remainingBefore} → ${step.remainingAfter}${step.source === 'chain' ? `（${step.rescue ? RESCUE_COST : 1}消費）` : '（連鎖詠唱数を消費しない）'}${step.addedAuto ? ` ＋ 再燃の輪で${step.addedAuto}補充` : ''}`,
    note: step.rescue ? `${report.rescueItemsBefore !== undefined ? '接続の栞を1個消費。' : ''}接続救済は1詠唱に1回。シートをまたいでも補充せず、追撃は発生しません。同距離なら上・左を優先します。` : step.bridge ? '橋渡しの回数はスキルレベルで決まります。確定マスの中から近さ、上・左の順で選びます。' : step.hop ? `スキルの飛び火は1手に最大${(report.skillLevel ?? 2) >= 10 ? 3 : (report.skillLevel ?? 2) >= 5 ? 2 : 1}回。最も近い同じ数字へ進み、同距離なら上・左を優先します。` : step.source === 'root' ? `連鎖詠唱数の内訳：${trace.bonuses.map(b => `${b.label}${b.amount}`).join(' ＋ ')}。起点は連鎖詠唱数を消費せず、実際の連鎖数には1連鎖として数えます。` : step.source === 'echo' ? `共鳴は行・列・区画や数字の確定に関係なく発動します。${step.tiedCells.length > 1 ? '同距離なら上・左を優先します。' : ''}` : '連鎖の基準は、毎回「直前に埋めたマス」に移ります。最初から確定していたマスにもつながります。',
  };
}
