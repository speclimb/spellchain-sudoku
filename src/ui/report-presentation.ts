import type { Preview, PrimeRelicId } from '../game/types';

export const percentText = (value: number): string => String(Number((value * 100).toFixed(3)));
const fmt = (value: number): string => value.toLocaleString('ja-JP');
export const rangeText = (minimum: number, maximum = minimum): string => minimum === maximum ? fmt(minimum) : `${fmt(minimum)}〜${fmt(maximum)}`;
export const procName = (id: PrimeRelicId): string => ({ duality: '二の護符', trinity: '三の護符', quint: '五の護符', sept: '七の護符' })[id];
export function procEffect(id: PrimeRelicId, value: number): string {
  return id === 'trinity' ? `基礎攻撃 ×${value}` : id === 'duality' ? `守護後の反撃を${percentText(value)}%軽減（祝福と合計60%まで）` : id === 'quint' ? `無料スキル ＋${value}回（次の手から）` : `次の手の自動入力 ＋${value}回`;
}

/** Preview wording is derived only from guaranteed bounds, never from a proc roll. */
export function retaliationText(report: Preview): string {
  const forecast = report.forecast;
  return forecast ? rangeText(forecast.receivedMin, forecast.receivedMax) : fmt(report.received);
}
export function healingText(report: Preview): string {
  const beforeCounter = report.relicHealed ?? 0;
  const minimum = Math.max(0, (report.forecast?.healedMin ?? report.healed) - beforeCounter);
  const maximum = Math.max(0, (report.forecast?.healedMax ?? report.healed) - beforeCounter);
  return [beforeCounter ? `反撃前回復 ＋${fmt(beforeCounter)}` : '', maximum ? `成長回復 ＋${rangeText(minimum, maximum)}` : ''].filter(Boolean).join(' · ');
}
export function outcomeText(report: Preview): string {
  const forecast = report.forecast;
  const parts: string[] = [];
  if (forecast?.kill === 'possible') parts.push('確率発動なら撃破');
  else if (forecast?.kill === 'guaranteed' || (!forecast && report.defeated)) parts.push('撃破確定');
  const completed = report.sheetsCompleted ?? (report.fullClear ? 1 : 0);
  const oneCast = report.segments?.filter(segment => segment.oneCastClear).length ?? (report.oneCastClear ? 1 : 0);
  if (completed > 1) parts.push(`${completed}シート完成${oneCast ? `（一詠全成 ${oneCast}枚）` : ''}`);
  else if (completed) parts.push(oneCast ? '一詠全成' : 'シート完成');
  if (forecast) {
    if (forecast.survival === 'possible') parts.push('不発時は生命力が尽きます');
    else if (forecast.survival === 'none') parts.push('反撃で生命力が尽きます');
    if (forecast.levelsGainedMax > 0) parts.push(`術式 ＋${rangeText(forecast.levelsGainedMin, forecast.levelsGainedMax)} Lv`);
  } else {
    if ((report.levelsGained ?? 0) > 0) parts.push(`術式 Lv.${report.spellLevelAfter}へ`);
  }
  const healing = healingText(report);
  if (healing) parts.push(healing);
  return parts.join(' · ');
}
export function accessiblePrediction(report: Preview): string {
  const forecast = report.forecast;
  const effects = forecast?.procs?.map(proc => `${procName(proc.id)}は${percentText(proc.chance)}パーセントで${procEffect(proc.id, proc.value)}`).join('。');
  return `${report.path.length}連鎖、確定ダメージ${report.damage}${forecast && forecast.damageMax !== report.damage ? `、最大${forecast.damageMax}ダメージ` : ''}、被ダメージ${retaliationText(report)}。${outcomeText(report)}${effects ? `。${effects}` : ''}`;
}
export function damageBreakdown(report: Preview, preview = false): { label: string; value: string }[] {
  if (report.baseDamage === undefined) return [];
  const rows = [{ label: '基礎攻撃', value: fmt(report.baseDamage) }];
  if (preview && report.forecast) {
    if (report.forecast.procs?.length) {
      for (const proc of report.forecast.procs) rows.push({ label: `${procName(proc.id)}（${percentText(proc.chance)}%）`, value: procEffect(proc.id, proc.value) });
    } else if (report.forecast.chance) rows.push({ label: `三の護符（${percentText(report.forecast.chance)}%）`, value: `発動時 ×${report.forecast.multiplier}` });
  } else if (report.procs?.length) {
    for (const proc of report.procs) rows.push({ label: `${procName(proc.id)} · ${proc.triggered ? '発動' : '不発'}`, value: proc.triggered ? procEffect(proc.id, proc.value) : '効果なし' });
  } else if (report.proc) {
    rows.push({ label: `三の護符 · ${report.proc.triggered ? '発動' : '不発'}`, value: report.proc.triggered ? `×${report.proc.multiplier}` : '加算なし' });
  }
  if (report.segments?.length) {
    for (const segment of report.segments.filter(part => part.fullClear)) {
      const filled = segment.pathEnd - segment.pathStart;
      const initial = segment.clearRatio ? Math.round(filled / segment.clearRatio) : filled;
      rows.push({ label: `シート${segment.sheet} ${segment.oneCastClear ? '一詠全成' : '完成'}（25% × ${filled}/${initial}マス）`, value: `＋${fmt(segment.clearBonus)}` });
    }
  } else if (report.fullClear) {
    const total = report.clearRatio ? Math.round(report.path.length / report.clearRatio) : 0;
    rows.push({ label: total ? `完成加算（25% × この手${report.path.length}/${total}マス）` : '完成加算', value: `＋${fmt(report.clearBonus ?? 0)}` });
  }
  if (report.extraDamage) rows.push({ label: 'スキルの追加攻撃', value: `＋${fmt(report.extraDamage)}` });
  if (report.armorBroken) rows.push({ label: '敵の装甲', value: '完成で解除' });
  else if (report.armorPrevented) rows.push({ label: '敵の装甲による軽減', value: `−${fmt(report.armorPrevented)}` });
  if (report.temporaryShield) rows.push({ label: 'この手だけの守護', value: `＋${fmt(report.temporaryShield)}` });
  rows.push({ label: preview ? '確定ダメージ' : '合計ダメージ', value: fmt(report.damage) });
  if (preview && report.forecast && report.forecast.damageMax !== report.damage) rows.push({ label: '確率発動時の最大ダメージ', value: fmt(report.forecast.damageMax) });
  if (!preview && report.ledger) {
    rows.push({ label: '敵HPに与えた分', value: fmt(report.ledger.hpDamage) });
    rows.push({ label: '超過ダメージ', value: fmt(report.ledger.overkill) });
    rows.push({ label: '攻撃由来のスコア', value: `＋${fmt(report.attackScore)}` });
  }
  return rows;
}
