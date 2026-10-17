/** Presentation only: never feed formatted values back into combat or saved state. */
const plain = new Intl.NumberFormat('ja-JP', { useGrouping: false, maximumFractionDigits: 2 });
const percentage = new Intl.NumberFormat('ja-JP', { style: 'percent', useGrouping: false, maximumFractionDigits: 2 });
const grouped = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });
const withoutNegativeZero = (text: string): string => text === '-0' ? '0' : text;

/** Multipliers and effect quantities: at most two decimal places, without trailing zeros. */
export const numberText = (value: number): string => withoutNegativeZero(plain.format(value));
/** Scores and totals use the same precision, with readable thousands separators. */
export const formatNumber = (value: number): string => withoutNegativeZero(grouped.format(value));
/** Convert a fractional rate to a percentage only for display (unit added by the caller). */
export const percentText = (value: number): string => withoutNegativeZero(percentage.format(value).replace('%', ''));
/** Clean frozen historical effect wording without recalculating effects or modifying the record. */
export const formatEffectText = (text: string): string => text.replace(/-?\d+\.\d{3,}/g, value => numberText(Number(value)));
