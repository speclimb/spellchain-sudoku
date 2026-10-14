import { ENEMIES, enemyOf } from './content';
import type { Run } from './types';

export type EnemySymbol = 'ember' | 'wing' | 'guardian' | 'eye' | 'star' | 'dragon' | 'frost' | 'mirror';
export type EnemyAttackStyle = 'fireball' | 'feathers' | 'pillars' | 'ray' | 'absorption' | 'breath' | 'frost' | 'mirror';
export type EnemyPattern = 'steady' | 'third-heavy' | 'charge-strike';
type EnemyRun = Pick<Run, 'stage' | 'balanceVersion' | 'enemyRulesVersion'>;
type IntentRun = EnemyRun & Pick<Run, 'turn'>;
type EnemyBase = ReturnType<typeof enemyOf>;
export interface Enemy extends Omit<EnemyBase, 'symbol'> {
  symbol: EnemySymbol; attackStyle: EnemyAttackStyle; attackName: string;
  behavior: string; pattern: EnemyPattern; armor: number;
}
export interface EnemyIntent {
  style: EnemyAttackStyle; name: string; behavior: string;
  state: 'attack' | 'heavy' | 'charge'; incoming: number; nextIncoming: number;
  label: string; warning: string;
}
const ATTACKS: Record<EnemySymbol, { attackStyle: EnemyAttackStyle; attackName: string }> = {
  ember: { attackStyle: 'fireball', attackName: '灯火の火球' },
  wing: { attackStyle: 'feathers', attackName: '羽刃の連撃' },
  guardian: { attackStyle: 'pillars', attackName: '紋章の石柱' },
  eye: { attackStyle: 'ray', attackName: '夜光の眼差し' },
  star: { attackStyle: 'absorption', attackName: '星喰いの吸引' },
  dragon: { attackStyle: 'breath', attackName: '零の竜息' },
  frost: { attackStyle: 'frost', attackName: '氷牙の突進' },
  mirror: { attackStyle: 'mirror', attackName: '鏡片の斬撃' },
};
const EXTRA_ENEMIES = [
  { name: '霜牙の狼', title: 'THE FROST FANG', symbol: 'frost' as const, lore: '息を潜める一手の先に、白い牙が光る。' },
  { name: '鏡甲の甲虫', title: 'THE MIRROR CARAPACE', symbol: 'mirror' as const, lore: '整った紋章だけが、磨かれた甲羅を砕く。' },
];
const ORDINARY_CYCLE = [0, 1, 2, 3, 6, 7] as const;
const cap = (value: number) => Math.min(Number.MAX_SAFE_INTEGER, value);

/** HP/attack balance and enemy rules are versioned independently for saved battles. */
export function enemyAt(stage: number, balanceVersion: 1 | 2 = 2, enemyRulesVersion: 0 | 1 = 1): Enemy {
  const old = enemyOf(stage, balanceVersion);
  let identity = { name: old.name, title: old.title, symbol: old.symbol as EnemySymbol, lore: old.lore };
  let archetypeIndex = old.archetypeIndex;
  if (enemyRulesVersion === 1 && !old.isBoss) {
    // Count only ordinary encounters so each of the six forms returns regularly.
    // The opening four and milestone boss slots retain their existing identities.
    const ordinaryIndex = stage - Math.floor(stage / 5);
    archetypeIndex = ORDINARY_CYCLE[ordinaryIndex % ORDINARY_CYCLE.length];
    const selected = archetypeIndex < ENEMIES.length ? ENEMIES[archetypeIndex] : EXTRA_ENEMIES[archetypeIndex - ENEMIES.length];
    identity = { name: selected.name, title: selected.title, symbol: selected.symbol as EnemySymbol, lore: selected.lore };
  }
  const strongEvery = enemyRulesVersion === 0 ? old.strongEvery : old.isBoss || identity.symbol === 'guardian' ? 3 : 0;
  const pattern: EnemyPattern = enemyRulesVersion === 1 && identity.symbol === 'frost' ? 'charge-strike' : strongEvery ? 'third-heavy' : 'steady';
  const armor = enemyRulesVersion === 1 && identity.symbol === 'mirror' ? 20 : 0;
  const behavior = pattern === 'charge-strike' ? '溜め（攻撃0）と2倍の突進を交互に行う。'
    : armor ? '被ダメージ20％軽減。行・列・区画を1つ完成すると、その詠唱中だけ解除。'
    : pattern === 'third-heavy' ? '毎手反撃。3手ごとに攻撃力が2倍になる。' : '毎手、同じ攻撃力で反撃する。';
  return { ...old, ...identity, ...ATTACKS[identity.symbol], archetypeIndex, strongEvery, pattern, armor, behavior };
}

/** Missing rules mean a saved, already-started legacy encounter. */
export function enemyForRun(run: EnemyRun): Enemy {
  return enemyAt(run.stage, run.balanceVersion, run.enemyRulesVersion ?? 0);
}
function attackOn(enemy: Enemy, turn: number): number {
  if (enemy.pattern === 'charge-strike') return turn % 2 === 0 ? 0 : cap(enemy.attack * 2);
  return cap(enemy.attack * (enemy.strongEvery && (turn + 1) % enemy.strongEvery === 0 ? 2 : 1));
}
/** Pure exact counter prediction, before sheet guard and player reductions. */
export function enemyIncoming(run: IntentRun): number {
  return attackOn(enemyForRun(run), run.turn);
}
export function enemyIntent(run: IntentRun): EnemyIntent {
  const enemy = enemyForRun(run), incoming = attackOn(enemy, run.turn), nextIncoming = attackOn(enemy, run.turn + 1);
  const state = enemy.pattern === 'charge-strike' && run.turn % 2 === 0 ? 'charge' : incoming > enemy.attack ? 'heavy' : 'attack';
  return {
    style: enemy.attackStyle, name: enemy.attackName, behavior: enemy.behavior, state, incoming, nextIncoming,
    label: state === 'charge' ? '力を溜める' : state === 'heavy' ? `${enemy.attackName}・強` : enemy.attackName,
    warning: state === 'charge' ? `今回は攻撃0。次の手は攻撃${nextIncoming}の突進。`
      : nextIncoming > enemy.attack ? `次の手は強攻撃${nextIncoming}。` : `次の手の攻撃${nextIncoming}。`,
  };
}
/** Armor is local to one cast, never a persisted enemy/board mutation.
 * Apply once after every outgoing bonus. Prevent floor(total / 5), keeping
 * rounding identical between preview, proc outcomes, actual damage and score.
 */
export function applyEnemyArmor(run: EnemyRun, damage: number, completedUnits: number, bypass = false): { damage: number; prevented: number; broken: boolean } {
  const enemy = enemyForRun(run), broken = enemy.armor > 0 && completedUnits > 0;
  const prevented = enemy.armor && !broken && !bypass ? Math.floor(damage / 5) : 0;
  return { damage: damage - prevented, prevented, broken };
}
