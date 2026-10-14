/** Fixed-seed reward-offer comparison, not organic-run balance or player-choice data.
 * Usage: node scripts/reward-sampling-report.mjs [samples=10000] [baseline-ref]
 * The default baseline is the pre-weighting commit; only its rewards module is
 * loaded alongside the current eligibility/content definitions. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const samples = Number(process.argv[2] ?? 10000);
const baselineRef = process.argv[3] ?? '620a7aea4ec67aa4cd1ce42cfe262f374b8b5a82';
if (!Number.isInteger(samples) || samples < 1) throw new Error('Samples must be a positive integer');
const baselineSource = execFileSync('git', ['show', `${baselineRef}:src/game/rewards.ts`], { encoding: 'utf8' });
mkdirSync('.runtime/reward-sampling', { recursive: true });
writeFileSync('.runtime/reward-sampling/baseline.ts', baselineSource.replace(/from '\.\/([^']+)'/g, "from '/src/game/$1'"));
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { rollRelicRewards: current, rollRewards: currentRewards } = await server.ssrLoadModule('/src/game/rewards.ts');
  const { rollRelicRewards: baseline, rollRewards: baselineRewards } = await server.ssrLoadModule('/.runtime/reward-sampling/baseline.ts');
  const { newSave, startRun } = await server.ssrLoadModule('/src/game/engine.ts');
  const { Random } = await server.ssrLoadModule('/src/game/sudoku.ts');
  const characters = ['fuse', 'scribe', 'lumen'];
  const halfOwned = ['echo', 'rekindle', 'pen', 'ward', 'battery', 'glass', 'trinity', 'sept'];
  const baseOf = id => id.replace(/^(greater|apex):/, '');
  const isEvolution = id => id.startsWith('greater:') || id.startsWith('apex:');
  const seedOf = index => Math.imul(index + 1, 0x9e3779b1) >>> 0;
  function fixture(character, stage, level, inventory, wickTier = 1) {
    const save = newSave(); save.meta.clears = 99;
    const run = startRun(save, character, 73).run;
    run.stage = stage; run.phase = 'reward'; run.rewardStep = 'relic';
    run.inventory = inventory === 'all' ? [...run.pool] : [...inventory];
    run.relicLevels = Object.fromEntries(run.inventory.map(id => [id, level]));
    run.tier = Object.fromEntries(run.inventory.map(id => [id, id === 'wick' ? wickTier : 1]));
    run.acquisitionRank = Object.fromEntries(run.inventory.map(id => [id, 1]));
    return run;
  }
  function measure(roll, run) {
    let evolutionMenus = 0, evolutionCount = 0, ownedCount = 0, multiOwnedMenus = 0, missingMenus = 0;
    for (let index = 0; index < samples; index++) {
      const offers = roll(run, new Random(seedOf(index)));
      if (offers.length !== 3 || new Set(offers.map(baseOf)).size !== 3) throw new Error('Invalid/duplicate offers');
      const evolutions = offers.filter(isEvolution).length;
      const owned = offers.filter(id => run.inventory.includes(baseOf(id))).length;
      evolutionMenus += Number(evolutions > 0); evolutionCount += evolutions; ownedCount += owned;
      multiOwnedMenus += Number(owned >= 2);
      missingMenus += Number(offers.some(id => run.pool.includes(id) && !run.inventory.includes(id)));
    }
    const pct = total => Number((total / samples * 100).toFixed(3));
    const mean = total => Number((total / samples).toFixed(5));
    return { anyEvolutionPct: pct(evolutionMenus), meanEvolutionChoices: mean(evolutionCount), meanOwnedChoices: mean(ownedCount), twoOrMoreOwnedPct: pct(multiOwnedMenus), anyNewRelicPct: pct(missingMenus) };
  }
  const rows = [];
  function record(cohort, run, level) {
    rows.push({ cohort, character: run.character, level, stage: run.stage, baseline: measure(baseline, run), current: measure(current, run) });
  }
  // One owned relic is guaranteed, making variant and menu rates identical.
  for (let level = 1; level <= 10; level++) record('single-eligible-owned-boss', fixture('fuse', 4, level, ['pen']), level);
  for (const character of characters) {
    record('half-owned-ordinary', fixture(character, 5, 3, halfOwned), 3);
    for (const level of [1, 3, 5, 8, 10]) {
      record('half-owned-boss', fixture(character, 4, level, halfOwned), level);
      // Upper wick avoids its forced first evolution, but respects its apex gate.
      record('all-owned-boss-upper-wick', fixture(character, 9, level, 'all', 2), level);
      record('wick-guaranteed-boss', fixture(character, 4, level, ['wick', ...halfOwned]), level);
    }
  }
  let noOwnedReplayChecks = 0, legacyReplayChecks = 0;
  for (const character of characters) for (const stage of [0, 1, 2, 4, 9]) {
    const run = fixture(character, stage, 1, []);
    for (let index = 0; index < 1000; index++) {
      const a = new Random(seedOf(index)), b = new Random(seedOf(index));
      if (JSON.stringify(baseline(run, a)) !== JSON.stringify(current(run, b)) || a.state !== b.state) throw new Error('No-owned replay changed');
      noOwnedReplayChecks++;
    }
    run.rewardStep = 'legacy';
    for (let index = 0; index < 100; index++) {
      const a = new Random(seedOf(index)), b = new Random(seedOf(index));
      if (JSON.stringify(baselineRewards(run, a)) !== JSON.stringify(currentRewards(run, b)) || a.state !== b.state) throw new Error('Legacy replay changed');
      legacyReplayChecks++;
    }
  }
  const result = {
    method: 'Identical fixed input states and fixed dispersed 32-bit seeds for both samplers. These are actual three-choice appearance rates, not choice/take rates or organic campaign outcomes. Baseline and current use their own reward RNG stream from the same seed.',
    samplesPerRow: samples, baselineRef,
    conditionalEvolutionWeights: { 'Lv1-2': 2, 'Lv3-4': 3, 'Lv5-7': 4, 'Lv8-9': 5, 'Lv10': 'Level-up is ineligible; eligible evolution only' },
    conditionalEvolutionProbabilities: { 'Lv1-2': '2/3', 'Lv3-4': '3/4', 'Lv5-7': '4/5', 'Lv8-9': '5/6' },
    fixtures: { halfOwned, bossOwnedSlot: 'Evolution ×2; affinity ×1.35; guaranteed wick takes precedence', bossFlexibleSlots: 'Evolution ×2', ordinaryFlexibleSlots: 'Owned ×1.35', guarantees: 'Missing and owned each retain one slot while available' },
    noOwnedReplayChecks, legacyReplayChecks, rows,
  };
  writeFileSync('.runtime/reward-sampling/report.json', JSON.stringify(result, null, 2));
  for (const row of rows.filter(row => row.character === 'fuse')) console.log(JSON.stringify(row));
  console.log(`Saved ${rows.length} rows; ${noOwnedReplayChecks} no-owned and ${legacyReplayChecks} legacy replays unchanged.`);
} finally { await server.close(); }
