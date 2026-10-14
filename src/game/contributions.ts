import { enemyForRun } from './enemies';
import type { BattleLedger, EffectMetric, RelicId, Report, Run } from './types';

export const emptyEffect = (): EffectMetric => ({ heldCasts: 0, opportunities: 0, triggers: 0, damage: 0, addedInputs: 0, fuelGranted: 0, fuelUsed: 0, mana: 0, prevented: 0, tokensGranted: 0, tokensUsed: 0, score: 0 });
export function effectMetrics(run: Run): Partial<Record<RelicId, EffectMetric>> {
  return Object.fromEntries(run.inventory.map(id => [id, { ...emptyEffect(), heldCasts: 1 }]));
}
/** Called only by the committed action reducer, never previews or animations.
 * Keep five encounters, including the current one. A migrated partial battle is
 * explicitly marked; historical casts are never reconstructed from the score. */
export function recordContribution(run: Run, report: Report): void {
  if (!run.contributions || !report.ledger) return;
  const history = run.contributions;
  let battle = history.battles.find(item => item.stage === run.stage);
  if (!battle) {
    battle = { balanceVersion: run.balanceVersion, stage: run.stage, boss: enemyForRun(run).isBoss, casts: 0, damage: 0, hpDamage: 0, overkill: 0, score: 0, skills: {}, relics: {} };
    history.battles.push(battle);
    history.battles = history.battles.slice(-5);
  }
  battle.casts++; battle.damage += report.damage; battle.hpDamage += report.ledger.hpDamage;
  battle.overkill += report.ledger.overkill; battle.score += report.attackScore + (report.defeated ? 500 : 0);
  if (report.skillId) {
    const value = battle.skills[report.skillId] ??= { uses: 0, damage: 0, hpDamage: 0, overkill: 0, level: report.skillLevel ?? 1 };
    value.uses++; value.damage += report.damage; value.hpDamage += report.ledger.hpDamage; value.overkill += report.ledger.overkill;
    value.level = report.skillLevel ?? value.level;
  }
  for (const [id, metric] of Object.entries(report.ledger.relics) as [RelicId, EffectMetric][]) {
    const value = battle.relics[id] ??= emptyEffect();
    for (const key of Object.keys(value) as (keyof EffectMetric)[]) value[key] += metric[key];
  }
}
export function mergeBattles(battles: BattleLedger[]): BattleLedger {
  const merged: BattleLedger = { stage: battles.at(-1)?.stage ?? 0, boss: false, casts: 0, damage: 0, hpDamage: 0, overkill: 0, score: 0, skills: {}, relics: {} };
  for (const battle of battles) {
    for (const key of ['casts', 'damage', 'hpDamage', 'overkill', 'score'] as const) merged[key] += battle[key];
    for (const [id, value] of Object.entries(battle.skills)) {
      const key = id as keyof typeof merged.skills, target = merged.skills[key] ??= { uses: 0, damage: 0, hpDamage: 0, overkill: 0, level: value!.level };
      for (const prop of ['uses', 'damage', 'hpDamage', 'overkill'] as const) target[prop] += value![prop];
      target.level = value!.level;
    }
    for (const [id, value] of Object.entries(battle.relics)) {
      const target = merged.relics[id as RelicId] ??= emptyEffect();
      for (const prop of Object.keys(target) as (keyof EffectMetric)[]) target[prop] += value![prop];
    }
  }
  return merged;
}
