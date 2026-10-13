import { col, row } from '../game/sudoku';
import { chainCapacity } from '../game/engine';
import type { Report, Run } from '../game/types';

export const cellName = (cell: number): string => `${row(cell) + 1}行${col(cell) + 1}列`;
const unitName = (unit: number): string => unit < 9 ? `同じ行（${unit + 1}行目）` : unit < 18 ? `同じ列（${unit - 8}列目）` : '同じ3×3区画';

export function capacityText(run: Run, skill: boolean, report?: Report | null): string {
  const count = report?.chain?.initialAuto ?? chainCapacity(run, skill);
  const extra = run.inventory.includes('echo') || run.inventory.includes('rekindle');
  const maximum = Math.min(count + 1, run.cells.filter(value => !value).length);
  return `起点1マス ＋ 自動${count}回${extra ? '（遺物で追加あり）' : ` ＝ 最大${maximum}連鎖`}`;
}

export function stopText(report: Report): string {
  if (!report.chain) return '';
  switch (report.chain.stopReason) {
    case 'limit': return '自動入力の残りが0回になったので終了';
    case 'no-target': return `次につながる確定マスがないので終了（残り${report.chain.remainingAuto}回）`;
    case 'board-complete': return 'すべてのマスが埋まったので終了';
  }
}

/** The explanation consumes the simulation's trace; it never makes gameplay decisions. */
export function explainStep(report: Report, index: number): { title: string; detail: string; budget: string; note: string } {
  const trace = report.chain;
  if (!trace) return { title: '全体の予告', detail: '新しい起点を選ぶと、連鎖を順に確認できます。', budget: '', note: '' };
  const step = trace.steps[index], event = report.path[index];
  if (!step || !event) return {
    title: stopText(report),
    detail: trace.stopReason === 'no-target' ? '最後に埋めたマスと同じ行・列・3×3区画に、数字が1つに決まった空きマスがありません。他の場所に確定マスがあっても、ここからはつながりません。' : trace.stopReason === 'limit' ? '自動入力の回数を使い切りました。次につながるマスがあっても、この手はここまでです。起点を選び直すと、通るマスが変わります。' : report.defeated ? '盤面を完成させ、この攻撃で敵のHPも0になります。シート完成と敵撃破の両方で成長します。' : report.sheetAdvanced ? '盤面は完成しますが、敵のHPは残ります。反撃を受けた後に成長し、同じ敵との次のシートへ進みます。' : '盤面は完成しますが、敵の反撃でHPが尽きるため、ここで冒険が終わります。',
    budget: `自動入力 残り${trace.remainingAuto}回 · 合計${report.path.length}連鎖`,
    note: report.defeated ? `この${report.path.length}連鎖で敵を撃破。${report.sweep.length ? `残り${report.sweep.length}マスの一掃は連鎖に数えず、得点・魔力も増えません。` : ''}` : `連鎖の後に${report.damage}ダメージで攻撃し、反撃でHPが${report.received}減ります。`,
  };
  const certainty = step.initiallySingle ? 'このマスは、起点を入れる前から数字が確定していました。' : 'このマスは、ここまでの入力で数字が1つに確定しました。';
  const nearest = step.tiedCells.length > 1 ? '同じ近さの候補があるので、上の行、次に左の列を優先します。' : step.eligibleCells.length > 1 ? 'つながる候補のうち、縦の距離＋横の距離が最も短いマスです。' : 'ここからつながる確定マスは、この1つです。';
  const title = step.source === 'root' ? `起点：${cellName(step.cell)}に「${event.value}」` : step.source === 'echo' ? `共鳴石：同じ数字「${event.value}」へ飛び火` : `${step.sharedUnits.map(unitName).join('・')}でつながる`;
  const detail = step.source === 'root' ? report.skill ? '固有スキルで、選んだ空きマスを正解で埋めます。数字が未確定でも起点にできます。' : `行・列・3×3区画には同じ数字を置けません。このマスに入れられる数字は「${event.value}」だけなので、起点にできます。` : step.source === 'echo' ? `${cellName(step.from!)}から${cellName(step.cell)}へ。遺物の効果で、起点と同じ正解の数字を持つ近い空きマスを埋めます。次はこの飛び先から連鎖します。` : `${cellName(step.from!)} → ${cellName(step.cell)}に「${event.value}」。${certainty}${nearest}`;
  return {
    title, detail,
    budget: `自動入力 ${step.remainingBefore} → ${step.remainingAfter}回${step.source === 'chain' ? '（1回使う）' : '（回数を使わない）'}${step.addedAuto ? ' ＋ 再燃の輪で3回補充' : ''}`,
    note: step.source === 'root' ? `回数の内訳：${trace.bonuses.map(b => `${b.label}${b.amount}`).join(' ＋ ')}。起点自体も1連鎖に数えます。` : step.source === 'echo' ? `共鳴は行・列・区画や数字の確定に関係なく発動します。${step.tiedCells.length > 1 ? '同距離なら上・左を優先します。' : ''}` : '連鎖の基準は、毎回「直前に埋めたマス」に移ります。最初から確定していたマスにもつながります。',
  };
}
