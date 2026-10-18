import { readFileSync, writeFileSync } from 'node:fs';
import { Random, solveSingles, countSolutions, singles } from '../src/game/sudoku.ts';
import { MIN_BOARD_CHAIN, isChainFriendly, createBoardLayout } from '../src/game/board-generation.ts';

const BANK_SIZE = 100;
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
  const cells = [...source.puzzle].map(Number);
  if (cells.filter(value => !value).length !== 36 || countSolutions(cells) !== 1 || solveSingles(cells)?.join('') !== source.solution) return false;
  // Certify even the no-retry fallback. Old source geometry need not already
  // support 36 inputs: the runtime certifies a legal Sudoku transformation.
  if (!isChainFriendly(createBoardLayout(source, new Random(0), 0))) return false;
  for (let sample = 0; sample < STRESS_SAMPLES; sample++) {
    // Private stress seeds preserve the original candidate generation stream.
    const seed = (0x85ebca6b ^ Math.imul(sample + 1, 2654435761)) >>> 0;
    if (!isChainFriendly(createBoardLayout(source, new Random(seed)))) return false;
  }
  return true;
}

// Saved decks reference indices. Never rebuild or replace an existing source
// when strengthening runtime screening; validate and append only.
const bankUrl = new URL('../src/game/puzzles.json', import.meta.url);
const existingText = readFileSync(bankUrl, 'utf8');
const bank = JSON.parse(existingText);
const preserved = bank.length;
if (preserved > BANK_SIZE || new Set(bank.map(source => source.id)).size !== preserved || new Set(bank.map(source => source.puzzle)).size !== preserved) throw new Error('Invalid existing source bank; puzzles.json was not changed.');
for (const source of bank) {
  if (!isRobustSource(source)) throw new Error(`Source ${source.id} failed certification; puzzles.json was not changed.`);
  seen.add(source.puzzle);
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
if (bank.length !== preserved) writeFileSync(bankUrl, JSON.stringify(bank, null, 2) + '\n');
console.log(`Verified ${bank.length} unique, singles-solvable puzzles with ${MIN_BOARD_CHAIN} natural inputs across ${STRESS_SAMPLES} screened layouts and echo counts 0–5, including forced fallback.`);
console.log(`Preserved all ${preserved} existing source indices, IDs and puzzles. Candidate attempts: ${attempts}.`);
console.log(`Added ${bank.length - preserved} sources. Minimum blank-mask Hamming distance: ${minimumMaskDistance} (required for new sources: ${MIN_MASK_DISTANCE}).`);
