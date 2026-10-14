import bank from './puzzles.json';
import { CHARACTERS, RELICS } from './content';
import { canTakeReward, rollRewards, rollSkillRewards, rollRelicRewards, applyGrowthReward } from './rewards';
import { skillLevel, selectedSkill, skillValues, relicValues } from './growth';
import { enemyForRun, enemyIncoming, applyEnemyArmor } from './enemies';
import { effectMetrics, recordContribution } from './contributions';
export { canTakeReward } from './rewards';
import { Random, PEERS, UNITS, candidates, near, row, col } from './sudoku';
import type { Action, ChainTrace, FillEvent, Mark, Report, Preview, Run, Save, CharacterId, RelicId, PrimeEffect, PrimeRelicId, PrimeProcOutcome, SheetSegment, SkillId, EffectMetric } from './types';

export function newSave(): Save {
  return { version: 1, meta: { clears: 0, runs: 0, wins: 0, bestScore: 0, bestKills: 0, tutorialDone: false }, run: null, settings: { sound: false, fast: false, reducedMotion: false } };
}
function prepareBoard(run: Run, random: Random): void {
  const source = bank[run.puzzleOrder[run.puzzleCursor]];
  const rows = random.shuffle([0, 1, 2]).flatMap(b => random.shuffle([0, 1, 2]).map(r => b * 3 + r));
  const cols = random.shuffle([0, 1, 2]).flatMap(b => random.shuffle([0, 1, 2]).map(c => b * 3 + c));
  const digits = [0, ...random.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])];
  const transpose = random.next() < 0.5;
  const indexes = rows.flatMap(r => cols.map(c => transpose ? c * 9 + r : r * 9 + c));
  run.cells = indexes.map(i => digits[Number(source.puzzle[i])]);
  run.solution = indexes.map(i => digits[Number(source.solution[i])]);
  run.givens = run.cells.map(Boolean);
  run.marks = Array<Mark>(81).fill(null);
  const marked = random.shuffle(run.cells.flatMap((n, i) => n ? [] : [i])).slice(0, 6);
  marked.forEach((i, j) => { run.marks[i] = j < 3 ? 'weak' : 'shield'; });
}
function nextBoard(run: Run, random: Random): void {
  const previous = run.puzzleOrder[run.puzzleCursor];
  run.puzzleCursor++;
  if (run.puzzleCursor === bank.length) {
    run.puzzleOrder = random.shuffle(bank.map((_, i) => i));
    if (run.puzzleOrder[0] === previous) [run.puzzleOrder[0], run.puzzleOrder[1]] = [run.puzzleOrder[1], run.puzzleOrder[0]];
    run.puzzleCursor = 0;
  }
  run.sheet++; run.encounterSheet++;
  prepareBoard(run, random);
}
export const spellMultiplier = (level: number): number => 1 + (level - 1) * 0.2;
export const chainBonus = (level: number): number => Math.max(0, level - 1);
export const relicRank = (run: Run, id: RelicId): number => run.acquisitionRank[id] ?? 1;
export const relicTier = (run: Run, id: RelicId): number => run.tier[id] ?? 1;
export function chainBonuses(run: Run, skill = false, requested?: SkillId): ChainTrace['bonuses'] {
  const chosen = selectedSkill(run, skill, requested), values = chosen ? skillValues(run, chosen) : null;
  const bonuses = [{ label: '基本', amount: 3 }];
  if (run.character === 'fuse') bonuses.push({ label: '導火術師', amount: 1 });
  if (chainBonus(run.spellLevel)) bonuses.push({ label: '術式成長', amount: chainBonus(run.spellLevel) });
  if (run.inventory.includes('wick')) bonuses.push({ label: '長い導火線', amount: relicValues(run, 'wick').auto });
  if (values?.auto) bonuses.push({ label: chosen === 'fuse' ? '導火術師スキル' : '選択スキル', amount: values.auto });
  if (!skill && run.afterglow) bonuses.push({ label: '残光の灯', amount: relicValues(run, 'afterglow').afterglowAuto });
  if (run.reservedAuto) bonuses.push({ label: '七の護符・予約', amount: run.reservedAuto });
  return bonuses;
}
export const chainCapacity = (run: Run, skill = false, requested?: SkillId): number => chainBonuses(run, skill, requested).reduce((sum, bonus) => sum + bonus.amount, 0);
export function sheetShield(run: Run): number {
  const swept = run.phase === 'reward' || run.phase === 'won' ? run.lastReport?.sweep ?? [] : [];
  const filled = (cell: number) => run.cells[cell] !== 0 && !swept.includes(cell);
  const marked = run.marks.reduce((sum, mark, cell) => sum + (mark === 'shield' && !run.givens[cell] && filled(cell) ? 6 : 0), 0);
  const completed = run.inventory.includes('ward') ? UNITS.filter(unit => unit.some(cell => !run.givens[cell]) && unit.every(filled)).length * relicValues(run, 'ward').ward : 0;
  return marked + completed;
}
function grow(run: Run, report: Report, levels: number): void {
  const before = run.hp;
  run.spellLevel += levels; run.maxHp += levels * 4;
  run.hp = Math.min(run.maxHp, run.hp + levels * 10);
  report.healed += run.hp - before;
  report.levelsGained = levels; report.spellLevelAfter = run.spellLevel; report.maxHpGained = levels * 4;
}
export function startRun(save: Save, character: CharacterId, seed: number): Save {
  const chosen = CHARACTERS.find(c => c.id === character);
  if (!chosen || chosen.unlock > save.meta.clears) throw new Error('この術師はまだ解放されていません。');
  const next = structuredClone(save), random = new Random(seed);
  const run: Run = {
    id: `run-${seed >>> 0}`, seed: seed >>> 0, randomState: seed >>> 0, revision: 0, balanceVersion: 2, castCounter: 0,
    expansionVersion: 1, enemyRulesVersion: 1, enemyHealthVersion: 1, skillLevels: { [character]: 1 }, equippedSkills: [], relicLevels: {}, pendingRelicRewards: [], contributions: { sinceCast: 0, partial: false, battles: [] },
    character, skillRank: 1, stage: 0, turn: 0, phase: 'battle', cells: [], solution: [], givens: [], marks: [],
    puzzleOrder: random.shuffle(bank.map((_, i) => i)), puzzleCursor: 0, sheet: 1, encounterSheet: 1, spellLevel: 1,
    freeSkillTokens: 0, reservedAuto: 0, boons: { defense: 0, magic: 0 },
    hp: 40, maxHp: 40, mana: 0, manaOverflow: 0, enemyHp: 0, score: 0, inventory: [], acquisitionRank: {}, tier: {},
    pool: RELICS.filter(r => r.unlock <= save.meta.clears).map(r => r.id), rewards: [], afterglow: false,
    stats: { moves: 0, filled: 0, bestChain: 0, kills: 0, skills: 0, sheets: 0 }, lastReport: null,
  };
  prepareBoard(run, random); run.enemyHp = enemyForRun(run).hp; run.randomState = random.state;
  next.run = run; next.meta.runs++;
  return next;
}
export const incomingAttack = (run: Run): number => enemyIncoming(run);
export const canUseSkill = (run: Run): boolean => run.mana >= 8 || (run.freeSkillTokens ?? 0) > 0;
export function legalOrigins(run: Run, skill = false, requested?: SkillId): number[] {
  if (requested) selectedSkill(run, skill, requested);
  if (run.phase !== 'battle' || (skill && !canUseSkill(run))) return [];
  return run.cells.flatMap((value, cell) => !value && (skill || candidates(run.cells, cell).length === 1) ? [cell] : []);
}
interface CastPlan { run: Run; report: Report; effects: PrimeEffect[]; without: Partial<Record<RelicId, { base: number; clear: number; extra?: number }>>; metrics: Partial<Record<RelicId, EffectMetric>>; wardShield: number }
const primeDigits: Record<PrimeRelicId, number> = { duality: 2, trinity: 3, quint: 5, sept: 7 };

/** A local, no-RNG lookahead for the fresh sheet's deterministic entry point.
 * It spends one auto for entry and preserves once-per-cast rekindle/hop state.
 * It does not recurse into another sheet: only this sheet's length breaks ties. */
function measureSheet(source: Run, root: number, fuel: number, rekindled: boolean, hopsLeft: number, reconnectsLeft: number): number {
  const cells = [...source.cells];
  let current = root, count = 0;
  const fill = (target: number) => {
    cells[target] = source.solution[target]; fuel--; count++;
    if (!rekindled && source.inventory.includes('rekindle') && UNITS.some(unit => unit.includes(target) && unit.every(i => cells[i]))) { fuel += relicValues(source, 'rekindle').rekindleAuto; rekindled = true; }
    current = target;
  };
  fill(root);
  while (fuel > 0) {
    let eligible = PEERS[current].filter(i => !cells[i] && candidates(cells, i).length === 1).sort((a, b) => near(current, a, b));
    if (!eligible.length && hopsLeft > 0) {
      eligible = cells.flatMap((v, i) => !v && source.solution[i] === source.solution[current] ? [i] : []).sort((a, b) => near(current, a, b));
      if (eligible.length) hopsLeft--;
    }
    if (!eligible.length && reconnectsLeft > 0) {
      eligible = cells.flatMap((v, i) => !v && candidates(cells, i).length === 1 ? [i] : []).sort((a,b) => near(current,a,b));
      if (eligible.length) reconnectsLeft--;
    }
    if (eligible[0] === undefined) break;
    fill(eligible[0]);
  }
  return count;
}
/** Deterministic path/board plan. The only RNG is a private clone used to reveal
 * fresh sheets; source state and the effect/reward streams remain untouched. */
function planCast(source: Run, cell: number, skill: boolean, requested?: SkillId): CastPlan {
  const chosen = selectedSkill(source, skill, requested), values = chosen ? skillValues(source, chosen) : null;
  if (source.phase !== 'battle' || !Number.isInteger(cell) || cell < 0 || cell >= 81 || source.cells[cell]) throw new Error('空きマスを選んでください。');
  if (skill ? !canUseSkill(source) : candidates(source.cells, cell).length !== 1) throw new Error(skill ? '魔力か無料スキルが必要です。' : '数字が確定したマスを選んでください。');
  const run = structuredClone(source), has = (id: RelicId) => run.inventory.includes(id), boardRandom = new Random(source.randomState);
  const bonuses = chainBonuses(run, skill, chosen);
  const metrics = effectMetrics(source), without: CastPlan['without'] = {};
  const fuelQueue: { id?: RelicId; left: number }[] = bonuses.map(b => ({ id: b.label === '長い導火線' ? 'wick' : b.label === '残光の灯' ? 'afterglow' : b.label === '七の護符・予約' ? 'sept' : undefined, left: b.amount }));
  for (const bucket of fuelQueue) if (bucket.id && metrics[bucket.id]) { if (bucket.id === 'wick') { metrics[bucket.id]!.fuelGranted += bucket.left; metrics[bucket.id]!.opportunities++; metrics[bucket.id]!.triggers++; } }
  let fuel = bonuses.reduce((sum, bonus) => sum + bonus.amount, 0);
  const chain: ChainTrace = { initialAuto: fuel, bonuses, steps: [], stopReason: 'no-target', remainingAuto: fuel };
  run.reservedAuto = 0;
  if (!skill) run.afterglow = false;
  let rekindled = false, hopsLeft = values?.fuseHops ?? 0, reconnectsLeft = values?.reconnects ?? 0, maxShield = sheetShield(source), rawDamage = 0, wardShield = 0, maxMarkedShield = 0;
  let rawWithout: Partial<Record<RelicId, number>> = {};
  const damageRelics = ['pen', 'lens', 'stroke', 'glass', 'amplifier', 'echo'] as const;
  let multiplier = spellMultiplier(source.spellLevel) * relicValues(run, 'glass').damageMultiplier;
  if (skill) multiplier *= relicValues(run, 'amplifier').skillMultiplier * (values?.damageMultiplier ?? 1);
  const completionMultiplier = values?.completionMultiplier ?? 1;
  const path: FillEvent[] = [], segments: SheetSegment[] = [];
  let segment: SheetSegment, initiallySingle: boolean[];
  const beginSegment = () => {
    segment = { sheet: run.sheet, cells: [...run.cells], solution: [...run.solution], givens: [...run.givens], marks: [...run.marks],
      pathStart: path.length, pathEnd: path.length, baseDamage: 0, clearBonus: 0, clearRatio: 0, fullClear: false, oneCastClear: false };
    initiallySingle = run.cells.map((value, target) => !value && candidates(run.cells, target).length === 1);
    rawDamage = 0; rawWithout = {};
    for (const id of damageRelics) if (has(id)) rawWithout[id] = 0;
  };
  const endSegment = () => {
    segment.pathEnd = path.length; segment.fullClear = run.cells.every(Boolean);
    segment.baseDamage = Math.floor(rawDamage * multiplier);
    const blanks = segment.givens.filter(given => !given).length, filled = segment.pathEnd - segment.pathStart;
    segment.clearRatio = segment.fullClear && blanks ? filled / blanks : 0;
    segment.clearBonus = segment.fullClear && blanks ? Math.floor(segment.baseDamage * filled / (4 * blanks)) : 0;
    segment.oneCastClear = segment.fullClear && filled === blanks && segment.cells.every((value, i) => segment.givens[i] || value === 0);
    maxShield = Math.max(maxShield, sheetShield(run));
    const wardPart = has('ward') ? UNITS.filter(unit => unit.some(cell => !run.givens[cell]) && unit.every(cell => run.cells[cell])).length * relicValues(run, 'ward').ward : 0;
    maxMarkedShield = Math.max(maxMarkedShield, sheetShield(run) - wardPart);
    wardShield = maxShield - maxMarkedShield;
    for (const id of damageRelics) if (has(id)) {
      const factor = id === 'glass' ? relicValues(run, id).damageMultiplier : id === 'amplifier' && skill ? relicValues(run, id).skillMultiplier : 1;
      const base = Math.floor((rawWithout[id] ?? rawDamage) * multiplier / factor);
      const clear = segment.fullClear && blanks ? Math.floor(base * filled / (4 * blanks)) : 0;
      const total = without[id] ??= { base: 0, clear: 0 }; total.base += base; total.clear += clear;
    }
    segments.push(segment);
  };
  beginSegment();
  const fill = (target: number, kind: FillEvent['source'], from: number | null, eligibleCells: number[], hop = false, sheetStart = false, bridge = false) => {
    if (run.cells[target]) throw new Error('同じマスを二度埋めることはできません。');
    const candidateValues = candidates(run.cells, target), remainingBefore = fuel;
    const distance = (i: number) => from === null ? 0 : Math.abs(row(from) - row(i)) + Math.abs(col(from) - col(i));
    const tiedCells = from === null ? [] : eligibleCells.filter(i => distance(i) === distance(eligibleCells[0]));
    if (kind === 'chain') {
      fuel--; const bucket = fuelQueue.find(item => item.left > 0);
      if (bucket) { bucket.left--; if (bucket.id && metrics[bucket.id]) metrics[bucket.id]!.fuelUsed++; }
    }
    run.cells[target] = run.solution[target];
    const units = UNITS.flatMap((unit, id) => unit.includes(target) && unit.every(i => run.cells[i] !== 0) ? [id] : []);
    path.push({ sheet: run.sheet, cell: target, value: run.cells[target], ordinal: path.length + 1, source: kind, units, mark: run.marks[target], ...(hop ? { hop: true } : {}), ...(bridge ? { bridge: true } : {}), ...(sheetStart ? { sheetStart: true } : {}) });
    // Per-cell base progression softens at 80 after cell 36; the chain and every
    // later contribution continue. There is no arbitrary chain/sheet clamp.
    const stroke = has('stroke') && path.length <= relicValues(run, 'stroke').strokeCells ? relicValues(run, 'stroke').strokeMultiplier : 1;
    const base = Math.min(80, 10 + (path.length - 1) * 2);
    const completion = units.length * (20 + (run.character === 'scribe' ? 10 : 0) + relicValues(run, 'pen').completion) * completionMultiplier;
    const weak = run.marks[target] === 'weak' ? relicValues(run, 'lens').weakDamage : 0;
    const echoDamage = kind === 'echo' ? relicValues(run, 'echo').echoDamage : 0;
    const amount = (base + completion + weak + echoDamage) * stroke;
    rawDamage += amount;
    for (const id of damageRelics) if (has(id)) {
      const removed = id === 'pen' ? units.length * relicValues(run,id).completion * completionMultiplier * stroke
        : id === 'lens' && run.marks[target] === 'weak' ? (relicValues(run,id).weakDamage - 8) * stroke
        : id === 'stroke' ? amount - (base + completion + weak + echoDamage)
        : id === 'echo' ? echoDamage * stroke : 0;
      rawWithout[id] = (rawWithout[id] ?? 0) + amount - removed;
    }
    if (kind === 'echo' && metrics.echo) { metrics.echo.addedInputs++; metrics.echo.triggers++; }
    if (units.length && metrics.pen) { metrics.pen.opportunities += units.length; metrics.pen.triggers += units.length; }
    if (run.marks[target] === 'weak' && metrics.lens) { metrics.lens.opportunities++; metrics.lens.triggers++; }
    if (stroke > 1 && metrics.stroke) { metrics.stroke.opportunities++; metrics.stroke.triggers++; }
    const addedAuto = has('rekindle') && units.length && !rekindled ? relicValues(run, 'rekindle').rekindleAuto : 0;
    if (addedAuto) { fuel += addedAuto; rekindled = true; fuelQueue.push({ id: 'rekindle', left: addedAuto }); if (metrics.rekindle) { metrics.rekindle.fuelGranted += addedAuto; metrics.rekindle.opportunities++; metrics.rekindle.triggers++; } }
    chain.steps.push({ sheet: run.sheet, from, cell: target, source: kind,
      sharedUnits: from === null ? [] : UNITS.flatMap((unit, id) => unit.includes(from) && unit.includes(target) ? [id] : []),
      candidateValues, eligibleCells, tiedCells, initiallySingle: initiallySingle[target], remainingBefore, remainingAfter: fuel, addedAuto,
      ...(hop ? { hop: true } : {}), ...(bridge ? { bridge: true } : {}), ...(sheetStart ? { sheetStart: true } : {}),
    });
  };
  let current = cell;
  fill(current, 'root', null, legalOrigins(source, skill, chosen));
  if (has('echo')) {
    if (metrics.echo) metrics.echo.opportunities += relicValues(run, 'echo').echoes;
    for (let count = 0; count < relicValues(run, 'echo').echoes; count++) {
      const eligible = run.cells.flatMap((v, i) => !v && run.solution[i] === run.solution[cell] ? [i] : []).sort((a,b) => near(current,a,b));
      if (eligible[0] === undefined) break;
      fill(eligible[0], 'echo', current, eligible); current = eligible[0];
    }
  }
  while (fuel > 0) {
    if (run.cells.every(Boolean)) {
      if (!relicValues(run, 'wick').carry) break;
      endSegment(); nextBoard(run, boardRandom); beginSegment();
      const roots = run.cells.flatMap((value, target) => !value && initiallySingle[target] ? [target] : []);
      // Stable ascending scan means equal lengths choose the upper-left cell.
      let best = roots[0], length = -1;
      for (const root of roots) { const measured = measureSheet(run, root, fuel, rekindled, hopsLeft, reconnectsLeft); if (measured > length) { best = root; length = measured; } }
      if (best === undefined) throw new Error('次のシートの確定起点が見つかりません。');
      fill(best, 'chain', null, roots, false, true); current = best;
      continue;
    }
    let eligible = PEERS[current].filter(i => !run.cells[i] && candidates(run.cells, i).length === 1).sort((a, b) => near(current, a, b));
    let hop = false, bridge = false;
    if (!eligible.length && hopsLeft > 0) {
      eligible = run.cells.flatMap((v, i) => !v && run.solution[i] === run.solution[current] ? [i] : []).sort((a, b) => near(current, a, b));
      hop = eligible.length > 0;
    }
    if (!eligible.length && reconnectsLeft > 0) {
      eligible = run.cells.flatMap((v,i) => !v && candidates(run.cells,i).length === 1 ? [i] : []).sort((a,b) => near(current,a,b));
      bridge = eligible.length > 0;
    }
    if (eligible[0] === undefined) break;
    if (hop) hopsLeft--; if (bridge) reconnectsLeft--;
    fill(eligible[0], 'chain', current, eligible, hop, false, bridge); current = eligible[0];
  }
  endSegment(); run.randomState = boardRandom.state;
  chain.remainingAuto = fuel;
  chain.stopReason = run.cells.every(Boolean) ? 'board-complete' : fuel === 0 ? 'limit' : 'no-target';
  const baseDamage = segments.reduce((sum, part) => sum + part.baseDamage, 0), clearBonus = segments.reduce((sum, part) => sum + part.clearBonus, 0);
  const sheetsCompleted = segments.filter(part => part.fullClear).length;
  const oldMana = run.mana, stored = run.manaOverflow;
  const freeSkill = skill && (run.freeSkillTokens ?? 0) > 0;
  // Free tokens take priority even at full mana, preserving stored mana/overflow.
  if (freeSkill) run.freeSkillTokens--;
  else if (skill) { run.mana = stored; run.manaOverflow = 0; }
  else {
    const gained = path.length + (run.character === 'lumen' ? 1 : 0) + relicValues(run, 'battery').charge;
    run.mana = Math.min(8, oldMana + gained);
    run.manaOverflow = has('battery') ? Math.min(relicValues(run, 'battery').overflow, stored + Math.max(0, oldMana + gained - 8)) : 0;
  }
  if (skill && has('afterglow')) { run.afterglow = true; metrics.afterglow!.opportunities++; metrics.afterglow!.triggers++; metrics.afterglow!.fuelGranted = source.afterglow ? 0 : relicValues(run,'afterglow').afterglowAuto; }
  const temporaryShield = values?.temporaryShield ?? 0;
  maxShield += temporaryShield;
  const weakCount = path.filter(event => event.mark === 'weak').length;
  const extraDamage = Math.floor(((values?.weakAttack ?? 0) * weakCount + (weakCount >= 3 ? values?.weakBurst ?? 0 : 0) + maxShield * (values?.shieldAttack ?? 0)) * spellMultiplier(source.spellLevel));
  if (metrics.ward && values?.shieldAttack) without.ward = { base: baseDamage, clear: clearBonus, extra: Math.floor((maxShield - wardShield) * values.shieldAttack * spellMultiplier(source.spellLevel)) };
  if (metrics.battery && !skill) { metrics.battery.opportunities++; metrics.battery.triggers++; metrics.battery.mana += Math.max(0, run.mana + run.manaOverflow - Math.min(8, oldMana + path.length + (run.character === 'lumen' ? 1 : 0)) - stored); }
  if (metrics.quint && freeSkill) metrics.quint.tokensUsed++;
  if (metrics.amplifier && skill) { metrics.amplifier.opportunities++; metrics.amplifier.triggers++; }
  if (metrics.glass) { metrics.glass.opportunities++; metrics.glass.triggers++; }
  const report: Report = {
    skill, skillId: chosen, skillLevel: chosen ? skillLevel(source, chosen) : undefined, extraDamage, temporaryShield,
    enemyStyle: enemyForRun(source).attackStyle, freeSkill, path, chain, segments, sheetsCompleted,
    damage: baseDamage + clearBonus + extraDamage, baseDamage, guaranteedDamage: baseDamage + clearBonus + extraDamage,
    clearBonus, clearRatio: Math.max(...segments.map(part => part.clearRatio)), oneCastClear: segments.some(part => part.oneCastClear),
    attackScore: 0, shield: maxShield, incoming: incomingAttack(source), received: 0, healed: 0,
    charge: skill ? 0 : run.mana - oldMana, manaOverflow: run.manaOverflow, manaRestored: skill && !freeSkill ? stored : 0,
    units: path.reduce((n, event) => n + event.units.length, 0), weak: path.filter(event => event.mark === 'weak').length,
    defeated: false, fullClear: sheetsCompleted > 0, sweep: [], hpBefore: source.hp, enemyBefore: source.enemyHp,
    sheetAdvanced: false, levelsGained: 0, spellLevelBefore: source.spellLevel, spellLevelAfter: source.spellLevel, maxHpGained: 0,
  };
  const effects: PrimeEffect[] = [];
  for (const id of Object.keys(primeDigits) as PrimeRelicId[]) {
    if (!has(id) || !path.some(event => event.value === primeDigits[id])) continue;
    if (id === 'quint' && (freeSkill || (source.freeSkillTokens ?? 0) > 0)) continue;
    const values = relicValues(run, id);
    effects.push({ id, chance: values.chance, value: values.primeValue });
    if (metrics[id]) metrics[id]!.opportunities++;
  }
  return { run, report, effects, without, metrics, wardShield };
}
/** Isolated versioned per-cast/effect domains. Previews never call this. The
 * Trinity domain is retained to preserve existing casts after save migration. */
export function primeRoll(seed: number, castCounter: number, id: PrimeRelicId): number {
  const domains: Record<PrimeRelicId, number> = { duality: 0x64756132, trinity: 0x74726933, quint: 0x71756935, sept: 0x73657037 };
  let value = (seed ^ domains[id] ^ Math.imul(castCounter + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 0x100000000;
}
/** Settle once against the current enemy; never attack/skip its successor. */
function settleCast(plan: CastPlan, triggered: ReadonlySet<PrimeRelicId>): Run {
  const run = structuredClone(plan.run), report = structuredClone(plan.report);
  const effect = (id: PrimeRelicId) => triggered.has(id) ? plan.effects.find(p => p.id === id)?.value ?? 0 : 0;
  const preArmor = Math.floor(report.baseDamage! * (effect('trinity') || 1)) + report.clearBonus! + (report.extraDamage ?? 0);
  const armored = applyEnemyArmor(run, preArmor, report.units);
  report.damage = armored.damage; report.armorPrevented = armored.prevented; report.armorBroken = armored.broken;
  report.guaranteedDamage = applyEnemyArmor(run, report.baseDamage! + report.clearBonus! + (report.extraDamage ?? 0), report.units).damage;
  report.defeated = report.damage >= run.enemyHp;
  const reduction = Math.min(.6, (run.boons?.defense ? .25 : 0) + effect('duality'));
  report.received = report.defeated ? 0 : Math.ceil(Math.max(0, report.incoming - report.shield) * (1 - reduction));
  report.attackScore = Math.floor(report.damage * relicValues(run, 'gold').scoreMultiplier);
  const metrics = structuredClone(plan.metrics);
  for (const [id, lower] of Object.entries(plan.without) as [RelicId, {base:number;clear:number;extra?:number}][]) {
    const removed = Math.floor(lower.base * (effect('trinity') || 1)) + lower.clear + (lower.extra ?? report.extraDamage ?? 0);
    metrics[id]!.damage = Math.max(0, report.damage - applyEnemyArmor(run, removed, report.units).damage);
  }
  for (const proc of plan.effects) if (triggered.has(proc.id) && metrics[proc.id]) metrics[proc.id]!.triggers++;
  if (metrics.trinity && effect('trinity')) metrics.trinity.damage = report.damage - report.guaranteedDamage!;
  if (metrics.duality && !report.defeated) metrics.duality.prevented = Math.max(0, Math.ceil(Math.max(0, report.incoming - report.shield) * (1 - (run.boons.defense ? .25 : 0))) - report.received);
  if (metrics.ward) { metrics.ward.opportunities++; metrics.ward.triggers += Number(plan.wardShield > 0); metrics.ward.prevented = report.defeated ? 0 : Math.max(0, Math.ceil(Math.max(0, report.incoming - Math.max(0, report.shield - plan.wardShield)) * (1 - reduction)) - report.received); }
  if (metrics.quint) metrics.quint.tokensGranted = effect('quint');
  if (metrics.sept) metrics.sept.fuelGranted = effect('sept'); // generation here; FIFO consumption appears on the next cast
  if (metrics.gold) { metrics.gold.opportunities++; metrics.gold.triggers++; metrics.gold.score = report.attackScore - report.damage; }
  report.ledger = { hpDamage: Math.min(run.enemyHp, report.damage), overkill: Math.max(0, report.damage - run.enemyHp), skillId: report.skillId, skillLevel: report.skillLevel, relics: metrics };
  run.enemyHp = Math.max(0, run.enemyHp - report.damage); run.hp = Math.max(0, run.hp - report.received); run.score += report.attackScore;
  if (effect('quint')) run.freeSkillTokens = effect('quint');
  if (effect('sept')) run.reservedAuto = effect('sept');
  run.turn++; run.castCounter++; run.stats.moves++; run.stats.filled += report.path.length;
  run.stats.bestChain = Math.max(run.stats.bestChain, report.path.length);
  if (report.skill) run.stats.skills++;
  run.stats.sheets += report.sheetsCompleted ?? 0;
  if (report.defeated) {
    run.stats.kills++; run.score += 500;
    report.sweep = run.cells.flatMap((v, i) => v ? [] : [i]); run.cells = [...run.solution];
    grow(run, report, (report.sheetsCompleted ?? 0) + 1); run.phase = 'reward';
  } else if (!run.hp) run.phase = 'lost';
  else if (report.fullClear) { grow(run, report, report.sheetsCompleted!); report.sheetAdvanced = true; }
  run.lastReport = report;
  return run;
}
export function previewAction(run: Run, cell: number, skill = false, requested?: SkillId): Preview {
  const plan = planCast(run, cell, skill, requested), minimum = settleCast(plan, new Set());
  const report: Preview = minimum.lastReport!;
  if (plan.effects.length) {
    // The independent damage/reduction effects create four possible combat
    // outcomes. Future token/fuel outcomes don't change this cast's path or HP.
    const ids = plan.effects.filter(p => p.id === 'trinity' || p.id === 'duality').map(p => p.id);
    const states: Run[] = [];
    for (let mask = 0; mask < 2 ** ids.length; mask++) states.push(settleCast(plan, new Set(ids.filter((_, i) => mask & (1 << i)))));
    const reports = states.map(state => state.lastReport!);
    const trinity = plan.effects.find(effect => effect.id === 'trinity');
    report.forecast = {
      procs: plan.effects, damageMax: Math.max(...reports.map(p => p.damage)), attackScoreMax: Math.max(...reports.map(p => p.attackScore)), chance: trinity?.chance ?? 0, multiplier: trinity?.value ?? 1,
      receivedMin: Math.min(...reports.map(p => p.received)), receivedMax: Math.max(...reports.map(p => p.received)),
      healedMin: Math.min(...reports.map(p => p.healed)), healedMax: Math.max(...reports.map(p => p.healed)),
      levelsGainedMin: Math.min(...reports.map(p => p.levelsGained!)), levelsGainedMax: Math.max(...reports.map(p => p.levelsGained!)),
      kill: reports.every(p => p.defeated) ? 'guaranteed' : reports.some(p => p.defeated) ? 'possible' : 'none',
      survival: states.every(state => state.hp > 0) ? 'certain' : states.some(state => state.hp > 0) ? 'possible' : 'none',
      sheetAdvancedCertain: reports.every(p => !!p.sheetAdvanced),
    };
  }
  return report;
}
const longestCache = new Map<string, { cells: number[]; length: number }>();
/** Cache only path-relevant state, independent of selection/render. Bounded by
 * entries, not chain length. A fresh revision/resource/mode/board invalidates. */
export function longestOrigins(run: Run, skill = false, requested?: SkillId): { cells: number[]; length: number } {
  const key = JSON.stringify([run.id, run.revision, run.phase, run.cells, run.solution, run.givens, run.marks, run.sheet, run.puzzleCursor, run.puzzleOrder, run.randomState, run.character, run.skillRank, run.spellLevel, run.inventory, run.tier, run.afterglow, run.reservedAuto, run.mana, run.freeSkillTokens, skill, requested, run.skillLevels, run.equippedSkills, run.relicLevels]);
  const cached = longestCache.get(key); if (cached) return { cells: [...cached.cells], length: cached.length };
  const result = { cells: [] as number[], length: 0 };
  for (const cell of legalOrigins(run, skill, requested)) {
    const length = planCast(run, cell, skill, requested).report.path.length;
    if (length > result.length) { result.cells = [cell]; result.length = length; }
    else if (length === result.length) result.cells.push(cell);
  }
  if (longestCache.size >= 8) longestCache.delete(longestCache.keys().next().value!);
  longestCache.set(key, result); return { cells: [...result.cells], length: result.length };
}
/** One committed reducer; the state is persisted before any animation. */
export function resolveAction(source: Run, action: Action): Run {
  if (action.revision !== source.revision) throw new Error('この操作はすでに処理されています。');
  let run = structuredClone(source);
  const random = new Random(run.randomState);
  if (action.type === 'equip') {
    if (run.phase !== 'reward' || !run.expansionVersion || action.skills.length > 2 || new Set(action.skills).size !== action.skills.length
      || action.skills.some(id => !['bridge', 'pierce', 'bastion'].includes(id) || !run.skillLevels?.[id])) throw new Error('スキルの付け替えは戦闘の間に、所有済みの追加スキル2つまでです。');
    run.equippedSkills = [...action.skills];
  } else if (action.type === 'reward') {
    if (run.phase !== 'reward' || !run.rewards.includes(action.relic) || !canTakeReward(run, action.relic)) throw new Error('この報酬は選べません。');
    const firstBossStep = run.expansionVersion && run.rewardStep === 'skill';
    if (!firstBossStep) run.boons = { defense: Math.max(0, (run.boons?.defense ?? 0) - 1), magic: Math.max(0, (run.boons?.magic ?? 0) - 1) };
    if (applyGrowthReward(run, action.relic)) { /* Growth changes only once in this reducer. */ }
    else if (action.relic === 'defense-boon') run.boons.defense = 5;
    else if (action.relic === 'magic-boon') run.boons.magic = 5;
    else if (action.relic === 'training') { run.spellLevel++; run.maxHp += 4; run.hp = Math.min(run.maxHp, run.hp + 10); }
    else if (action.relic === 'vitality') { run.maxHp += 12; run.hp = Math.min(run.maxHp, run.hp + 12); }
    else if (action.relic === 'recovery') run.hp = run.maxHp;
    else if (action.relic === 'skill-upgrade') run.skillRank = 2;
    else {
      const greater = action.relic.startsWith('greater:');
      const relic = (greater ? action.relic.slice(8) : action.relic) as RelicId;
      if (run.inventory.includes(relic)) {
        if (!greater) run.acquisitionRank[relic] = relicRank(run, relic) + 1;
      } else {
        run.inventory.push(relic); run.acquisitionRank[relic] = 1;
        if (relic === 'glass') { run.maxHp -= 8; run.hp = Math.min(run.hp, run.maxHp); }
      }
      if (greater) run.tier[relic] = 2;
    }
    if (firstBossStep) {
      run.lastReport = null; run.rewardStep = 'relic'; run.rewards = run.pendingRelicRewards ?? []; run.pendingRelicRewards = [];
      if (run.rewards.length !== 3) throw new Error('次の遺物報酬を読み込めません。');
    } else {
    run.stage++; run.balanceVersion = 2; run.enemyRulesVersion = run.expansionVersion ? 1 : 0; run.enemyHealthVersion = 1; nextBoard(run, random); run.encounterSheet = 1;
    run.enemyHp = enemyForRun(run).hp;
    if (run.boons.magic) run.mana = 8;
    run.turn = 0; run.phase = 'battle'; run.rewards = []; run.lastReport = null; run.rewardStep = undefined; run.pendingRelicRewards = [];
    }
  } else {
    const plan = planCast(source, action.cell, action.skill, action.skillId);
    const procs: PrimeProcOutcome[] = plan.effects.map(effect => ({ ...effect, triggered: primeRoll(source.seed, source.castCounter, effect.id) < effect.chance }));
    if (procs.length) plan.report.procs = procs;
    const trinity = procs.find(proc => proc.id === 'trinity');
    if (trinity) plan.report.proc = { id: 'trinity', chance: trinity.chance, multiplier: trinity.value, triggered: trinity.triggered };
    run = settleCast(plan, new Set(procs.filter(proc => proc.triggered).map(proc => proc.id)));
    random.state = run.randomState;
    recordContribution(run, run.lastReport!);
    if (run.lastReport!.defeated) {
      if (run.expansionVersion && run.balanceVersion === 2 && (run.stage + 1) % 5 === 0) {
        run.rewardStep = 'skill'; run.rewards = rollSkillRewards(run, random);
        run.pendingRelicRewards = rollRelicRewards(run, random);
      } else { run.rewardStep = run.expansionVersion && run.balanceVersion === 2 ? 'relic' : 'legacy'; run.rewards = rollRewards(run, random); }
    }
    else if (run.phase === 'battle' && run.cells.every(Boolean)) nextBoard(run, random);
  }
  run.randomState = random.state; run.revision++;
  return run;
}
export function dispatch(save: Save, action: Action): Save {
  if (!save.run) throw new Error('冒険が開始されていません。');
  const next = structuredClone(save), run = resolveAction(save.run, action);
  next.meta.clears += run.stats.kills - save.run.stats.kills;
  next.meta.bestKills = Math.max(next.meta.bestKills, run.stats.kills);
  if (run.phase === 'won' || run.phase === 'lost') next.meta.bestScore = Math.max(next.meta.bestScore, run.score);
  next.run = run;
  return next;
}
