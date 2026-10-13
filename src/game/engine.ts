import bank from './puzzles.json';
import { CHARACTERS, RELICS, REPEATABLE_REWARDS, characterOf, enemyOf } from './content';
import { Random, PEERS, UNITS, candidates, near, row, col } from './sudoku';
import type { Action, ChainTrace, FillEvent, Mark, Report, Preview, Run, Save, CharacterId, RelicId, RewardId, GreaterRelicId } from './types';

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
export function chainBonuses(run: Run, skill = false): ChainTrace['bonuses'] {
  const bonuses = [{ label: '基本', amount: 3 }];
  if (run.character === 'fuse') bonuses.push({ label: '導火術師', amount: 1 });
  if (chainBonus(run.spellLevel)) bonuses.push({ label: '術式成長', amount: chainBonus(run.spellLevel) });
  if (run.inventory.includes('wick')) bonuses.push({ label: '長い導火線', amount: 2 });
  if (skill && run.character === 'fuse') bonuses.push({ label: '導火術師スキル', amount: 4 });
  if (!skill && run.afterglow) bonuses.push({ label: '残光の灯', amount: 2 });
  return bonuses;
}
export const chainCapacity = (run: Run, skill = false): number => chainBonuses(run, skill).reduce((sum, bonus) => sum + bonus.amount, 0);
export function sheetShield(run: Run): number {
  const swept = run.phase === 'reward' || run.phase === 'won' ? run.lastReport?.sweep ?? [] : [];
  const filled = (cell: number) => run.cells[cell] !== 0 && !swept.includes(cell);
  const marked = run.marks.reduce((sum, mark, cell) => sum + (mark === 'shield' && !run.givens[cell] && filled(cell) ? 6 : 0), 0);
  const completed = run.inventory.includes('ward') ? UNITS.filter(unit => unit.some(cell => !run.givens[cell]) && unit.every(filled)).length * 3 : 0;
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
    character, skillRank: 1, stage: 0, turn: 0, phase: 'battle', cells: [], solution: [], givens: [], marks: [],
    puzzleOrder: random.shuffle(bank.map((_, i) => i)), puzzleCursor: 0, sheet: 1, encounterSheet: 1, spellLevel: 1,
    hp: 40, maxHp: 40, mana: 0, manaOverflow: 0, enemyHp: 0, score: 0, inventory: [], acquisitionRank: {}, tier: {},
    pool: RELICS.filter(r => r.unlock <= save.meta.clears).map(r => r.id), rewards: [], afterglow: false,
    stats: { moves: 0, filled: 0, bestChain: 0, kills: 0, skills: 0, sheets: 0 }, lastReport: null,
  };
  prepareBoard(run, random); run.enemyHp = enemyOf(0, run.balanceVersion).hp; run.randomState = random.state;
  next.run = run; next.meta.runs++;
  return next;
}
export function incomingAttack(run: Run): number {
  const enemy = enemyOf(run.stage, run.balanceVersion);
  return Math.min(Number.MAX_SAFE_INTEGER, enemy.attack * (enemy.strongEvery && (run.turn + 1) % enemy.strongEvery === 0 ? 2 : 1));
}
const greaterIds: GreaterRelicId[] = ['stroke', 'trinity'];
export function canTakeReward(run: Run, id: RewardId): boolean {
  const boss = run.balanceVersion === 2 && (run.stage + 1) % 5 === 0;
  if (id === 'skill-upgrade') return boss && run.skillRank < 2;
  if (id.startsWith('greater:')) {
    const relic = id.slice(8) as GreaterRelicId;
    return boss && greaterIds.includes(relic) && run.pool.includes(relic) && relicTier(run, relic) < 2;
  }
  if (REPEATABLE_REWARDS.some(reward => reward.id === id)) return true;
  if (boss) return false;
  const relic = id as RelicId;
  return run.pool.includes(relic) && (!run.inventory.includes(relic) || relic === 'trinity' && relicRank(run, relic) < 3);
}
function rollRewards(run: Run, random: Random): RewardId[] {
  let chosen: RewardId[];
  if (run.balanceVersion === 2 && (run.stage + 1) % 5 === 0) {
    chosen = run.skillRank < 2 ? ['skill-upgrade'] : [];
    chosen.push(...random.shuffle(greaterIds.map(id => `greater:${id}` as RewardId).filter(id => canTakeReward(run, id))).slice(0, 2));
  } else {
    const available = random.shuffle(run.pool.filter(id => canTakeReward(run, id)));
    const match = available.find(id => characterOf(run.character).affinity.includes(id));
    chosen = match ? [match, ...available.filter(id => id !== match).slice(0, 2)] : available.slice(0, 3);
  }
  chosen.push(...random.shuffle(REPEATABLE_REWARDS.map(reward => reward.id)).slice(0, 3 - chosen.length));
  return random.shuffle(chosen);
}

interface CastPlan { run: Run; report: Report; chance: number; procMultiplier: number }
/** Only deterministic board/path work. No RNG, reward roll or next-board generation. */
function planCast(source: Run, cell: number, skill: boolean): CastPlan {
  if (source.phase !== 'battle' || !Number.isInteger(cell) || cell < 0 || cell >= 81 || source.cells[cell]) throw new Error('空きマスを選んでください。');
  if (skill ? source.mana < 8 : candidates(source.cells, cell).length !== 1) throw new Error(skill ? '魔力が足りません。' : '数字が確定したマスを選んでください。');
  const run = structuredClone(source), has = (id: RelicId) => run.inventory.includes(id);
  const bonuses = chainBonuses(run, skill);
  let fuel = bonuses.reduce((sum, bonus) => sum + bonus.amount, 0);
  const chain: ChainTrace = { initialAuto: fuel, bonuses, steps: [], stopReason: 'no-target', remainingAuto: fuel };
  const initiallySingle = source.cells.map((value, target) => !value && candidates(source.cells, target).length === 1);
  if (!skill) run.afterglow = false;
  let base = 0, completion = 0, weak = 0, rekindled = false, hopped = false;
  const path: FillEvent[] = [];
  const fill = (target: number, kind: FillEvent['source'], from: number | null, eligibleCells: number[], hop = false) => {
    if (run.cells[target]) throw new Error('同じマスを二度埋めることはできません。');
    const candidateValues = candidates(run.cells, target), remainingBefore = fuel;
    const distance = (i: number) => from === null ? 0 : Math.abs(row(from) - row(i)) + Math.abs(col(from) - col(i));
    const tiedCells = from === null ? [] : eligibleCells.filter(i => distance(i) === distance(eligibleCells[0]));
    if (kind === 'chain') fuel--;
    run.cells[target] = run.solution[target];
    const units = UNITS.flatMap((unit, id) => unit.includes(target) && unit.every(i => run.cells[i] !== 0) ? [id] : []);
    path.push({ cell: target, value: run.cells[target], ordinal: path.length + 1, source: kind, units, mark: run.marks[target], ...(hop ? { hop: true } : {}) });
    // Stroke doubles contributions belonging to its first 3/5 newly filled cells,
    // rather than multiplying an entire short cast or punishing a longer chain.
    const stroke = has('stroke') && path.length <= (relicTier(run, 'stroke') === 2 ? 5 : 3) ? 2 : 1;
    base += (10 + (path.length - 1) * 2) * stroke;
    completion += units.length * (20 + (run.character === 'scribe' ? 10 : 0) + (has('pen') ? 20 : 0)) * stroke;
    if (run.marks[target] === 'weak') weak += (has('lens') ? 20 : 8) * stroke;
    const addedAuto = has('rekindle') && units.length && !rekindled ? 3 : 0;
    if (addedAuto) { fuel += addedAuto; rekindled = true; }
    chain.steps.push({ from, cell: target, source: kind,
      sharedUnits: from === null ? [] : UNITS.flatMap((unit, id) => unit.includes(from) && unit.includes(target) ? [id] : []),
      candidateValues, eligibleCells, tiedCells, initiallySingle: initiallySingle[target], remainingBefore, remainingAfter: fuel, addedAuto,
      ...(hop ? { hop: true } : {}),
    });
  };
  let current = cell;
  const roots = run.cells.flatMap((value, target) => !value && (skill || initiallySingle[target]) ? [target] : []);
  fill(current, 'root', null, roots);
  if (has('echo')) {
    const eligible = run.cells.flatMap((v, i) => !v && run.solution[i] === run.solution[cell] ? [i] : []).sort((a, b) => near(cell, a, b));
    if (eligible[0] !== undefined) { fill(eligible[0], 'echo', current, eligible); current = eligible[0]; }
  }
  while (fuel > 0) {
    let eligible = PEERS[current].filter(i => !run.cells[i] && candidates(run.cells, i).length === 1).sort((a, b) => near(current, a, b));
    let hop = false;
    if (!eligible.length && skill && run.character === 'fuse' && run.skillRank === 2 && !hopped) {
      eligible = run.cells.flatMap((v, i) => !v && run.solution[i] === run.solution[current] ? [i] : []).sort((a, b) => near(current, a, b));
      hop = eligible.length > 0;
    }
    if (eligible[0] === undefined) break;
    if (hop) hopped = true;
    fill(eligible[0], 'chain', current, eligible, hop); current = eligible[0];
  }
  chain.remainingAuto = fuel;
  const fullClear = run.cells.every(Boolean);
  chain.stopReason = fullClear ? 'board-complete' : fuel === 0 ? 'limit' : 'no-target';
  if (skill && run.character === 'scribe') completion *= run.skillRank === 2 ? 4 : 3;
  let multiplier = spellMultiplier(run.spellLevel) * (has('glass') ? 1.25 : 1);
  if (skill && has('amplifier')) multiplier *= 1.5;
  if (skill && run.character === 'lumen') multiplier *= run.skillRank === 2 ? 2.5 : 2;
  const baseDamage = Math.floor((base + completion + weak) * multiplier);
  const initialBlanks = run.givens.filter(given => !given).length;
  const clearRatio = fullClear && initialBlanks ? path.length / initialBlanks : 0;
  // Multiply the integer numerator first: a rounded ratio such as 23/36 can
  // otherwise turn an exact 1656 into 1655.9999999999998 before floor().
  const clearBonus = fullClear && initialBlanks ? Math.floor(baseDamage * path.length / (4 * initialBlanks)) : 0;
  const oneCastClear = fullClear && path.length === initialBlanks && source.cells.every((value, i) => source.givens[i] || value === 0);
  const oldMana = run.mana, stored = run.manaOverflow;
  if (skill) { run.mana = stored; run.manaOverflow = 0; }
  else {
    const gained = path.length + (run.character === 'lumen' ? 1 : 0) + (has('battery') ? 2 : 0);
    run.mana = Math.min(8, oldMana + gained);
    run.manaOverflow = has('battery') ? Math.min(2, stored + Math.max(0, oldMana + gained - 8)) : 0;
  }
  if (skill && has('afterglow')) run.afterglow = true;
  const report: Report = {
    skill, path, chain, damage: baseDamage + clearBonus, baseDamage, guaranteedDamage: baseDamage + clearBonus,
    clearBonus, clearRatio, oneCastClear, attackScore: 0, shield: sheetShield(run), incoming: incomingAttack(source), received: 0, healed: 0,
    charge: skill ? 0 : run.mana - oldMana, manaOverflow: run.manaOverflow, manaRestored: skill ? stored : 0,
    units: path.reduce((n, event) => n + event.units.length, 0), weak: path.filter(event => event.mark === 'weak').length,
    defeated: false, fullClear, sweep: [], hpBefore: source.hp, enemyBefore: source.enemyHp,
    sheetAdvanced: false, levelsGained: 0, spellLevelBefore: source.spellLevel, spellLevelAfter: source.spellLevel, maxHpGained: 0,
  };
  const eligible = has('trinity') && path.some(event => event.value === 3);
  return { run, report, chance: eligible ? [0.3, 0.45, 0.6][relicRank(run, 'trinity') - 1] : 0, procMultiplier: relicTier(run, 'trinity') === 2 ? 2 : 1.5 };
}
/** Isolated, versioned per-cast/effect domain: previews never call this function. */
function trinityRoll(seed: number, castCounter: number): number {
  let value = (seed ^ 0x74726933 ^ Math.imul(castCounter + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 0x100000000;
}
/** Settle without RNG. Used for both bounds and the one committed outcome. */
function settleCast(plan: CastPlan, damage: number): Run {
  const run = structuredClone(plan.run), report = structuredClone(plan.report);
  report.damage = damage; report.defeated = damage >= run.enemyHp;
  report.received = report.defeated ? 0 : Math.max(0, report.incoming - report.shield);
  report.attackScore = Math.floor(damage * (run.inventory.includes('gold') ? 1.5 : 1));
  run.enemyHp = Math.max(0, run.enemyHp - damage); run.hp = Math.max(0, run.hp - report.received); run.score += report.attackScore;
  run.turn++; run.castCounter++; run.stats.moves++; run.stats.filled += report.path.length;
  run.stats.bestChain = Math.max(run.stats.bestChain, report.path.length);
  if (report.skill) run.stats.skills++;
  if (report.fullClear) run.stats.sheets++;
  if (report.defeated) {
    run.stats.kills++; run.score += 500;
    report.sweep = run.cells.flatMap((v, i) => v ? [] : [i]); run.cells = [...run.solution];
    grow(run, report, report.fullClear ? 2 : 1); run.phase = 'reward';
  } else if (!run.hp) run.phase = 'lost';
  else if (report.fullClear) { grow(run, report, 1); report.sheetAdvanced = true; }
  run.lastReport = report;
  return run;
}
export function previewAction(run: Run, cell: number, skill = false): Preview {
  const plan = planCast(run, cell, skill), minimum = settleCast(plan, plan.report.guaranteedDamage!);
  const report: Preview = minimum.lastReport!;
  if (plan.chance) {
    const maximum = settleCast(plan, Math.floor(plan.report.baseDamage! * plan.procMultiplier) + plan.report.clearBonus!);
    const best = maximum.lastReport!;
    report.forecast = {
      damageMax: best.damage, attackScoreMax: best.attackScore, chance: plan.chance, multiplier: plan.procMultiplier,
      receivedMin: Math.min(report.received, best.received), receivedMax: Math.max(report.received, best.received),
      healedMin: Math.min(report.healed, best.healed), healedMax: Math.max(report.healed, best.healed),
      levelsGainedMin: Math.min(report.levelsGained!, best.levelsGained!), levelsGainedMax: Math.max(report.levelsGained!, best.levelsGained!),
      kill: report.defeated ? 'guaranteed' : best.defeated ? 'possible' : 'none',
      survival: minimum.hp > 0 ? 'certain' : maximum.hp > 0 ? 'possible' : 'none',
      sheetAdvancedCertain: !!report.sheetAdvanced && !!best.sheetAdvanced,
    };
  }
  return report;
}
/** One committed reducer; the state is persisted before any animation. */
export function resolveAction(source: Run, action: Action): Run {
  if (action.revision !== source.revision) throw new Error('この操作はすでに処理されています。');
  let run = structuredClone(source);
  const random = new Random(run.randomState);
  if (action.type === 'reward') {
    if (run.phase !== 'reward' || !run.rewards.includes(action.relic) || !canTakeReward(run, action.relic)) throw new Error('この報酬は選べません。');
    if (action.relic === 'training') { run.spellLevel++; run.maxHp += 4; run.hp = Math.min(run.maxHp, run.hp + 10); }
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
    run.stage++; run.balanceVersion = 2; nextBoard(run, random); run.encounterSheet = 1;
    run.enemyHp = enemyOf(run.stage, run.balanceVersion).hp;
    run.turn = 0; run.phase = 'battle'; run.rewards = []; run.lastReport = null;
  } else {
    const plan = planCast(source, action.cell, action.skill);
    let damage = plan.report.guaranteedDamage!;
    if (plan.chance) {
      const triggered = trinityRoll(source.seed, source.castCounter) < plan.chance;
      if (triggered) damage = Math.floor(plan.report.baseDamage! * plan.procMultiplier) + plan.report.clearBonus!;
      plan.report.proc = { id: 'trinity', chance: plan.chance, multiplier: plan.procMultiplier, triggered };
    }
    run = settleCast(plan, damage);
    if (run.lastReport!.defeated) run.rewards = rollRewards(run, random);
    else if (run.lastReport!.sheetAdvanced) nextBoard(run, random);
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
