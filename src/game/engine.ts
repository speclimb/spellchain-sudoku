import bank from './puzzles.json';
import { CHARACTERS, RELICS, REPEATABLE_REWARDS, characterOf, enemyOf } from './content';
import { Random, PEERS, UNITS, candidates, near, row, col } from './sudoku';
import type { Action, ChainTrace, FillEvent, Mark, Report, Run, Save, CharacterId, RelicId, RewardId } from './types';

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
/** Each deck contains every source once. Preserve the stream in the run for reloads/previews. */
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
  const next = structuredClone(save);
  const random = new Random(seed);
  const run: Run = {
    id: `run-${seed >>> 0}`, seed: seed >>> 0, randomState: seed >>> 0, revision: 0,
    character, stage: 0, turn: 0, phase: 'battle', cells: [], solution: [], givens: [], marks: [],
    puzzleOrder: random.shuffle(bank.map((_, i) => i)), puzzleCursor: 0, sheet: 1, encounterSheet: 1, spellLevel: 1,
    hp: 40, maxHp: 40, mana: 0, enemyHp: 0, score: 0, inventory: [],
    pool: RELICS.filter(r => r.unlock <= save.meta.clears).map(r => r.id), rewards: [], afterglow: false,
    stats: { moves: 0, filled: 0, bestChain: 0, kills: 0, skills: 0, sheets: 0 }, lastReport: null,
  };
  prepareBoard(run, random); run.enemyHp = enemyOf(0).hp; run.randomState = random.state;
  next.run = run; next.meta.runs++;
  return next;
}
export function incomingAttack(run: Run): number {
  const enemy = enemyOf(run.stage);
  return Math.min(Number.MAX_SAFE_INTEGER, enemy.attack * (enemy.strongEvery && (run.turn + 1) % enemy.strongEvery === 0 ? 2 : 1));
}
function rollRewards(run: Run, random: Random): RewardId[] {
  const available = random.shuffle(run.pool.filter(id => !run.inventory.includes(id)));
  const affinity = characterOf(run.character).affinity;
  const match = available.find(id => affinity.includes(id));
  const chosen: RewardId[] = match ? [match, ...available.filter(id => id !== match).slice(0, 2)] : available.slice(0, 3);
  chosen.push(...random.shuffle(REPEATABLE_REWARDS.map(reward => reward.id)).slice(0, 3 - chosen.length));
  return random.shuffle(chosen);
}
/** One deterministic reducer powers both prediction and execution. Never mutates source. */
export function resolveAction(source: Run, action: Action): Run {
  if (action.revision !== source.revision) throw new Error('この操作はすでに処理されています。');
  const run = structuredClone(source);
  const random = new Random(run.randomState);
  if (action.type === 'reward') {
    if (run.phase !== 'reward' || !run.rewards.includes(action.relic)) throw new Error('この報酬は選べません。');
    if (action.relic === 'training') { run.spellLevel++; run.maxHp += 4; run.hp = Math.min(run.maxHp, run.hp + 10); }
    else if (action.relic === 'vitality') { run.maxHp += 12; run.hp = Math.min(run.maxHp, run.hp + 12); }
    else if (action.relic === 'recovery') run.hp = run.maxHp;
    else {
      if (run.inventory.includes(action.relic)) throw new Error('この遺物は選べません。');
      run.inventory.push(action.relic);
      if (action.relic === 'glass') { run.maxHp -= 8; run.hp = Math.min(run.hp, run.maxHp); }
    }
    run.stage++; nextBoard(run, random); run.encounterSheet = 1;
    run.enemyHp = enemyOf(run.stage).hp;
    run.turn = 0; run.phase = 'battle'; run.rewards = []; run.lastReport = null;
  } else {
    if (run.phase !== 'battle' || !Number.isInteger(action.cell) || action.cell < 0 || action.cell >= 81 || run.cells[action.cell]) throw new Error('空きマスを選んでください。');
    if (action.skill ? run.mana < 8 : candidates(run.cells, action.cell).length !== 1) throw new Error(action.skill ? '魔力が足りません。' : '数字が確定したマスを選んでください。');
    const has = (id: RelicId) => run.inventory.includes(id);
    const bonuses = chainBonuses(run, action.skill);
    let fuel = bonuses.reduce((sum, bonus) => sum + bonus.amount, 0);
    const chain: ChainTrace = { initialAuto: fuel, bonuses, steps: [], stopReason: 'no-target', remainingAuto: fuel };
    const initiallySingle = source.cells.map((value, cell) => !value && candidates(source.cells, cell).length === 1);
    if (!action.skill) run.afterglow = false;
    let baseDamage = 0, completionDamage = 0, weakDamage = 0, shield = 0, rekindled = false;
    const path: FillEvent[] = [];
    const fill = (cell: number, kind: FillEvent['source'], from: number | null, eligibleCells: number[]) => {
      if (run.cells[cell]) throw new Error('同じマスを二度埋めることはできません。');
      const candidateValues = candidates(run.cells, cell);
      const remainingBefore = fuel;
      const distance = (target: number) => from === null ? 0 : Math.abs(row(from) - row(target)) + Math.abs(col(from) - col(target));
      const tiedCells = from === null ? [] : eligibleCells.filter(target => distance(target) === distance(eligibleCells[0]));
      if (kind === 'chain') fuel--;
      run.cells[cell] = run.solution[cell];
      const units = UNITS.flatMap((unit, id) => unit.includes(cell) && unit.every(i => run.cells[i] !== 0) ? [id] : []);
      path.push({ cell, value: run.cells[cell], ordinal: path.length + 1, source: kind, units, mark: run.marks[cell] });
      baseDamage += 10 + (path.length - 1) * 2;
      completionDamage += units.length * (20 + (run.character === 'scribe' ? 10 : 0) + (has('pen') ? 20 : 0));
      if (run.marks[cell] === 'weak') weakDamage += has('lens') ? 20 : 8;
      if (run.marks[cell] === 'shield') shield += 6;
      if (has('ward')) shield += units.length * 3;
      const addedAuto = has('rekindle') && units.length && !rekindled ? 3 : 0;
      if (addedAuto) { fuel += addedAuto; rekindled = true; }
      chain.steps.push({
        from, cell, source: kind,
        sharedUnits: from === null ? [] : UNITS.flatMap((unit, id) => unit.includes(from) && unit.includes(cell) ? [id] : []),
        candidateValues, eligibleCells, tiedCells, initiallySingle: initiallySingle[cell],
        remainingBefore, remainingAfter: fuel, addedAuto,
      });
    };
    let current = action.cell;
    const roots = run.cells.flatMap((value, cell) => !value && (action.skill || initiallySingle[cell]) ? [cell] : []);
    fill(current, 'root', null, roots);
    if (has('echo')) {
      const eligible = run.cells.flatMap((v, i) => !v && run.solution[i] === run.solution[action.cell] ? [i] : []).sort((a, b) => near(action.cell, a, b));
      const echo = eligible[0];
      if (echo !== undefined) { fill(echo, 'echo', current, eligible); current = echo; }
    }
    while (fuel > 0) {
      const eligible = PEERS[current].filter(i => !run.cells[i] && candidates(run.cells, i).length === 1).sort((a, b) => near(current, a, b));
      const target = eligible[0];
      if (target === undefined) break;
      fill(target, 'chain', current, eligible); current = target;
    }
    chain.remainingAuto = fuel;
    chain.stopReason = run.cells.every(Boolean) ? 'board-complete' : fuel === 0 ? 'limit' : 'no-target';
    if (action.skill && run.character === 'scribe') completionDamage *= 3;
    let multiplier = spellMultiplier(run.spellLevel) * (has('glass') ? 1.25 : 1);
    if (has('stroke') && path.length <= 3) multiplier *= 2;
    if (action.skill && has('amplifier')) multiplier *= 1.5;
    if (action.skill && run.character === 'lumen') multiplier *= 2;
    const damage = Math.floor((baseDamage + completionDamage + weakDamage) * multiplier);
    const fullClear = run.cells.every(Boolean);
    const defeated = damage >= run.enemyHp;
    const incoming = incomingAttack(run);
    const received = defeated ? 0 : Math.max(0, incoming - shield);
    const attackScore = Math.floor(damage * (has('gold') ? 1.5 : 1));
    const oldMana = run.mana;
    run.mana = action.skill ? 0 : Math.min(8, run.mana + path.length + (run.character === 'lumen' ? 1 : 0) + (has('battery') ? 2 : 0));
    if (action.skill && has('afterglow')) run.afterglow = true;
    const report: Report = {
      skill: action.skill, path, chain, damage, attackScore, shield, incoming, received, healed: 0,
      charge: action.skill ? 0 : run.mana - oldMana,
      units: path.reduce((n, event) => n + event.units.length, 0), weak: path.filter(e => e.mark === 'weak').length,
      defeated, fullClear, sweep: [], hpBefore: run.hp, enemyBefore: run.enemyHp,
      sheetAdvanced: false, levelsGained: 0, spellLevelBefore: run.spellLevel, spellLevelAfter: run.spellLevel, maxHpGained: 0,
    };
    run.enemyHp = defeated ? 0 : Math.max(0, run.enemyHp - damage);
    run.hp = Math.max(0, run.hp - received);
    run.score += attackScore;
    run.turn++; run.stats.moves++; run.stats.filled += path.length;
    run.stats.bestChain = Math.max(run.stats.bestChain, path.length);
    if (action.skill) run.stats.skills++;
    if (fullClear) run.stats.sheets++;
    if (defeated) {
      run.stats.kills++; run.score += 500;
      report.sweep = run.cells.flatMap((v, i) => v ? [] : [i]);
      run.cells = [...run.solution];
      grow(run, report, fullClear ? 2 : 1);
      run.phase = 'reward'; run.rewards = rollRewards(run, random);
    } else if (!run.hp) run.phase = 'lost';
    else if (fullClear) {
      grow(run, report, 1); nextBoard(run, random); report.sheetAdvanced = true;
    }
    run.lastReport = report;
  }
  run.randomState = random.state;
  run.revision++;
  return run;
}
export function previewAction(run: Run, cell: number, skill = false): Report {
  return resolveAction(run, { type: 'play', cell, skill, revision: run.revision }).lastReport!;
}
/** Persist this complete envelope once; progression and the run advance atomically. */
export function dispatch(save: Save, action: Action): Save {
  if (!save.run) throw new Error('冒険が開始されていません。');
  const next = structuredClone(save);
  const run = resolveAction(save.run, action);
  next.meta.clears += run.stats.kills - save.run.stats.kills;
  next.meta.bestKills = Math.max(next.meta.bestKills, run.stats.kills);
  if (run.phase === 'won' || run.phase === 'lost') next.meta.bestScore = Math.max(next.meta.bestScore, run.score);
  next.run = run;
  return next;
}
