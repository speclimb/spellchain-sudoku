import { CHARACTERS, RELICS } from './content';
import { UNITS } from './sudoku';
import { newSave } from './engine';
import type { Save } from './types';
export const SAVE_KEY = 'chain-incantation.save.v1';
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const vector = (v: unknown, length: number, check: (v: any) => boolean) => Array.isArray(v) && v.length === length && v.every(check);
export function parseSave(raw: string): Save {
  const data: unknown = JSON.parse(raw);
  if (!record(data) || data.version !== 1 || !record(data.meta) || !record(data.settings)) throw new Error('保存形式を読み込めません。');
  if (!['clears', 'runs', 'wins', 'bestScore'].every(k => integer(data.meta[k])) || typeof data.meta.tutorialDone !== 'boolean' || !['sound', 'fast', 'reducedMotion'].every(k => typeof data.settings[k] === 'boolean')) throw new Error('記録が破損しています。');
  const r = data.run;
  if (r !== null) {
    const relics = new Set(RELICS.map(x => x.id));
    const relicList = (v: unknown) => Array.isArray(v) && new Set(v).size === v.length && v.every(id => relics.has(id));
    if (!record(r) || !CHARACTERS.some(c => c.id === r.character) || !['battle', 'reward', 'won', 'lost'].includes(r.phase) || typeof r.id !== 'string' || typeof r.afterglow !== 'boolean') throw new Error('冒険の記録を読み込めません。');
    if (!integer(r.seed, 0, 0xffffffff) || !integer(r.randomState, 0, 0xffffffff) || !integer(r.revision) || !integer(r.stage, 0, 5) || !integer(r.turn) || !integer(r.maxHp, 1, 40) || !integer(r.hp, 0, r.maxHp) || !integer(r.mana, 0, 8) || !integer(r.enemyHp, 0, 800) || !integer(r.score)) throw new Error('冒険の数値が不正です。');
    if (!vector(r.solution, 81, v => integer(v, 1, 9)) || !UNITS.every(u => new Set(u.map(i => r.solution[i])).size === 9) || !vector(r.cells, 81, v => integer(v, 0, 9)) || !r.cells.every((v: number, i: number) => v === 0 || v === r.solution[i]) || !vector(r.givens, 81, v => typeof v === 'boolean') || r.givens.filter(Boolean).length !== 45 || !r.givens.every((v: boolean, i: number) => !v || r.cells[i] !== 0)) throw new Error('盤面の記録が不正です。');
    if (!vector(r.marks, 81, v => v === null || v === 'weak' || v === 'shield') || ['weak', 'shield'].some(kind => r.marks.filter((v: string) => v === kind).length !== 3) || !vector(r.puzzleOrder, 6, v => integer(v, 0, 29)) || new Set(r.puzzleOrder).size !== 6) throw new Error('問題の記録が不正です。');
    if (!relicList(r.inventory) || !relicList(r.pool) || !relicList(r.rewards) || !r.inventory.every((id: string) => r.pool.includes(id)) || !r.rewards.every((id: string) => r.pool.includes(id) && !r.inventory.includes(id)) || (r.phase === 'reward' && r.rewards.length !== 3)) throw new Error('遺物の記録が不正です。');
    if (!record(r.stats) || !['moves', 'filled', 'bestChain', 'kills', 'skills'].every(k => integer(r.stats[k])) || r.stats.kills > 6 || r.stats.kills !== r.stage + (r.phase === 'reward' || r.phase === 'won' ? 1 : 0)) throw new Error('戦績の記録が不正です。');
    if ((r.phase === 'battle' && (!r.hp || !r.enemyHp || !r.cells.includes(0))) || (r.phase === 'lost' && r.hp !== 0) || (r.phase === 'won' && r.stage !== 5) || ((r.phase === 'won' || r.phase === 'reward') && (r.enemyHp !== 0 || r.cells.includes(0)))) throw new Error('冒険の進行が不正です。');
    if (r.lastReport !== null) {
      const p = r.lastReport;
      if (!record(p) || !Array.isArray(p.path) || !p.path.length || !p.path.every((e: any) => record(e) && integer(e.cell, 0, 80) && integer(e.value, 1, 9) && integer(e.ordinal, 1, 81) && ['root', 'echo', 'chain'].includes(e.source) && [null, 'weak', 'shield'].includes(e.mark) && Array.isArray(e.units) && e.units.every((v: unknown) => integer(v, 0, 26))) || new Set(p.path.map((e: any) => e.cell)).size !== p.path.length || !['damage', 'attackScore', 'shield', 'incoming', 'received', 'healed', 'charge', 'units', 'weak', 'hpBefore', 'enemyBefore'].every(k => integer(p[k])) || !['skill', 'defeated', 'fullClear'].every(k => typeof p[k] === 'boolean') || !Array.isArray(p.sweep) || !p.sweep.every((v: unknown) => integer(v, 0, 80))) throw new Error('詠唱の記録が不正です。');
      // Trace is optional so pre-explanation version-1 saves remain usable.
      if (p.chain !== undefined) {
        const t = p.chain;
        const indexes = (v: unknown, min: number, max: number): v is number[] => Array.isArray(v) && new Set(v).size === v.length && v.every(n => integer(n, min, max));
        if (!record(t) || !integer(t.initialAuto) || !integer(t.remainingAuto) || !['limit', 'no-target', 'board-complete'].includes(t.stopReason) || !Array.isArray(t.bonuses) || !t.bonuses.every((b: any) => record(b) && typeof b.label === 'string' && integer(b.amount)) || t.bonuses.reduce((sum: number, b: any) => sum + b.amount, 0) !== t.initialAuto || !Array.isArray(t.steps) || t.steps.length !== p.path.length) throw new Error('連鎖の説明を読み込めません。');
        if (!t.steps.every((s: any, i: number) => record(s) && s.cell === p.path[i].cell && s.source === p.path[i].source && s.from === (i ? p.path[i - 1].cell : null) && indexes(s.sharedUnits, 0, 26) && indexes(s.candidateValues, 1, 9) && s.candidateValues.includes(p.path[i].value) && indexes(s.eligibleCells, 0, 80) && s.eligibleCells.includes(s.cell) && indexes(s.tiedCells, 0, 80) && s.tiedCells.every((cell: number) => s.eligibleCells.includes(cell)) && typeof s.initiallySingle === 'boolean' && integer(s.remainingBefore) && integer(s.remainingAfter) && integer(s.addedAuto) && s.remainingBefore === (i ? t.steps[i - 1].remainingAfter : t.initialAuto) && s.remainingAfter === s.remainingBefore - (s.source === 'chain' ? 1 : 0) + s.addedAuto) || t.remainingAuto !== t.steps[t.steps.length - 1].remainingAfter || (t.stopReason === 'board-complete') !== p.fullClear || (t.stopReason === 'limit' && t.remainingAuto !== 0) || (t.stopReason === 'no-target' && t.remainingAuto === 0)) throw new Error('連鎖の説明が不正です。');
      }
    }
  }
  return data as unknown as Save;
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
