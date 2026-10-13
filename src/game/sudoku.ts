export const row = (i: number) => Math.floor(i / 9);
export const col = (i: number) => i % 9;
export const box = (i: number) => Math.floor(row(i) / 3) * 3 + Math.floor(col(i) / 3);
export const UNITS = [
  ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, b) => Array.from({ length: 81 }, (_, i) => i).filter(i => box(i) === b)),
];
export const PEERS = Array.from({ length: 81 }, (_, i) => Array.from(new Set(UNITS.filter(u => u.includes(i)).flat())).filter(j => j !== i));
export function candidates(cells: number[], i: number): number[] {
  if (cells[i]) return [];
  const used = new Set(PEERS[i].map(j => cells[j]));
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => !used.has(n));
}
export function singles(cells: number[]): number[] {
  return cells.flatMap((n, i) => !n && candidates(cells, i).length === 1 ? [i] : []);
}
export function solveSingles(source: number[]): number[] | null {
  const cells = [...source];
  while (cells.includes(0)) {
    const next = singles(cells)[0];
    if (next === undefined) return null;
    cells[next] = candidates(cells, next)[0];
  }
  return UNITS.every(u => new Set(u.map(i => cells[i])).size === 9) ? cells : null;
}
export function countSolutions(source: number[], limit = 2): number {
  const cells = [...source];
  function search(): number {
    let target = -1, options: number[] = [];
    for (let i = 0; i < 81; i++) {
      if (cells[i]) continue;
      const values = candidates(cells, i);
      if (!values.length) return 0;
      if (target === -1 || values.length < options.length) { target = i; options = values; }
      if (options.length === 1) break;
    }
    if (target === -1) return UNITS.every(u => new Set(u.map(i => cells[i])).size === 9) ? 1 : 0;
    let count = 0;
    for (const value of options) {
      cells[target] = value;
      count += search();
      if (count >= limit) break;
    }
    cells[target] = 0;
    return Math.min(limit, count);
  }
  return search();
}
export function near(origin: number, a: number, b: number): number {
  return (Math.abs(row(origin) - row(a)) + Math.abs(col(origin) - col(a))) -
    (Math.abs(row(origin) - row(b)) + Math.abs(col(origin) - col(b))) || a - b;
}
export class Random {
  state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state / 4294967296; }
  shuffle<T>(source: readonly T[]): T[] {
    const result = [...source];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
