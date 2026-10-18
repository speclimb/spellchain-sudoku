import { connectedSingles, near, Random, singles } from './sudoku.ts';

export interface PuzzleSource { id: string; puzzle: string; solution: string }
export interface BoardLayout { cells: number[]; solution: number[] }
// A full-sheet route is essential: one leftover cell can prevent an otherwise
// hundred-input cast from carrying its remaining fuel into the next sheet.
export const MIN_BOARD_CHAIN = 36;
export const MAX_LAYOUT_RETRIES = 15;
const MAX_SOURCE_RETRIES = 256;

/** Keep the original transform's random draws, even when its layout is rejected. */
export function transformPuzzle(source: PuzzleSource, random: Random): BoardLayout {
  const rows = random.shuffle([0, 1, 2]).flatMap(b => random.shuffle([0, 1, 2]).map(r => b * 3 + r));
  const cols = random.shuffle([0, 1, 2]).flatMap(b => random.shuffle([0, 1, 2]).map(c => b * 3 + c));
  const digits = [0, ...random.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])];
  const transpose = random.next() < 0.5;
  const indexes = rows.flatMap(r => cols.map(c => transpose ? c * 9 + r : r * 9 + c));
  return {
    cells: indexes.map(i => digits[Number(source.puzzle[i])]),
    solution: indexes.map(i => digits[Number(source.solution[i])]),
  };
}

/** Unlimited-fuel normal casts, including the compulsory initial Echo inputs.
 * Skills can add roots or extend a dead end, so no skill is needed for screening.
 * stopAt lets screening stop as soon as one sufficiently long root is found. */
export function longestNaturalChain(layout: BoardLayout, echoes = 0, stopAt = 81): number {
  let longest = 0;
  for (const root of singles(layout.cells)) {
    const cells = [...layout.cells];
    cells[root] = layout.solution[root];
    let current = root, count = 1;
    for (let echo = 0; echo < echoes; echo++) {
      const target = cells.flatMap((value, i) => !value && layout.solution[i] === layout.solution[root] ? [i] : []).sort((a, b) => near(current, a, b))[0];
      if (target === undefined) break;
      cells[target] = layout.solution[target]; current = target; count++;
    }
    while (count < stopAt) {
      const target = connectedSingles(cells, current)[0];
      if (target === undefined) break;
      cells[target] = layout.solution[target]; current = target; count++;
    }
    longest = Math.max(longest, count);
    if (longest >= stopAt) break;
  }
  return longest;
}

/** Every fresh layout supports a full normal route through Echo's fused +2 bonus. */
export function isChainFriendly(layout: BoardLayout, minimumChain = MIN_BOARD_CHAIN): boolean {
  const echoes = minimumChain < MIN_BOARD_CHAIN ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5];
  return echoes.every(count => longestNaturalChain(layout, count, minimumChain) >= minimumChain);
}

const layoutCache = new Map<string, { layout: BoardLayout; randomState: number }>();
const sourceCache = new Map<string, BoardLayout>();
const cloneLayout = (layout: BoardLayout): BoardLayout => ({ cells: [...layout.cells], solution: [...layout.solution] });

/** Certify a geometry without replacing a source or changing its deck index.
 * Original 30-chain sources remain valid save references; only future layouts
 * change. The fixed private stream makes fallback independent of retry budget. */
function certifiedSource(source: PuzzleSource, minimumChain: number): BoardLayout {
  const key = `${source.puzzle}:${source.solution}:${minimumChain}`;
  const cached = sourceCache.get(key);
  if (cached) return cached;
  let layout = { cells: [...source.puzzle].map(Number), solution: [...source.solution].map(Number) };
  const random = new Random(0x6a09e667);
  for (let attempt = 0; attempt <= MAX_SOURCE_RETRIES; attempt++) {
    if (isChainFriendly(layout, minimumChain)) {
      if (sourceCache.size >= 256) sourceCache.delete(sourceCache.keys().next().value!);
      sourceCache.set(key, layout);
      return layout;
    }
    layout = transformPuzzle(source, random);
  }
  throw new Error(`問題 ${source.id} に全マス連鎖できる配置がありません。`);
}

/** Bounded deterministic retries never consume the board/deck/reward stream.
 * A certified source geometry plus a digit-only shuffle guarantees the floor
 * even when every random geometry is rejected. */
export function createBoardLayout(source: PuzzleSource, random: Random, maxRetries = MAX_LAYOUT_RETRIES, minimumChain = MIN_BOARD_CHAIN): BoardLayout {
  const key = `${source.puzzle}:${source.solution}:${random.state}:${maxRetries}:${minimumChain}`;
  const cached = layoutCache.get(key);
  if (cached) { random.state = cached.randomState; return cloneLayout(cached.layout); }
  let layout = transformPuzzle(source, random);
  if (!isChainFriendly(layout, minimumChain)) {
    const retries = new Random(random.state ^ 0xa54ff53a);
    let accepted = false;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const candidate = transformPuzzle(source, retries);
      if (isChainFriendly(candidate, minimumChain)) { layout = candidate; accepted = true; break; }
    }
    if (!accepted) {
      const certified = certifiedSource(source, minimumChain);
      const digits = [0, ...new Random(random.state ^ 0x510e527f).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])];
      layout = {
        cells: certified.cells.map(value => digits[value]),
        solution: certified.solution.map(value => digits[value]),
      };
    }
  }
  if (layoutCache.size >= 256) layoutCache.delete(layoutCache.keys().next().value!);
  layoutCache.set(key, { layout: cloneLayout(layout), randomState: random.state });
  return layout;
}
