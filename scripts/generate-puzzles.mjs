import { writeFileSync } from 'node:fs';
import { Random, solveSingles, countSolutions, singles } from '../src/game/sudoku.ts';
const random = new Random(20261013);
const bank = [];
while (bank.length < 30) {
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
  if (bank.some(p => p.puzzle === puzzle.join(''))) continue;
  bank.push({ id: `grimoire-${String(bank.length + 1).padStart(2, '0')}`, puzzle: puzzle.join(''), solution: solution.join('') });
}
writeFileSync(new URL('../src/game/puzzles.json', import.meta.url), JSON.stringify(bank, null, 2) + '\n');
console.log(`Generated and verified ${bank.length} unique, singles-solvable puzzles.`);
