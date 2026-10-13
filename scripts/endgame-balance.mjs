/** Deterministic engine evidence, not a human playtest.
 * Run: node scripts/endgame-balance.mjs [seed-count]
 * Uses actual legal actions, actual reward selection, and the production reducer.
 * The controlled endgame checkpoint is synthetic; outcomes must not be described
 * as organically attained progression or human balance validation.
 */
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const engine = await server.ssrLoadModule('/src/game/engine.ts');
  const { CHARACTERS, RELICS, greaterIds, primeIds } = await server.ssrLoadModule('/src/game/content.ts');
  const { rollRewards } = await server.ssrLoadModule('/src/game/rewards.ts');
  const { Random } = await server.ssrLoadModule('/src/game/sudoku.ts');
  const count = Number(process.argv[2] ?? 6);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Seed count must be 1–100.');
  const { newSave, startRun, legalOrigins, previewAction, resolveAction, longestOrigins, canUseSkill, primeRoll } = engine;
  const percentile = (values, percent) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * percent))];
  const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;
  function checkpoint(seed, character, stage, level) {
    const save = newSave(); save.meta.clears = 999;
    const run = startRun(save, character, seed).run;
    run.stage = stage; run.stats.kills = stage + 1; run.phase = 'reward'; run.enemyHp = 0;
    run.inventory = RELICS.map(relic => relic.id); run.tier = Object.fromEntries(greaterIds.map(id => [id, 2]));
    run.acquisitionRank = Object.fromEntries(primeIds.map(id => [id, 3]));
    run.spellLevel = level; run.skillRank = 2; run.maxHp = 40 + (level - 1) * 4 - 8;
    run.hp = Math.floor(run.maxHp * .75); run.mana = 0; run.manaOverflow = 0;
    run.rewards = rollRewards(run, new Random(seed));
    return run;
  }
  function action(run) {
    let best, bestValue = -Infinity;
    for (const skill of canUseSkill(run) ? [false, true] : [false]) for (const cell of legalOrigins(run, skill)) {
      const preview = previewAction(run, cell, skill);
      // Only guaranteed outcomes affect the policy; unrevealed prime results are never consulted.
      const value = (preview.defeated ? 1e9 : 0) + Math.min(preview.damage, run.enemyHp) - preview.received * 12 - (skill ? .001 : 0);
      if (value > bestValue) { bestValue = value; best = { type: 'play', cell, skill, revision: run.revision }; }
    }
    if (!best) throw new Error('No legal action');
    return best;
  }
  const cohorts = [{ name: 'after-boss-35', stage: 34, level: 65 }, { name: 'after-boss-45', stage: 44, level: 85 }];
  const samples = [], begin = performance.now();
  for (const cohort of cohorts) for (const character of CHARACTERS) for (let seed = 1; seed <= count; seed++) {
    const initial = checkpoint(seed, character.id, cohort.stage, cohort.level);
    for (const reward of ['training', 'magic-boon', 'defense-boon']) {
      let run = resolveAction(initial, { type: 'reward', relic: reward, revision: initial.revision });
      let casts = 0, damage = 0, received = 0, skills = 0, freeSkills = 0, maxChain = 0, sheets = 0;
      const killsBefore = run.stats.kills, hpBefore = run.hp, levelsBefore = run.spellLevel;
      const encounters = [];
      // Purpose bound: exactly the five enemies covered by the offered boon, or death.
      while (run.phase !== 'lost' && run.stats.kills - killsBefore < 5) {
        if (casts > 2000) throw new Error('Simulation safety failure: over 2000 casts within five encounters.');
        if (run.phase === 'reward') {
          const nextReward = run.rewards.includes('training') ? 'training' : run.rewards.includes('recovery') ? 'recovery' : run.rewards[0];
          run = resolveAction(run, { type: 'reward', relic: nextReward, revision: run.revision });
          continue;
        }
        const before = run;
        run = resolveAction(run, action(run)); const report = run.lastReport;
        casts++; damage += report.damage; received += report.received; skills += report.skill ? 1 : 0;
        freeSkills += report.freeSkill ? 1 : 0; maxChain = Math.max(maxChain, report.path.length); sheets += report.sheetsCompleted;
        let encounter = encounters.at(-1);
        if (!encounter || encounter.encounter !== before.stage + 1) {
          encounter = { encounter: before.stage + 1, casts: 0, received: 0, skills: 0, startMana: before.mana, startTokens: before.freeSkillTokens, killed: false };
          encounters.push(encounter);
        }
        encounter.casts++; encounter.received += report.received; encounter.skills += report.skill ? 1 : 0; encounter.killed = report.defeated;
      }
      samples.push({ cohort: cohort.name, character: character.id, seed, reward, kills: run.stats.kills - killsBefore, lost: run.phase === 'lost', casts, damage, received, skills, freeSkills, maxChain, sheets, hpBefore, hpAfter: run.hp, maxHpAfter: run.maxHp, levelsGained: run.spellLevel - levelsBefore, encounters });
    }
  }
  const comparisons = cohorts.flatMap(cohort => CHARACTERS.flatMap(character => ['training', 'magic-boon', 'defense-boon'].map(reward => {
    const rows = samples.filter(p => p.cohort === cohort.name && p.character === character.id && p.reward === reward);
    return { cohort: cohort.name, character: character.id, reward, samples: rows.length, meanKills: mean(rows.map(p => p.kills)), deaths: rows.filter(p => p.lost).length, meanCasts: mean(rows.map(p => p.casts)), meanReceived: mean(rows.map(p => p.received)), meanEndHp: mean(rows.map(p => p.hpAfter)), meanSkills: mean(rows.map(p => p.skills)), meanFreeSkills: mean(rows.map(p => p.freeSkills)), maxChain: Math.max(...rows.map(p => p.maxChain)) };
  })));
  const benchmarks = [];
  for (const character of CHARACTERS) for (const skill of [false, true]) {
    const cold = [], warm = [], lengths = [], roots = [];
    for (let i = 0; i < 25; i++) {
      const initial = checkpoint(1000 + i, character.id, 44, 85);
      const run = resolveAction(initial, { type: 'reward', relic: 'magic-boon', revision: initial.revision });
      const start = performance.now(), result = longestOrigins(run, skill); cold.push(performance.now() - start);
      lengths.push(result.length); roots.push(result.cells.length);
      const cached = performance.now(); for (let repeat = 0; repeat < 100; repeat++) longestOrigins(run, skill);
      warm.push((performance.now() - cached) / 100);
    }
    benchmarks.push({ character: character.id, skill, samples: cold.length, coldMedianMs: percentile(cold, .5), coldP95Ms: percentile(cold, .95), warmMedianMs: percentile(warm, .5), warmP95Ms: percentile(warm, .95), maxChain: Math.max(...lengths), maximumTiedOrigins: Math.max(...roots) });
  }
  // Very late fuel capacity is deliberately uncapped. Sample worst-shaped cold
  // work separately instead of presenting level-85 timings as a universal bound.
  const stressBenchmarks = [];
  for (const character of CHARACTERS) for (const skill of [false, true]) {
    const samples = [];
    for (let seed = 9000; seed < 9005; seed++) {
      const save = newSave(); save.meta.clears = 999;
      const run = startRun(save, character.id, seed).run;
      run.inventory = RELICS.map(relic => relic.id); run.tier = Object.fromEntries(greaterIds.map(id => [id, 2]));
      run.spellLevel = 850; run.mana = 8; run.skillRank = 2;
      const start = performance.now(), result = longestOrigins(run, skill), coldMs = performance.now() - start;
      const cached = performance.now(); for (let repeat = 0; repeat < 100; repeat++) longestOrigins(run, skill);
      samples.push({ coldMs, warmMs: (performance.now() - cached) / 100, length: result.length, ties: result.cells.length });
    }
    stressBenchmarks.push({ character: character.id, skill, level: 850, samples });
  }
  const frequencySamples = 12000;
  const frequencies = primeIds.map(id => ({ id, samples: frequencySamples, ranks: [.3, .45, .6].map(chance => {
    let hits = 0; for (let seed = 0; seed < frequencySamples; seed++) if (primeRoll(seed, 23, id) < chance) hits++;
    return { chance, hits, rate: hits / frequencySamples };
  }) }));
  const report = {
    method: 'Controlled paired engine simulation, not human playtesting or organically attained runs. Identical synthetic post-boss checkpoints branch into the three actual offered rewards, then play five enemies or stop at death. All upper relics and rank-3 primes are equipped. Mana/tokens/overflow start empty. HP starts at 75% of level-derived maximum. Later ordinary rewards prefer training. The policy maximizes guaranteed damage minus twelve times received damage, prioritizes guaranteed kills, and never peeks at procs.',
    cohorts, seedsPerCharacterAndChoice: count, sampleCount: samples.length,
    runtime: process.version, elapsedSeconds: (performance.now() - begin) / 1000,
    limitations: ['These controlled loadouts isolate marginal reward value, not the probability of reaching them.', 'Engine timings exclude UI/render/animation and are hardware-dependent.', 'A deterministic greedy policy is not human play or an optimal solver.', 'Different cast counts change subsequent prime outcomes, so paired outcomes include the real strategic consequences of each reward.'],
    comparisons, benchmarks, stressBenchmarks, frequencies, samples,
  };
  mkdirSync('.runtime', { recursive: true });
  writeFileSync('.runtime/endgame-balance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ sampleCount: report.sampleCount, elapsedSeconds: report.elapsedSeconds, comparisons, benchmarks, stressBenchmarks, frequencies }, null, 2));
} finally { await server.close(); }
