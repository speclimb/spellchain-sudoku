import { writeFileSync } from 'node:fs';
import { Random, solveSingles, countSolutions, singles } from '../src/game/sudoku.ts';
import { MIN_BOARD_CHAIN, isChainFriendly, transformPuzzle } from '../src/game/board-generation.ts';

const BANK_SIZE = 100;
const LEGACY_BANK_SIZE = 30;
const STRESS_SAMPLES = 100;
const MIN_MASK_DISTANCE = 18;
const MAX_GENERATION_ATTEMPTS = 20_000;
const random = new Random(20261013);
const seen = new Set();
let attempts = 0;

function nextPuzzle(id) {
  while (attempts < MAX_GENERATION_ATTEMPTS) {
    attempts++;
    const rr = random.shuffle([0, 1, 2]).flatMap(b => random.shuffle([0, 1, 2]).map(r => b * 3 + r));
    const cc = random.shuffle([0, 1, 2]).flatMap(b => random.shuffle([0, 1, 2]).map(c => b * 3 + c));
    const digits = random.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const solution = rr.flatMap(r => cc.map(c => digits[(r * 3 + Math.floor(r / 3) + c) % 9]));
    const puzzle = [...solution];
    let removed = 0;
    for (const i of random.shuffle(Array.from({ length: 81 }, (_, i) => i))) {
      const old = puzzle[i]; puzzle[i] = 0;
      if (solveSingles(puzzle)) removed++; else puzzle[i] = old;
      if (removed === 36) break;
    }
    if (removed !== 36 || singles(puzzle).length < 5 || countSolutions(puzzle) !== 1) continue;
    const text = puzzle.join('');
    if (seen.has(text)) continue;
    seen.add(text);
    return { id, puzzle: text, solution: solution.join('') };
  }
  throw new Error(`Could not generate a chain-friendly bank within ${MAX_GENERATION_ATTEMPTS} attempts; puzzles.json was not changed.`);
}

function isRobustSource(source) {
  if (!isChainFriendly({ cells: [...source.puzzle].map(Number), solution: [...source.solution].map(Number) })) return false;
  for (let sample = 0; sample < STRESS_SAMPLES; sample++) {
    // Private stress seeds preserve the original candidate generation stream.
    const seed = (0x85ebca6b ^ Math.imul(sample + 1, 2654435761)) >>> 0;
    if (!isChainFriendly(transformPuzzle(source, new Random(seed)))) return false;
  }
  return true;
}

// Rebuild the original sequence first, keeping every surviving source and ID.
const bank = Array.from({ length: LEGACY_BANK_SIZE }, (_, index) => nextPuzzle(`grimoire-${String(index + 1).padStart(2, '0')}`));
const replaced = [];
for (let index = 0; index < bank.length; index++) {
  if (isRobustSource(bank[index])) continue;
  const id = bank[index].id;
  let replacement;
  do replacement = nextPuzzle(id); while (!isRobustSource(replacement));
  bank[index] = replacement;
  replaced.push(id);
}

const blankMask = source => [...source.puzzle].map(value => value === '0');
const maskDistance = (left, right) => left.reduce((distance, blank, cell) => distance + Number(blank !== right[cell]), 0);
const masks = bank.map(blankMask);
while (bank.length < BANK_SIZE) {
  const candidate = nextPuzzle(`grimoire-${String(bank.length + 1).padStart(2, '0')}`);
  const mask = blankMask(candidate);
  if (masks.some(previous => maskDistance(previous, mask) < MIN_MASK_DISTANCE) || !isRobustSource(candidate)) continue;
  bank.push(candidate);
  masks.push(mask);
}
let minimumMaskDistance = 81;
for (let left = 0; left < masks.length; left++) {
  for (let right = left + 1; right < masks.length; right++) {
    minimumMaskDistance = Math.min(minimumMaskDistance, maskDistance(masks[left], masks[right]));
  }
}

// All validation completes before the source bank is written.
writeFileSync(new URL('../src/game/puzzles.json', import.meta.url), JSON.stringify(bank, null, 2) + '\n');
console.log(`Generated and verified ${bank.length} unique, singles-solvable puzzles with at least ${MIN_BOARD_CHAIN} natural inputs across ${STRESS_SAMPLES} sampled transforms and echo counts 0–3.`);
console.log(`Replaced ${replaced.length} chain-fragile sources: ${replaced.join(', ') || 'none'}. Candidate attempts: ${attempts}.`);
console.log(`Added ${bank.length - LEGACY_BANK_SIZE} sources after the preserved curated first ${LEGACY_BANK_SIZE}. Minimum blank-mask Hamming distance: ${minimumMaskDistance} (required for new sources: ${MIN_MASK_DISTANCE}).`);
