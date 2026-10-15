import { describe, expect, it, vi } from 'vitest';
import { CHARACTERS, greaterIds, primeIds, RELICS } from '../src/game/content';
import { canTakeReward, canUseSkill, chainCapacity, legalOrigins, longestOrigins, newSave, previewAction, primeRoll, resolveAction, sheetShield, spellMultiplier, startRun } from '../src/game/engine';
import { rollRewards } from '../src/game/rewards';
import { candidates, near, PEERS, Random } from '../src/game/sudoku';
import type { CharacterId, PrimeRelicId, Report, RewardId, Run, SheetSegment } from '../src/game/types';

const primes: PrimeRelicId[] = ['duality', 'trinity', 'quint', 'sept'];
const digit = { duality: 2, trinity: 3, quint: 5, sept: 7 };
function fixture(seed = 71, character: CharacterId = 'fuse'): Run {
  const save = newSave(); save.meta.clears = 99;
  return startRun(save, character, seed).run!;
}

/** Reconstruct the pre-expansion rules explicitly for compatibility assertions. */
function legacyRun(run: Run): Run {
  delete run.relicBalanceVersion; delete run.stowedRelics;
  delete run.expansionVersion; delete run.enemyRulesVersion; delete run.skillLevels;
  delete run.equippedSkills; delete run.relicLevels; delete run.rewardStep;
  delete run.pendingRelicRewards; delete run.contributions;
  return run;
}
const legacyFixture = (seed = 71): Run => legacyRun(fixture(seed));
const play = (run: Run, cell = legalOrigins(run)[0], skill = false) => ({ type: 'play' as const, cell, skill, revision: run.revision });
const choose = (run: Run, relic: RewardId) => resolveAction(run, { type: 'reward', relic, revision: run.revision });
function boardWith(blanks: number[], character: CharacterId = 'fuse'): Run {
  const run = fixture(71, character); run.cells = [...run.solution];
  blanks.forEach(cell => { run.cells[cell] = 0; }); run.givens = run.cells.map(Boolean);
  run.marks.fill(null); run.enemyHp = 1_000_000_000; run.mana = 8;
  return run;
}
function digitAt(run: Run, cell: number, target: number): void {
  const old = run.solution[cell], swap = (v: number) => v === old ? target : v === target ? old : v;
  run.solution = run.solution.map(swap); run.cells = run.cells.map(v => v ? swap(v) : 0);
}
function effectBoard(id: PrimeRelicId, rank = 1, upper = false): Run {
  const run = boardWith([0, 1, 2, 3, 4, 40]); digitAt(run, 0, digit[id]);
  run.inventory = [id]; run.acquisitionRank[id] = rank;
  if (upper) run.tier[id] = 2;
  return run;
}
function seedFor(id: PrimeRelicId, triggered: boolean, chance = .3, counter = 0): number {
  for (let seed = 0; seed < 10000; seed++) if ((primeRoll(seed, counter, id) < chance) === triggered) return seed;
  throw new Error('No test seed');
}
function crossSheet(seed = 1, level = 85): Run {
  const run = fixture(seed); run.inventory = ['wick', 'rekindle', 'echo', 'ward', 'stroke', 'lens', 'pen'];
  run.tier = { wick: 2, lens: 2, stroke: 2 }; run.spellLevel = level; run.skillRank = 2;
  run.enemyHp = 1_000_000_000; run.mana = 8; run.hp = 100; run.maxHp = 400;
  return run;
}
function longestCast(run: Run, skill = true): { cell: number; report: ReturnType<typeof previewAction> } {
  const cell = longestOrigins(run, skill).cells[0];
  return { cell, report: previewAction(run, cell, skill) };
}
function segmentShield(source: Run, part: SheetSegment, report: Report): number {
  const run = structuredClone(source); run.phase = 'battle'; run.lastReport = null;
  run.cells = [...part.cells]; run.givens = part.givens; run.marks = part.marks;
  report.path.slice(part.pathStart, part.pathEnd).forEach(event => { run.cells[event.cell] = event.value; });
  return sheetShield(run);
}

describe('independent digit-gated prime effects', () => {
  it.each(primes)('%s has three exact acquisition chances independent of its upper tier', id => {
    for (const upper of [false, true]) for (const [index, chance] of [.3, .45, .6].entries()) {
      const run = effectBoard(id, index + 1, upper), preview = previewAction(run, 0);
      expect(preview.forecast!.procs).toHaveLength(1);
      expect(preview.forecast!.procs![0]).toMatchObject({ id, chance });
      expect(resolveAction(run, play(run, 0)).lastReport!.procs).toHaveLength(1);
      const missing = boardWith([0, 40]); digitAt(missing, 0, 1); digitAt(missing, 40, digit[id]); missing.inventory = [id];
      expect(previewAction(missing, 0).path).toHaveLength(1);
      expect(previewAction(missing, 0).forecast).toBeUndefined();
      expect(resolveAction(missing, play(missing, 0)).lastReport!.procs).toBeUndefined();
    }
  });
  it('uses isolated, stable effect streams with statistically plausible rank frequencies', () => {
    const n = 12000;
    for (const id of primes) {
      const counts = [.3, .45, .6].map(chance => {
        let hits = 0;
        for (let seed = 0; seed < n; seed++) {
          const roll = primeRoll(seed, 23, id);
          expect(roll).toBeGreaterThanOrEqual(0); expect(roll).toBeLessThan(1);
          if (roll < chance) hits++;
        }
        expect(hits / n).toBeCloseTo(chance, 1); // Tighten explicitly below to ±1.5 percentage points.
        expect(Math.abs(hits / n - chance)).toBeLessThan(.015);
        return hits;
      });
      expect(counts[0]).toBeLessThan(counts[1]); expect(counts[1]).toBeLessThan(counts[2]);
    }
    let same = 0;
    for (let seed = 0; seed < n; seed++) if (primeRoll(seed, 2, 'duality') < .3 && primeRoll(seed, 2, 'trinity') < .3) same++;
    expect(Math.abs(same / n - .09)).toBeLessThan(.015);
    expect(new Set(primes.map(id => primeRoll(71, 3, id))).size).toBe(4);
    expect(primeRoll(71, 3, 'quint')).not.toBe(primeRoll(71, 4, 'quint'));
  });
  it('rolls each effect once across multiple matching digits and sheet boundaries', () => {
    const run = crossSheet(); run.inventory.push(...primes);
    const { cell, report: preview } = longestCast(run);
    expect(preview.path.length).toBeGreaterThan(72);
    const result = resolveAction(run, play(run, cell, true)), report = result.lastReport!;
    expect(report.procs!.map(p => p.id)).toEqual(primes);
    for (const id of primes) {
      expect(report.path.filter(event => event.value === digit[id]).length).toBeGreaterThan(1);
      expect(report.procs!.find(p => p.id === id)!.triggered).toBe(primeRoll(run.seed, run.castCounter, id) < .3);
    }
    expect(report.path).toEqual(preview.path); expect(result.castCounter).toBe(1);
    const altered = structuredClone(run); altered.randomState ^= 123456;
    const other = resolveAction(altered, play(altered, cell, true)).lastReport!;
    for (const proc of other.procs!) expect(proc.triggered).toBe(primeRoll(run.seed, 0, proc.id) < proc.chance);
  });
  it('applies Duality after shields, ceilings remaining damage, and caps total reduction at 60%', () => {
    for (const upper of [false, true]) for (const boon of [false, true]) {
      const run = effectBoard('duality', 1, upper); run.seed = seedFor('duality', true); run.stage = 44;
      run.boons.defense = boon ? 5 : 0; run.marks[0] = 'shield';
      const report = resolveAction(run, play(run, 0)).lastReport!;
      const reduction = Math.min(.6, (upper ? .5 : .25) + (boon ? .25 : 0));
      expect(report.procs![0].triggered).toBe(true);
      expect(report.received).toBe(Math.ceil(Math.max(0, report.incoming - report.shield) * (1 - reduction)));
      expect(report.received).toBeGreaterThan(0);
    }
  });
  it('applies Trinity only to base damage and leaves each sheet clear bonus additive', () => {
    const run = crossSheet(); run.inventory.push('trinity'); run.tier.trinity = 2;
    run.seed = seedFor('trinity', true); const { cell } = longestCast(run);
    const report = resolveAction(run, play(run, cell, true)).lastReport!;
    expect(report.segments!.filter(part => part.fullClear).length).toBeGreaterThan(1);
    expect(report.damage).toBe(Math.floor(report.baseDamage! * 2) + report.clearBonus!);
    expect(report.clearBonus).toBe(report.segments!.reduce((sum, part) => sum + part.clearBonus, 0));
  });
});

describe('free skill tokens and reserved automatic entries', () => {
  it.each([false, true])('Quint awards its tier cap (upper=%s), and tokens pay before full mana or overflow', upper => {
    const run = effectBoard('quint', 1, upper); run.seed = seedFor('quint', true); run.inventory.push('battery');
    run.mana = 8; run.manaOverflow = 2;
    let next = resolveAction(run, play(run, 0));
    expect(next.freeSkillTokens).toBe(upper ? 2 : 1); expect(canUseSkill(next)).toBe(true);
    const tokens = next.freeSkillTokens;
    for (let i = 0; i < tokens; i++) {
      // Keep one disconnected digit-5 root available so a free skill would otherwise qualify again.
      next.cells = [...next.solution]; next.cells[0] = 0; next.cells[40] = 0; next.enemyHp = 1_000_000_000;
      digitAt(next, 0, 5);
      next = resolveAction(next, play(next, 0, true));
      expect(next).toMatchObject({ freeSkillTokens: tokens - i - 1, mana: 8, manaOverflow: 2 });
      expect(next.lastReport).toMatchObject({ freeSkill: true, manaRestored: 0, charge: 0 });
      expect(next.lastReport!.procs?.some(p => p.id === 'quint') ?? false).toBe(false);
    }
    next.cells = [...next.solution]; next.cells[0] = 0; next.cells[40] = 0;
    next.inventory = ['battery']; next = resolveAction(next, play(next, 0, true));
    expect(next).toMatchObject({ mana: 2, manaOverflow: 0, freeSkillTokens: 0 });
    expect(next.lastReport).toMatchObject({ freeSkill: false, manaRestored: 2 });
  });
  it('permits token-only skills and suppresses Quint while holding a token even on a normal cast', () => {
    const run = effectBoard('quint'); run.freeSkillTokens = 1; run.mana = 0;
    expect(canUseSkill(run)).toBe(true); expect(legalOrigins(run, true)).toHaveLength(6);
    expect(previewAction(run, 0).forecast).toBeUndefined();
    expect(resolveAction(run, play(run, 0)).freeSkillTokens).toBe(1);
    const skill = resolveAction(run, play(run, 0, true));
    expect(skill.freeSkillTokens).toBe(0); expect(skill.mana).toBe(0); expect(skill.lastReport!.procs).toBeUndefined();
    run.freeSkillTokens = 0; expect(canUseSkill(run)).toBe(false); expect(legalOrigins(run, true)).toEqual([]);
    expect(() => resolveAction(run, play(run, 0, true))).toThrow();
  });
  it.each([false, true])('Sept grants exactly one next-cast reservation (upper=%s), including when it procs again', upper => {
    const run = effectBoard('sept', 1, upper); run.seed = seedFor('sept', true);
    const next = resolveAction(run, play(run, 0)); expect(next.reservedAuto).toBe(upper ? 14 : 7);
    const carry = next.reservedAuto, base = chainCapacity({ ...next, reservedAuto: 0 });
    expect(chainCapacity(next)).toBe(base + carry);
    next.cells = [...next.solution]; next.cells[0] = 0; next.cells[40] = 0; digitAt(next, 0, 7);
    next.seed = seedFor('sept', true, .3, next.castCounter);
    const retriggered = resolveAction(next, play(next, 0));
    expect(retriggered.lastReport!.chain!.initialAuto).toBe(base + carry);
    expect(retriggered.reservedAuto).toBe(carry);
    next.inventory = []; const consumed = resolveAction(next, play(next, 0));
    expect(consumed.reservedAuto).toBe(0); expect(consumed.lastReport!.chain!.initialAuto).toBe(base + carry);
  });
});

describe('unbounded upper Wick casts and segmented accounting', () => {
  it('does not continue with zero fuel, while one remaining auto pays for exactly the next sheet entry', () => {
    const run = boardWith([0, 1, 2, 3, 4, 5]); run.inventory = ['wick']; run.tier.wick = 2;
    expect(chainCapacity(run)).toBe(5);
    const exact = resolveAction(run, play(run, 0));
    expect(exact.lastReport!.path).toHaveLength(6); expect(exact.lastReport!.segments).toHaveLength(1);
    expect(exact.lastReport!.chain).toMatchObject({ remainingAuto: 0, stopReason: 'board-complete' });
    expect(exact.sheet).toBe(2); expect(exact.cells.filter(v => !v)).toHaveLength(36);
    run.cells[5] = run.solution[5]; run.givens[5] = true;
    const carried = resolveAction(run, play(run, 0)), report = carried.lastReport!;
    expect(report.path).toHaveLength(6); expect(report.segments).toHaveLength(2);
    expect(report.path[5]).toMatchObject({ source: 'chain', sheetStart: true, ordinal: 6, sheet: 2 });
    expect(report.chain!.steps[5]).toMatchObject({ from: null, remainingBefore: 1, remainingAfter: 0, sheetStart: true });
    expect(carried.cells.filter(v => !v)).toHaveLength(35); expect(carried.sheet).toBe(2);
  });
  it('chooses the longest deterministic within-sheet path and upper-left among equal fresh entries', () => {
    const run = boardWith([0]); run.inventory = ['wick']; run.tier.wick = 2;
    const report = previewAction(run, 0), segment = report.segments![1], transition = report.chain!.steps[1];
    const fuel = transition.remainingBefore;
    function independentLength(root: number): number {
      const cells = [...segment.cells]; let current = root, count = 1; cells[root] = segment.solution[root];
      while (count < fuel) {
        const next = PEERS[current].filter(cell => !cells[cell] && candidates(cells, cell).length === 1).sort((a, b) => near(current, a, b))[0];
        if (next === undefined) break;
        cells[next] = segment.solution[next]; current = next; count++;
      }
      return count;
    }
    const lengths = transition.eligibleCells.map(cell => ({ cell, length: independentLength(cell) }));
    const maximum = Math.max(...lengths.map(p => p.length));
    expect(transition.cell).toBe(lengths.filter(p => p.length === maximum).map(p => p.cell).sort((a, b) => a - b)[0]);
    expect(segment.pathEnd - segment.pathStart).toBe(maximum);
  });
  it('crosses 36 and 72 fills without resetting ordinals, once-per-cast effects, growth, or multipliers', () => {
    const run = crossSheet(), { cell, report } = longestCast(run);
    expect(report.path.length).toBeGreaterThan(72); expect(report.segments!.length).toBeGreaterThanOrEqual(3);
    expect(report.path.map(event => event.ordinal)).toEqual(report.path.map((_, index) => index + 1));
    expect(new Set(report.path.map(event => `${event.sheet}:${event.cell}`)).size).toBe(report.path.length);
    expect(report.path.filter(event => event.source === 'echo')).toHaveLength(1);
    expect(report.chain!.steps.filter(step => step.addedAuto > 0)).toHaveLength(1);
    expect(report.chain!.steps.filter(step => step.hop).length).toBeLessThanOrEqual(1);
    const next = resolveAction(run, play(run, cell, true));
    expect(next.lastReport).toEqual(report); expect(next.turn).toBe(run.turn + 1); expect(next.castCounter).toBe(1);
    expect(next.stats.moves).toBe(1); expect(next.stats.filled).toBe(report.path.length);
    expect(next.stats.bestChain).toBe(report.path.length); expect(next.stats.skills).toBe(1);
    expect(next.stats.sheets).toBe(report.sheetsCompleted); expect(next.spellLevel).toBe(run.spellLevel + report.sheetsCompleted!);
    expect(report.chain!.initialAuto).toBe(chainCapacity(run, true));
    expect(report.chain!.remainingAuto).toBe(chainCapacity(run, true) + 2 - report.path.filter(event => event.source === 'chain').length);
    expect(report.spellLevelBefore).toBe(run.spellLevel);
    let raw = 0;
    for (const part of report.segments!) {
      const segmentPath = report.path.slice(part.pathStart, part.pathEnd);
      raw = segmentPath.reduce((sum, event) => sum + (Math.min(80, 10 + (event.ordinal - 1) * 2) + event.units.length * 40 + (event.mark === 'weak' ? 20 + (event.source === 'root' ? 12 : 0) : 0)) * (event.ordinal <= 5 ? 2 : 1), 0);
      expect(part.baseDamage).toBe(Math.floor(raw * spellMultiplier(run.spellLevel)));
      expect(part.clearBonus).toBe(part.fullClear ? Math.floor(part.baseDamage * segmentPath.length / (4 * part.givens.filter(v => !v).length)) : 0);
    }
    expect(report.baseDamage).toBe(report.segments!.reduce((sum, part) => sum + part.baseDamage, 0));
    expect(report.clearBonus).toBe(report.segments!.reduce((sum, part) => sum + part.clearBonus, 0));
    expect(report.shield).toBe(Math.max(sheetShield(run), ...report.segments!.map(part => segmentShield(run, part, report))));
    expect(report.shield).toBeLessThan(report.segments!.reduce((sum, part) => sum + segmentShield(run, part, report), 0));
  });
  it('does not stop at an arbitrary chain cap beyond three full sheets', () => {
    const run = crossSheet(1, 180), { report } = longestCast(run);
    expect(report.path.length).toBeGreaterThan(108);
    expect(report.path.at(-1)!.ordinal).toBe(report.path.length);
    expect(report.path.length).toBeLessThanOrEqual(chainCapacity(run, true) + 5);
  });
  it('settles exactly one current enemy, one reward, one attack score and overkill across many sheets', () => {
    const run = crossSheet(); run.inventory.push('gold'); run.stage = 9; run.stats.kills = 9; run.enemyHp = 1;
    const { cell } = longestCast(run), next = resolveAction(run, play(run, cell, true)), report = next.lastReport!;
    expect(report.path.length).toBeGreaterThan(72); expect(report.received).toBe(0); expect(report.defeated).toBe(true);
    expect(next.stage).toBe(9); expect(next.phase).toBe('reward'); expect(next.stats.kills).toBe(10);
    expect(next.rewards).toHaveLength(3); expect(new Set(next.rewards).size).toBe(3);
    expect(next.score).toBe(Math.floor(report.damage * 1.5) + 500);
    expect(next.stats.filled).toBe(report.path.length); expect(next.stats.moves).toBe(1);
    expect(report.levelsGained).toBe(report.sheetsCompleted! + 1);
    expect(() => resolveAction(next, play(run, cell, true))).toThrow('すでに処理');
  });
  it('does not heal or grow after a lethal counterattack, even after completing multiple sheets', () => {
    const run = crossSheet(); run.stage = 99; run.stats.kills = 99; run.hp = 1;
    const { cell } = longestCast(run), next = resolveAction(run, play(run, cell, true)), report = next.lastReport!;
    expect(report.sheetsCompleted).toBeGreaterThanOrEqual(2); expect(report.received).toBeGreaterThan(1);
    expect(next).toMatchObject({ phase: 'lost', hp: 0, spellLevel: run.spellLevel, maxHp: run.maxHp, stage: run.stage });
    expect(report).toMatchObject({ healed: 0, levelsGained: 0, sheetAdvanced: false });
    expect(next.rewards).toEqual([]); expect(next.stats.kills).toBe(run.stats.kills);
  });
});

describe('honest forecasts and cached longest-origin lens', () => {
  it('clones board RNG without changing source state, draws no effect rolls, and is order-independent', () => {
    const run = crossSheet(); run.inventory.push(...primes); const before = structuredClone(run);
    const { cell } = longestCast(run); const first = previewAction(run, cell, true);
    expect(first.segments!.length).toBeGreaterThan(1); expect(first.procs).toBeUndefined();
    const random = vi.spyOn(Random.prototype, 'next');
    try {
      for (const root of legalOrigins(run).slice().reverse()) previewAction(run, root);
      expect(previewAction(run, cell, true)).toEqual(first);
      expect(random).toHaveBeenCalled(); // Fresh sheets require private board RNG; the source stream is unchanged.
    } finally { random.mockRestore(); }
    expect(run).toEqual(before);
    const actual = resolveAction(run, play(run, cell, true)).lastReport!;
    expect(actual.path).toEqual(first.path); expect(actual.segments).toEqual(first.segments);
    expect(actual.damage).toBeGreaterThanOrEqual(first.guaranteedDamage!); expect(actual.damage).toBeLessThanOrEqual(first.forecast!.damageMax);
    expect(actual.received).toBeGreaterThanOrEqual(first.forecast!.receivedMin); expect(actual.received).toBeLessThanOrEqual(first.forecast!.receivedMax);
  });
  it('returns every upper-left-sorted tied origin in both modes, never an illegal one', () => {
    const run = boardWith([0, 40, 80]); run.inventory = ['lens']; run.tier.lens = 2;
    for (const skill of [false, true]) {
      const expected = legalOrigins(run, skill).map(cell => ({ cell, length: previewAction(run, cell, skill).path.length }));
      const maximum = Math.max(...expected.map(p => p.length));
      const result = longestOrigins(run, skill);
      expect(result).toEqual({ cells: expected.filter(p => p.length === maximum).map(p => p.cell), length: maximum });
      expect(result.cells.length).toBeGreaterThan(1);
    }
  });
  it('caches independently of selected origin, returns defensive copies, and invalidates path-changing resources', () => {
    const run = crossSheet(), result = longestOrigins(run, true), before = structuredClone(result);
    const random = vi.spyOn(Random.prototype, 'next');
    try {
      result.cells.length = 0;
      for (let i = 0; i < 5; i++) expect(longestOrigins(run, true)).toEqual(before);
      expect(random).not.toHaveBeenCalled();
      run.reservedAuto = 14; const changed = longestOrigins(run, true);
      expect(random).toHaveBeenCalled();
      expect(changed).toEqual({ cells: legalOrigins(run, true).filter(cell => previewAction(run, cell, true).path.length === changed.length), length: changed.length });
    } finally { random.mockRestore(); }
    run.mana = 0; run.freeSkillTokens = 0; expect(longestOrigins(run, true)).toEqual({ cells: [], length: 0 });
    run.freeSkillTokens = 1; expect(longestOrigins(run, true).cells.length).toBeGreaterThan(0);
    run.phase = 'reward'; expect(longestOrigins(run)).toEqual({ cells: [], length: 0 });
  });
});

describe('legacy endgame reward compatibility and five-encounter boons', () => {
  it('guarantees an available Lens/Wick upgrade at every boss until both are owned, without granting either', () => {
    for (let seed = 0; seed < 60; seed++) for (const owned of [[], ['lens'], ['wick']] as const) {
      const run = legacyFixture(seed); run.stage = 4; run.inventory = [...owned];
      for (const id of owned) run.tier[id] = 2;
      const before = structuredClone(run), offers = rollRewards(run, new Random(seed));
      expect(offers).toHaveLength(3); expect(offers).toContain('skill-upgrade');
      const outstanding = ['lens', 'wick'].filter(id => !owned.includes(id as never));
      expect(offers.some(id => outstanding.some(key => id === `greater:${key}`))).toBe(true);
      expect(run).toEqual(before);
    }
  });
  it.each(primes)('%s duplicates stop at acquisition rank three while upper tier stays independent', id => {
    let run = legacyFixture(); run.inventory = [...run.pool];
    for (const prime of primes) run.acquisitionRank[prime] = prime === id ? 1 : 3;
    run.tier[id] = 2; run.phase = 'reward'; run.rewards = [id];
    run = choose(run, id); expect(run.acquisitionRank[id]).toBe(2); expect(run.tier[id]).toBe(2);
    run.phase = 'reward'; run.rewards = [id]; run = choose(run, id);
    expect(run.acquisitionRank[id]).toBe(3); expect(run.inventory.filter(relic => relic === id)).toHaveLength(1);
    expect(canTakeReward(run, id)).toBe(false);
    expect(rollRewards(run, new Random(1))).not.toContain(id);
  });
  function allUpperReward(): Run {
    const run = legacyFixture(); run.stage = 34; run.stats.kills = 35; run.phase = 'reward'; run.skillRank = 2;
    run.inventory = RELICS.map(relic => relic.id); run.tier = Object.fromEntries(greaterIds.map(id => [id, 2]));
    for (const id of primeIds) run.acquisitionRank[id] = 3;
    run.rewards = rollRewards(run, new Random(71)); return run;
  }
  it('offers exactly training, magic, and defense when all upper relics are owned', () => {
    const run = allUpperReward();
    expect([...run.rewards].sort()).toEqual(['defense-boon', 'magic-boon', 'training']);
    const ordinary = structuredClone(run); ordinary.stage = 35;
    expect(rollRewards(ordinary, new Random(71)).sort()).toEqual(['recovery', 'training', 'vitality']);
    expect(canTakeReward(ordinary, 'magic-boon')).toBe(false);
  });
  it.each(['magic-boon', 'defense-boon'] as const)('%s lasts exactly the next five encountered enemies, never sheets or casts', boon => {
    let run = allUpperReward(); run.mana = 8; run.manaOverflow = 2;
    run = choose(run, boon); const key = boon === 'magic-boon' ? 'magic' : 'defense';
    expect(run.boons[key]).toBe(5);
    if (key === 'magic') expect(run).toMatchObject({ mana: 8, manaOverflow: 2 });
    for (let remaining = 5; remaining > 0; remaining--) {
      expect(run.boons[key]).toBe(remaining);
      const cell = legalOrigins(run)[0]; run.enemyHp = 1;
      const killed = resolveAction(run, play(run, cell));
      expect(killed.boons[key]).toBe(remaining);
      // Select an actual legal reward; avoid refreshing the boon under test.
      const reward = killed.rewards.find(id => id !== boon && id !== 'magic-boon' && id !== 'defense-boon')!;
      killed.mana = 0; killed.manaOverflow = 0; run = choose(killed, reward);
      expect(run.boons[key]).toBe(remaining - 1);
      if (key === 'magic') expect(run.mana).toBe(remaining > 1 ? 8 : 0);
    }
  });
  it('retains boon counters when a single cast advances several sheets against the same enemy', () => {
    const run = crossSheet(); run.boons = { defense: 3, magic: 2 };
    const { cell } = longestCast(run), next = resolveAction(run, play(run, cell, true));
    expect(next.phase).toBe('battle'); expect(next.lastReport!.sheetsCompleted).toBeGreaterThanOrEqual(2);
    expect(next.boons).toEqual(run.boons); expect(next.stage).toBe(run.stage);
    expect(next.mana).toBe(0); // Magic refreshes only at the next enemy, never at a sheet boundary.
  });
  it('refreshes a boon to five rather than stacking durations and leaves the other boon independent', () => {
    const run = allUpperReward(); run.boons = { defense: 2, magic: 4 };
    expect(choose(run, 'defense-boon').boons).toEqual({ defense: 5, magic: 3 });
    expect(choose(run, 'magic-boon').boons).toEqual({ defense: 1, magic: 5 });
    const training = choose(run, 'training');
    expect(training.boons).toEqual({ defense: 1, magic: 3 }); expect(training.spellLevel).toBe(run.spellLevel + 1);
  });
  it('all character skill modes remain available under token payment', () => {
    for (const character of CHARACTERS) {
      const run = fixture(22, character.id); run.mana = 0; run.freeSkillTokens = 1;
      const root = legalOrigins(run, true).find(cell => candidates(run.cells, cell).length > 1)!;
      expect(root).toBeDefined(); expect(resolveAction(run, play(run, root, true)).lastReport!.skill).toBe(true);
    }
  });
});
