import type { Preview } from '../game/types';

const fmt = (value: number): string => value.toLocaleString('ja-JP');
export const rangeText = (minimum: number, maximum = minimum): string => minimum === maximum ? fmt(minimum) : `${fmt(minimum)}〜${fmt(maximum)}`;

/** Preview wording is derived only from guaranteed bounds, never from a proc roll. */
export function retaliationText(report: Preview): string {
  const forecast = report.forecast;
  return forecast ? rangeText(forecast.receivedMin, forecast.receivedMax) : fmt(report.received);
}
export function outcomeText(report: Preview): string {
  const forecast = report.forecast;
  const parts: string[] = [];
  if (forecast?.kill === 'possible') parts.push('確率発動なら撃破');
  else if (forecast?.kill === 'guaranteed' || (!forecast && report.defeated)) parts.push('撃破確定');
  if (report.fullClear) parts.push(report.oneCastClear ? '一詠全成' : 'シート完成');
  if (forecast) {
    if (forecast.survival === 'possible') parts.push('不発時は生命力が尽きます');
    else if (forecast.survival === 'none') parts.push('反撃で生命力が尽きます');
    if (forecast.levelsGainedMax > 0) parts.push(`術式 ＋${rangeText(forecast.levelsGainedMin, forecast.levelsGainedMax)} Lv`);
    if (forecast.healedMax > 0) parts.push(`回復 ${rangeText(forecast.healedMin, forecast.healedMax)}`);
  } else {
    if ((report.levelsGained ?? 0) > 0) parts.push(`術式 Lv.${report.spellLevelAfter}へ`);
    if (report.healed > 0) parts.push(`回復 ${report.healed}`);
  }
  return parts.join(' · ');
}
export function accessiblePrediction(report: Preview): string {
  const chance = report.forecast;
  return `${report.path.length}連鎖、確定ダメージ${report.damage}${chance ? `、${Math.round(chance.chance * 100)}パーセントで${chance.damageMax}ダメージ` : ''}、被ダメージ${retaliationText(report)}。${outcomeText(report)}`;
}
export function damageBreakdown(report: Preview, preview = false): { label: string; value: string }[] {
  if (report.baseDamage === undefined) return [];
  const rows = [{ label: '基礎攻撃', value: fmt(report.baseDamage) }];
  if (preview && report.forecast) {
    rows.push({ label: `三の護符（${Math.round(report.forecast.chance * 100)}%）`, value: `発動時 ×${report.forecast.multiplier}` });
  } else if (report.proc) {
    rows.push({ label: `三の護符 · ${report.proc.triggered ? '発動' : '不発'}`, value: report.proc.triggered ? `×${report.proc.multiplier}` : '加算なし' });
  }
  if (report.fullClear) {
    const total = report.clearRatio ? Math.round(report.path.length / report.clearRatio) : 0;
    rows.push({ label: total ? `完成加算（25% × この手${report.path.length}/${total}マス）` : '完成加算', value: `＋${fmt(report.clearBonus ?? 0)}` });
  }
  rows.push({ label: preview ? '確定ダメージ' : '合計ダメージ', value: fmt(report.damage) });
  if (preview && report.forecast) rows.push({ label: '確率発動時のダメージ', value: fmt(report.forecast.damageMax) });
  return rows;
}
