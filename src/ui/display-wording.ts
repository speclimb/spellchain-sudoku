/** Normalize presentation only; historical numbers and saved records stay untouched. */
export function historicalRewardDescription(description: string): string {
  return description
    .replace(/^選択後：/, '')
    .replace(/無料スキル券|魔力を使わないスキル券|無料券/g, '詠唱符')
    .replace(/無料スキルの手/g, '詠唱符を使う詠唱')
    .replace(/無料スキル中/g, '詠唱符を使う詠唱中')
    .replace(/無料スキル/g, '詠唱符を使うスキル')
    .replace(/有料スキル/g, '魔力を消費するスキル')
    .replace(/無料で飛び火/g, '自動入力回数を消費せずに飛び火')
    .replace(/無料で直接入力/g, '自動入力回数を消費せずに入力')
    .replace(/無料の直接入力|無料入力/g, '自動入力回数を消費しない入力')
    .replace(/自動入力回数|自動入力/g, '連鎖詠唱数')
    .replace(/自動(?=[＋+])/g, '連鎖詠唱数')
    .replace(/(連鎖詠唱数\s*[＋+]?\s*\d+)回/g, '$1')
    .replace(/旧倍率と重複しない。|旧効果へ重ね掛けしない。/g, '')
    .trim();
}
