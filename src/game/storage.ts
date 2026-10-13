import { CHARACTERS, RELICS, REPEATABLE_REWARDS, enemyOf, greaterIds, primeIds } from './content';
import { Random, UNITS } from './sudoku';
import bank from './puzzles.json';
import { canTakeReward } from './rewards';
import { newSave } from './engine';
import type { Run, Save } from './types';
export const SAVE_KEY = 'chain-incantation.save.v1';
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const vector = (v: unknown, length: number, check: (v: any) => boolean) => Array.isArray(v) && v.length === length && v.every(check);
export function parseSave(raw: string): Save {
  const data: unknown = JSON.parse(raw);
  if (!record(data) || data.version !== 1 || !record(data.meta) || !record(data.settings)) throw new Error('保存形式を読み込めません。');
  if (!['clears', 'runs', 'wins', 'bestScore'].every(k => integer(data.meta[k])) || typeof data.meta.tutorialDone !== 'boolean' || !['sound', 'fast', 'reducedMotion'].every(k => typeof data.settings[k] === 'boolean')) throw new Error('記録が破損しています。');
  if (data.meta.bestKills !== undefined && !integer(data.meta.bestKills)) throw new Error('記録が破損しています。');
  const r = data.run;
  if (r !== null) {
    const relics = new Set<string>(RELICS.map(x => x.id));
    const relicList = (v: unknown) => Array.isArray(v) && new Set(v).size === v.length && v.every(id => relics.has(id));
    const rewardIds = new Set([...relics, ...REPEATABLE_REWARDS.map(x => x.id), 'skill-upgrade', ...greaterIds.map(id => `greater:${id}`)]);
    const rewardList = (v: unknown) => Array.isArray(v) && new Set(v).size === v.length && v.every(id => rewardIds.has(id));
    if (!record(r) || !CHARACTERS.some(c => c.id === r.character) || !['battle', 'reward', 'won', 'lost'].includes(r.phase) || typeof r.id !== 'string' || typeof r.afterglow !== 'boolean') throw new Error('冒険の記録を読み込めません。');
    // Version the encounter balance rather than lowering or rejecting an old
    // enemy's current HP. Choosing its existing reward is the transition point.
    const needsEndgameMigration = r.freeSkillTokens === undefined && r.reservedAuto === undefined && r.boons === undefined;
    if (r.freeSkillTokens === undefined) r.freeSkillTokens = 0;
    if (r.reservedAuto === undefined) r.reservedAuto = 0;
    if (r.boons === undefined) r.boons = { defense: 0, magic: 0 };
    if (r.balanceVersion === undefined) r.balanceVersion = 1;
    if (r.skillRank === undefined) r.skillRank = 1;
    if (r.manaOverflow === undefined) r.manaOverflow = 0;
    if (r.acquisitionRank === undefined) r.acquisitionRank = {};
    if (r.tier === undefined) r.tier = {};
    if (![1, 2].includes(r.balanceVersion) || ![1, 2].includes(r.skillRank) || !integer(r.manaOverflow, 0, 2)) throw new Error('成長の記録が不正です。');
    if (!integer(r.seed, 0, 0xffffffff) || !integer(r.randomState, 0, 0xffffffff) || !integer(r.revision) || !integer(r.stage) || !integer(r.turn) || !integer(r.maxHp, 1) || !integer(r.hp, 0, r.maxHp) || !integer(r.mana, 0, 8) || !integer(r.enemyHp, 0, enemyOf(r.stage, r.balanceVersion).hp) || !integer(r.score)) throw new Error('冒険の数値が不正です。');
    // The original v1 run stored six future boards. Keep that prefix, its current
    // board, HP and reward roll intact, then append all unused sources with a
    // separate deterministic stream so migration never rerolls combat/rewards.
    if (r.puzzleCursor === undefined && r.sheet === undefined && r.encounterSheet === undefined && r.spellLevel === undefined) {
      if (r.stage > 5 || !vector(r.puzzleOrder, 6, v => integer(v, 0, bank.length - 1)) || new Set(r.puzzleOrder).size !== 6) throw new Error('問題の記録が不正です。');
      const unused = bank.map((_, i) => i).filter(i => !r.puzzleOrder.includes(i));
      r.puzzleOrder = [...r.puzzleOrder, ...new Random(r.seed ^ 0x51ee7).shuffle(unused)];
      r.puzzleCursor = r.stage; r.sheet = r.stage + 1; r.encounterSheet = 1;
      r.spellLevel = 1 + (record(r.stats) && integer(r.stats.kills, 0, 6) ? r.stats.kills : 0);
      if (record(r.stats)) r.stats.sheets = 0;
    }
    if (!integer(r.puzzleCursor, 0, bank.length - 1) || !integer(r.sheet, 1) || !integer(r.encounterSheet, 1, r.sheet) || !integer(r.spellLevel, 1, 1000000)) throw new Error('成長の記録が不正です。');
    if (!vector(r.solution, 81, v => integer(v, 1, 9)) || !UNITS.every(u => new Set(u.map(i => r.solution[i])).size === 9) || !vector(r.cells, 81, v => integer(v, 0, 9)) || !r.cells.every((v: number, i: number) => v === 0 || v === r.solution[i]) || !vector(r.givens, 81, v => typeof v === 'boolean') || r.givens.filter(Boolean).length !== 45 || !r.givens.every((v: boolean, i: number) => !v || r.cells[i] !== 0)) throw new Error('盤面の記録が不正です。');
    if (!vector(r.marks, 81, v => v === null || v === 'weak' || v === 'shield') || ['weak', 'shield'].some(kind => r.marks.filter((v: string) => v === kind).length !== 3) || !vector(r.puzzleOrder, bank.length, v => integer(v, 0, bank.length - 1)) || new Set(r.puzzleOrder).size !== bank.length) throw new Error('問題の記録が不正です。');
    if (!relicList(r.inventory) || !relicList(r.pool) || !rewardList(r.rewards) || !r.inventory.every((id: string) => r.pool.includes(id)) || (r.phase === 'reward' && r.rewards.length !== 3)) throw new Error('遺物の記録が不正です。');
    if (needsEndgameMigration) {
      // Extend only the new always-unlocked relics. Never alter an existing roll
      // or the combat/board/reward random stream during migration.
      for (const id of ['duality', 'quint', 'sept']) if (!r.pool.includes(id)) r.pool.push(id);
    }
    if (!integer(r.freeSkillTokens, 0, r.tier.quint === 2 ? 2 : 1) || (r.freeSkillTokens > 0 && !r.inventory.includes('quint'))
      || ![0, 7, 14].includes(r.reservedAuto) || (r.reservedAuto > 0 && !r.inventory.includes('sept')) || (r.reservedAuto === 14 && r.tier.sept !== 2)
      || !record(r.boons) || Object.keys(r.boons).length !== 2 || !integer(r.boons.defense, 0, 5) || !integer(r.boons.magic, 0, 5)) throw new Error('祝福と予約の記録が不正です。');
    const validRelicMap = (value: unknown, kind: 'rank' | 'tier') => record(value) && Object.entries(value).every(([id, n]) =>
      r.inventory.includes(id) && integer(n, 1, kind === 'rank' ? (primeIds.includes(id as any) ? 3 : 1) : (greaterIds.includes(id as any) ? 2 : 1)));
    if (!validRelicMap(r.acquisitionRank, 'rank') || !validRelicMap(r.tier, 'tier') || (r.manaOverflow > 0 && (!r.inventory.includes('battery') || r.mana !== 8))) throw new Error('遺物の成長記録が不正です。');
    const validReward = (id: string) => canTakeReward(r as Run, id as any);
    if (!r.rewards.every(validReward) || ((r.phase === 'battle' || r.phase === 'lost') && r.rewards.length)) throw new Error('遺物の記録が不正です。');
    if (!record(r.stats) || !['moves', 'filled', 'bestChain', 'kills', 'skills', 'sheets'].every(k => integer(r.stats[k])) || r.stats.kills !== r.stage + (r.phase === 'reward' || r.phase === 'won' ? 1 : 0)) throw new Error('戦績の記録が不正です。');
    if (r.castCounter === undefined) r.castCounter = r.stats.moves;
    if (!integer(r.castCounter) || r.castCounter !== r.stats.moves) throw new Error('詠唱回数の記録が不正です。');
    if ((r.phase === 'battle' && (!r.hp || !r.enemyHp || !r.cells.includes(0))) || (r.phase === 'lost' && r.hp !== 0) || (r.phase === 'won' && r.stage !== 5) || ((r.phase === 'won' || r.phase === 'reward') && (r.enemyHp !== 0 || r.cells.includes(0)))) throw new Error('冒険の進行が不正です。');
    if (r.lastReport !== null) validateReport(r as Run);
  }
  if (data.meta.bestKills === undefined) data.meta.bestKills = Math.max(data.meta.wins ? 6 : 0, r?.stats.kills ?? 0);
  return data as unknown as Save;
}
/** Reports are persisted before animation. Validate each sheet independently so
 * repeated cell coordinates across sheets are legal, but duplicate fills aren't. */
function validateReport(run: Run): void {
  const r = run as any, p = r.lastReport;
  const fail = (message = '詠唱の記録が不正です。'): never => { throw new Error(message); };
  const indexes = (v: unknown, min: number, max: number): v is number[] => Array.isArray(v) && new Set(v).size === v.length && v.every(n => integer(n, min, max));
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, i) => value === b[i]);
  if (!record(p) || !Array.isArray(p.path) || !p.path.length
    || !p.path.every((e: any, i: number) => record(e) && integer(e.cell, 0, 80) && integer(e.value, 1, 9) && e.ordinal === i + 1
      && ['root', 'echo', 'chain'].includes(e.source) && (e.sheet === undefined || integer(e.sheet, 1, r.sheet))
      && (e.sheetStart === undefined || typeof e.sheetStart === 'boolean')
      && (e.hop === undefined || (typeof e.hop === 'boolean' && (!e.hop || e.source === 'chain')))
      && [null, 'weak', 'shield'].includes(e.mark) && indexes(e.units, 0, 26))
    || !['damage', 'attackScore', 'shield', 'incoming', 'received', 'healed', 'charge', 'units', 'weak', 'hpBefore', 'enemyBefore'].every(k => integer(p[k]))
    || !['skill', 'defeated', 'fullClear'].every(k => typeof p[k] === 'boolean') || !indexes(p.sweep, 0, 80)) fail();
  // The original six-encounter reducer also marked a completed sheet as a
  // victory. Preserve that historical report format, without allowing it for
  // later balance versions, growth-era reports, or multi-sheet reports.
  const originalClearVictory = r.balanceVersion === 1 && r.stage <= 5 && p.fullClear && p.defeated && !p.sweep.length
    && ['segments', 'sheetsCompleted', 'levelsGained', 'spellLevelBefore', 'spellLevelAfter', 'maxHpGained', 'baseDamage', 'guaranteedDamage', 'clearBonus'].every(key => p[key] === undefined)
    && p.path.every((event: any) => event.sheet === undefined);
  if (p.hpBefore < 1 || p.hpBefore > r.maxHp - (p.maxHpGained ?? 0) || p.enemyBefore < 1
    || p.defeated !== (p.damage >= p.enemyBefore || originalClearVictory) || p.defeated !== (r.phase === 'reward' || r.phase === 'won')
    || r.enemyHp !== (originalClearVictory ? 0 : Math.max(0, p.enemyBefore - p.damage))
    || r.hp !== Math.min(r.maxHp, Math.max(0, p.hpBefore - p.received) + p.healed)
    || p.attackScore !== Math.floor(p.damage * (r.inventory.includes('gold') ? 1.5 : 1))) fail('詠唱の決着記録が不正です。');
  if (p.path[0].source !== 'root' || p.path.slice(1).some((e: any) => e.source === 'root')
    || p.path.filter((e: any) => e.source === 'echo').length > 1
    || p.units !== p.path.reduce((sum: number, e: any) => sum + e.units.length, 0)
    || p.weak !== p.path.filter((e: any) => e.mark === 'weak').length) fail();

  let completed = p.fullClear ? 1 : 0, finalFull = p.fullClear;
  let finalPath = p.path;
  let clearRatio = p.fullClear ? p.path.length / 36 : 0;
  let oneCastClear = p.fullClear && p.path.length === 36;
  if (p.segments !== undefined) {
    if (!Array.isArray(p.segments) || !p.segments.length) fail();
    let nextPath = 0, previousSheet = 0, totalBase = 0, totalClear = 0, maxShield = 0;
    completed = 0; clearRatio = 0; oneCastClear = false;
    for (let index = 0; index < p.segments.length; index++) {
      const segment = p.segments[index];
      if (!record(segment) || !integer(segment.sheet, 1, r.sheet) || (index > 0 && segment.sheet !== previousSheet + 1)
        || segment.pathStart !== nextPath || !integer(segment.pathEnd, nextPath + 1, p.path.length)
        || !vector(segment.solution, 81, v => integer(v, 1, 9)) || !UNITS.every(unit => new Set(unit.map(cell => segment.solution[cell])).size === 9)
        || !vector(segment.cells, 81, v => integer(v, 0, 9)) || !segment.cells.every((v: number, cell: number) => v === 0 || v === segment.solution[cell])
        || !vector(segment.givens, 81, v => typeof v === 'boolean') || segment.givens.filter(Boolean).length !== 45
        || !segment.givens.every((given: boolean, cell: number) => !given || segment.cells[cell] !== 0)
        || !vector(segment.marks, 81, v => v === null || v === 'weak' || v === 'shield')
        || ['weak', 'shield'].some(kind => segment.marks.filter((mark: string) => mark === kind).length !== 3)
        || !integer(segment.baseDamage) || !integer(segment.clearBonus)
        || typeof segment.fullClear !== 'boolean' || typeof segment.oneCastClear !== 'boolean') fail('シート別の詠唱記録が不正です。');
      const events = p.path.slice(segment.pathStart, segment.pathEnd), cells = [...segment.cells];
      for (const event of events) {
        if (event.sheet !== segment.sheet || cells[event.cell] !== 0 || segment.givens[event.cell] || event.value !== segment.solution[event.cell] || event.mark !== segment.marks[event.cell]) fail('シート別の詠唱記録が不正です。');
        cells[event.cell] = event.value;
        const units = UNITS.flatMap((unit, id) => unit.includes(event.cell) && unit.every(cell => cells[cell] !== 0) ? [id] : []);
        if (!same(units, event.units)) fail('シート別の詠唱記録が不正です。');
      }
      const shield = segment.marks.reduce((sum: number, mark: string | null, cell: number) => sum + (mark === 'shield' && !segment.givens[cell] && cells[cell] ? 6 : 0), 0)
        + (r.inventory.includes('ward') ? UNITS.filter(unit => unit.some(cell => !segment.givens[cell]) && unit.every(cell => cells[cell])).length * 3 : 0);
      maxShield = Math.max(maxShield, shield);
      const full = cells.every(Boolean), ratio = full ? events.length / 36 : 0;
      const singleCast = full && events.length === 36 && segment.cells.every((value: number, cell: number) => segment.givens[cell] || value === 0);
      if (segment.fullClear !== full || segment.clearRatio !== ratio || segment.oneCastClear !== singleCast
        || segment.clearBonus !== (full ? Math.floor(segment.baseDamage * events.length / (4 * 36)) : 0)
        || (index < p.segments.length - 1 && !full)) fail('シート別の詠唱記録が不正です。');
      completed += Number(full); clearRatio = Math.max(clearRatio, ratio); oneCastClear ||= singleCast;
      totalBase += segment.baseDamage; totalClear += segment.clearBonus;
      nextPath = segment.pathEnd; previousSheet = segment.sheet;
      if (index === p.segments.length - 1) {
        finalFull = full; finalPath = events;
        // A terminal completed board advances only after surviving retaliation.
        const advancedAfterCast = full && p.sheetAdvanced === true && !p.defeated;
        if (r.sheet !== segment.sheet + Number(advancedAfterCast)) fail('シート別の詠唱記録が不正です。');
        if (!advancedAfterCast) {
          if (!same(segment.solution, r.solution) || !same(segment.givens, r.givens) || !same(segment.marks, r.marks)) fail('シート別の詠唱記録が不正です。');
          const swept = cells.flatMap((value, cell) => value ? [] : [cell]);
          if (p.defeated) {
            if (!same(swept, p.sweep) || !same(segment.solution, r.cells)) fail('シート別の詠唱記録が不正です。');
          } else if (!same(cells, r.cells)) fail('シート別の詠唱記録が不正です。');
        }
      }
    }
    if (p.shield !== maxShield || nextPath !== p.path.length || p.fullClear !== (completed > 0)
      || (p.baseDamage !== undefined && p.baseDamage !== totalBase) || (p.clearBonus !== undefined && p.clearBonus !== totalClear)) fail('シート別の詠唱記録が不正です。');
  } else if (new Set(p.path.map((e: any) => e.cell)).size !== p.path.length
    || new Set(p.path.map((e: any) => e.sheet)).size !== 1) fail();
  if (p.path.some((event: any, index: number) => !!event.sheetStart !== (index > 0 && event.sheet !== p.path[index - 1].sheet))
    || new Set(p.path.map((e: any) => `${e.sheet ?? 0}:${e.cell}`)).size !== p.path.length
    || p.sweep.some((cell: number) => finalPath.some((event: any) => event.cell === cell))
    || (!p.defeated && p.sweep.length) || (p.sheetsCompleted !== undefined && p.sheetsCompleted !== completed)) fail();

  if ((p.sheetAdvanced !== undefined && (typeof p.sheetAdvanced !== 'boolean' || (p.sheetAdvanced && (!p.fullClear || p.defeated || r.phase !== 'battle'))))
    || (p.levelsGained !== undefined && (!integer(p.levelsGained) || p.levelsGained !== (r.hp > 0 ? completed + Number(p.defeated) : 0)))
    || (p.maxHpGained !== undefined && (!integer(p.maxHpGained) || p.maxHpGained !== p.levelsGained * 4))
    || (p.spellLevelBefore !== undefined && !integer(p.spellLevelBefore, 1, 1000000))
    || (p.spellLevelAfter !== undefined && (p.spellLevelAfter !== r.spellLevel || p.spellLevelAfter !== p.spellLevelBefore + p.levelsGained))) fail('成長の記録が不正です。');
  if (['guaranteedDamage', 'baseDamage', 'clearBonus', 'manaOverflow', 'manaRestored'].some(key => p[key] !== undefined && !integer(p[key], 0, key === 'manaOverflow' || key === 'manaRestored' ? 2 : Number.MAX_SAFE_INTEGER))
    || (p.guaranteedDamage !== undefined && p.guaranteedDamage > p.damage)
    || (p.manaRestored !== undefined && p.manaRestored > 0 && (!p.skill || p.freeSkill || !r.inventory.includes('battery')))
    || (p.manaOverflow !== undefined && p.manaOverflow !== r.manaOverflow)
    || (p.clearRatio !== undefined && p.clearRatio !== clearRatio)
    || (p.oneCastClear !== undefined && (typeof p.oneCastClear !== 'boolean' || p.oneCastClear !== oneCastClear))
    || (p.freeSkill !== undefined && (typeof p.freeSkill !== 'boolean' || (p.freeSkill && (!p.skill || !r.inventory.includes('quint')))))
    || p.path.filter((event: any) => event.hop).length > 1
    || (p.path.some((event: any) => event.hop) && (!p.skill || r.character !== 'fuse' || r.skillRank !== 2))) fail();

  if (p.proc !== undefined) {
    const proc = p.proc;
    if (!record(proc) || proc.id !== 'trinity' || ![0.3, 0.45, 0.6].includes(proc.chance) || ![1.5, 2].includes(proc.multiplier) || typeof proc.triggered !== 'boolean'
      || !r.inventory.includes('trinity') || proc.chance !== [0.3, 0.45, 0.6][(r.acquisitionRank.trinity ?? 1) - 1] || proc.multiplier !== (r.tier.trinity === 2 ? 2 : 1.5)
      || !p.path.some((event: any) => event.value === 3)) fail('護符の記録が不正です。');
  }
  if (p.procs !== undefined) {
    const digits: Record<string, number> = { duality: 2, trinity: 3, quint: 5, sept: 7 };
    const values: Record<string, number[]> = { duality: [.25, .5], trinity: [1.5, 2], quint: [1, 2], sept: [7, 14] };
    if (!Array.isArray(p.procs) || new Set(p.procs.map((proc: any) => proc?.id)).size !== p.procs.length) fail('護符の記録が不正です。');
    for (const proc of p.procs) {
      if (!record(proc) || !primeIds.includes(proc.id) || !r.inventory.includes(proc.id) || typeof proc.triggered !== 'boolean'
        || proc.chance !== [0.3, 0.45, 0.6][(r.acquisitionRank[proc.id] ?? 1) - 1]
        || proc.value !== values[proc.id][r.tier[proc.id] === 2 ? 1 : 0]
        || !p.path.some((event: any) => event.value === digits[proc.id])
        || (proc.id === 'quint' && (p.freeSkill || r.freeSkillTokens !== (proc.triggered ? proc.value : 0)))
        || (proc.id === 'sept' && r.reservedAuto !== (proc.triggered ? proc.value : 0))) fail('護符の記録が不正です。');
    }
    const trinity = p.procs.find((proc: any) => proc.id === 'trinity');
    if (p.proc && (!trinity || trinity.chance !== p.proc.chance || trinity.triggered !== p.proc.triggered || trinity.value !== p.proc.multiplier)) fail('護符の記録が不正です。');
  }
  const trinity = p.procs?.find((proc: any) => proc.id === 'trinity');
  const duality = p.procs?.find((proc: any) => proc.id === 'duality');
  const reduction = Math.min(.6, (r.boons.defense > 0 ? .25 : 0) + (duality?.triggered ? duality.value : 0));
  if (p.received !== (p.defeated ? 0 : Math.ceil(Math.max(0, p.incoming - p.shield) * (1 - reduction)))) fail('反撃の記録が不正です。');
  const multiplier = trinity?.triggered ? trinity.value : p.proc?.triggered ? p.proc.multiplier : 1;
  if (p.baseDamage !== undefined && p.clearBonus !== undefined && p.guaranteedDamage !== undefined
    && (p.baseDamage + p.clearBonus !== p.guaranteedDamage || p.damage !== Math.floor(p.baseDamage * multiplier) + p.clearBonus)) fail('詠唱のダメージ記録が不正です。');

  if (p.chain !== undefined) {
    const t = p.chain;
    if (!record(t) || !integer(t.initialAuto) || !integer(t.remainingAuto) || !['limit', 'no-target', 'board-complete'].includes(t.stopReason)
      || !Array.isArray(t.bonuses) || !t.bonuses.every((b: any) => record(b) && typeof b.label === 'string' && integer(b.amount))
      || t.bonuses.reduce((sum: number, b: any) => sum + b.amount, 0) !== t.initialAuto || !Array.isArray(t.steps) || t.steps.length !== p.path.length) fail('連鎖の説明を読み込めません。');
    if (!t.steps.every((s: any, i: number) => {
      const event = p.path[i], transition = i > 0 && event.sheet !== p.path[i - 1].sheet;
      return record(s) && s.cell === event.cell && s.source === event.source && s.sheet === event.sheet
        && (s.sheetStart === undefined || typeof s.sheetStart === 'boolean') && !!s.sheetStart === transition
        && (s.hop === undefined || (typeof s.hop === 'boolean' && (!s.hop || s.source === 'chain'))) && !!s.hop === !!event.hop
        && s.from === (i && !transition ? p.path[i - 1].cell : null)
        && (!transition || (s.source === 'chain' && !s.hop)) && indexes(s.sharedUnits, 0, 26) && (!transition || !s.sharedUnits.length)
        && indexes(s.candidateValues, 1, 9) && s.candidateValues.includes(event.value)
        && indexes(s.eligibleCells, 0, 80) && s.eligibleCells.includes(s.cell)
        && indexes(s.tiedCells, 0, 80) && s.tiedCells.every((cell: number) => s.eligibleCells.includes(cell))
        && typeof s.initiallySingle === 'boolean' && integer(s.remainingBefore) && integer(s.remainingAfter) && integer(s.addedAuto)
        && s.remainingBefore === (i ? t.steps[i - 1].remainingAfter : t.initialAuto)
        && s.remainingAfter === s.remainingBefore - (s.source === 'chain' ? 1 : 0) + s.addedAuto;
    }) || t.remainingAuto !== t.steps[t.steps.length - 1].remainingAfter || (t.stopReason === 'board-complete') !== finalFull
      || (t.stopReason === 'limit' && t.remainingAuto !== 0) || (t.stopReason === 'no-target' && t.remainingAuto === 0)) fail('連鎖の説明が不正です。');
  }
}
export function loadSave(): { save: Save; warning: string } {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return { save: parseSave(raw), warning: '' };
    const save = newSave();
    save.settings.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return { save, warning: '' };
  } catch {
    return { save: newSave(), warning: '保存データを読み込めませんでした。新しく始めると保存データを作り直します。' };
  }
}
export function persist(save: Save): string {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); return ''; }
  catch { return 'このブラウザでは保存できません。ページを閉じると今回の進行が失われる可能性があります。'; }
}
