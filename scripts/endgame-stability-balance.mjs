/** Paired, reproducible endgame balance evidence; never an optimal/human play claim.
 * Run: node scripts/endgame-stability-balance.mjs
 * Optional PowerShell environment: $env:MODES='baseline,rewards,chain,curve,full'
 * SEEDS=102,103 CHARACTERS=fuse,scribe,lumen STAGE_LIMIT=150 ROOT_BUDGET=6
 * BASELINE_REF defaults to the pre-change 25f0dec commit, resolved before bundling.
 * Fixtures are synthetic, explicitly separate from natural initial-state runs.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = process.cwd(), began = performance.now();
const output = process.env.OUTPUT ?? '.runtime/endgame-stability-balance.json';
const characters = (process.env.CHARACTERS ?? 'fuse,scribe,lumen').split(',');
const seeds = (process.env.SEEDS ?? '102,103').split(',').map(Number);
const modes = (process.env.MODES ?? 'baseline,full').split(',');
const stageLimit = Number(process.env.STAGE_LIMIT ?? 150);
const rootBudget = Number(process.env.ROOT_BUDGET ?? 6);
const timeLimitSeconds = Number(process.env.TIME_LIMIT_SECONDS ?? 1200);
const baselineRef = execFileSync('git', ['rev-parse', process.env.BASELINE_REF ?? '25f0dec05bd5e990357061587d7dc59e0fd00708'], { encoding: 'utf8' }).trim();
const fixtureLevels = (process.env.FIXTURE_LEVELS ?? '100,300,800').split(',').map(Number);
if (!Number.isInteger(rootBudget) || rootBudget < 1 || !Number.isInteger(stageLimit) || stageLimit < 1) throw new Error('Invalid positive integer root budget or stage limit');
for (const mode of modes) if (!['baseline', 'rewards', 'chain', 'curve', 'full'].includes(mode)) throw new Error(`Unknown mode ${mode}`);
mkdirSync('.runtime', { recursive: true });
const tracked = ['engine', 'enemies', 'rewards', 'types', 'storage', 'growth', 'sudoku', 'board-generation', 'content'];
const gitSource = file => execFileSync('git', ['show', `${baselineRef}:${file}`], { maxBuffer: 64 * 1024 * 1024 });
const digest = content => createHash('sha256').update(content).digest('hex');
const hashes = {
  baseline: Object.fromEntries(tracked.map(file => [file, digest(gitSource(`src/game/${file}.ts`))])),
  current: Object.fromEntries(tracked.map(file => [file, digest(readFileSync(`src/game/${file}.ts`))])),
};
hashes.current.endgame = digest(readFileSync('src/game/endgame.ts'));
const engines = {};
for (const mode of [...new Set([...modes, 'baseline', 'full'])]) {
  const transformed = {};
  const bundle = resolve(`.runtime/endgame-${process.pid}-${mode}.mjs`);
  await build({
    stdin: { contents: `export * from './src/game/engine.ts'; export * from './src/game/growth.ts'; export * from './src/game/enemies.ts'; export * from './src/game/relic-slots.ts'; export { parseSave } from './src/game/storage.ts';`, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
    plugins: [{ name: 'explicit-balance-variant', setup(build) {
      build.onLoad({ filter: /\.(?:ts|json)$/ }, args => {
        const file = relative(root, args.path).replaceAll('\\', '/');
        if (!file.startsWith('src/')) return;
        let contents = mode === 'baseline' ? gitSource(file).toString('utf8') : readFileSync(args.path, 'utf8');
        // Test-only ablations leave encounter migration/version assignment intact.
        // Only the eligibility conditions for chain rescue / enemy curves change.
        const disableChain = (mode === 'rewards' || mode === 'curve') && file === 'src/game/endgame.ts';
        const disableCurves = (mode === 'rewards' || mode === 'chain') && file === 'src/game/enemies.ts';
        if (disableChain || disableCurves) {
          let count = 0;
          contents = contents.replace(/\b(?:(?:source|run)\.)?endgameBalanceVersion\s*===\s*1/g, () => { count++; return 'false'; });
          if (!count) throw new Error(`Could not disable ${disableChain ? 'chain rescue' : 'enemy curves'} in ${file}; update this explicit test-only transformation.`);
          transformed[file] = count;
        }
        return { contents, loader: file.endsWith('.json') ? 'json' : 'ts' };
      });
    } }],
  });
  engines[mode] = await import(pathToFileURL(bundle).href);
  if (Object.keys(transformed).length) console.log(JSON.stringify({ mode, testOnlyConditionOverrides: transformed }));
}

const method = {
  description: 'Paired initial-state organic runs with identical seeds, reward preferences and limited guaranteed-outcome preview policy. Baseline is the complete pinned Git source; full is the unmodified working source. Ablations use current rewards and explicitly disable only endgame condition checks in chain planning or enemy curves.',
  baselineRef, hashes, runtime: process.version, characters, seeds, modes, stageLimit, rootBudget, timeLimitSeconds,
  selection: 'At most ROOT_BUDGET deterministic roots per available normal/intrinsic/equipped skill: weak/shield marked roots, then evenly spread legal roots. Choose guaranteed kill, then capped guaranteed damage minus 15 times worst-case incoming HP damage plus 5 for a completed sheet; ties prefer no skill. Never call primeRoll, inspect triggered results, or use forecast.damageMax to choose. Rewards follow a fixed preference; replacement retires the least preferred held relic.',
  limitations: 'Limited-root greedy policy is neither optimal nor human play. Natural growth is never pregranted; meta unlocks only allow all character/relic choices. Source changes legitimately diverge future board/reward streams. Defeats and stage/time/cast censored runs are distinct. Synthetic max-equipment fixtures measure paths and guaranteed damage, not natural attainment or survival.',
};
const samples = [], fixtures = [], curves = [];
function persist() { writeFileSync(output, JSON.stringify({ method, elapsedSeconds: (performance.now() - began) / 1000, curves, samples, fixtures }, null, 2)); }
const elapsed = () => (performance.now() - began) / 1000;
const relicPreference = ['wick', 'pen', 'ward', 'rekindle', 'amplifier', 'trinity', 'quint', 'lens', 'echo', 'battery', 'stroke', 'duality', 'sept', 'afterglow', 'glass', 'gold'];
const preferenceIndex = id => { const index = relicPreference.indexOf(id); return index < 0 ? relicPreference.length : index; };
function rewardValue(e, run, id) {
  if (id === 'recovery') return run.hp < run.maxHp * .5 ? 2000 : 0;
  if (id === 'wick' && !run.inventory.includes('wick')) return 1600;
  if (id === 'greater:wick') return 1700;
  if (id === `skill:${run.character}`) return 1400 - e.skillLevel(run, run.character);
  if (id === 'skill:bridge') return 1300 - e.skillLevel(run, 'bridge');
  if (id.startsWith('skill:')) return 800;
  if (id === 'magic-boon') return !run.boons.magic ? 675 : 350;
  if (id === 'defense-boon') return !run.boons.defense ? 640 : 325;
  if (id === 'training') return 500;
  if (id === 'vitality') return run.hp < run.maxHp * .7 ? 510 : 450;
  const base = id.replace(/^(?:greater:|apex:)/, '');
  if (id.startsWith('greater:') || id.startsWith('apex:')) return 1100 - preferenceIndex(base) * 15;
  if (run.inventory.includes(base)) return 900 - preferenceIndex(base) * 15 - e.relicLevel(run, base) * 10;
  return run.inventory.length >= e.RELIC_CAPACITY ? 150 - preferenceIndex(base) * 5 : 1000 - preferenceIndex(base) * 30;
}
function rootChoices(e, run, skillId) {
  const legal = e.legalOrigins(run, !!skillId, skillId);
  if (legal.length <= rootBudget) return legal;
  const chosen = [];
  const add = cell => { if (cell !== undefined && !chosen.includes(cell) && chosen.length < rootBudget) chosen.push(cell); };
  add(legal.find(cell => run.marks[cell] === 'weak'));
  add(legal.find(cell => run.marks[cell] === 'shield'));
  for (let index = 0; index < rootBudget; index++) add(legal[Math.floor(index * (legal.length - 1) / Math.max(1, rootBudget - 1))]);
  for (const cell of legal) add(cell);
  return chosen;
}
function bestAction(e, run, onlySkill) {
  let action, best = -Infinity;
  const skillIds = onlySkill ? [onlySkill] : e.canUseSkill(run) ? [undefined, run.character, ...run.equippedSkills] : [undefined];
  for (const skillId of [...new Set(skillIds)]) for (const cell of rootChoices(e, run, skillId)) {
    const p = e.previewAction(run, cell, !!skillId, skillId);
    // p is the no-proc settlement. received is therefore the conservative counter.
    const value = (p.defeated ? 1e15 : 0) + Math.min(run.enemyHp, p.damage) - p.received * 15 + (p.fullClear ? 5 : 0) - (skillId ? .001 : 0);
    if (value > best) { best = value; action = { type: 'play', cell, skill: !!skillId, skillId, revision: run.revision }; }
  }
  if (!action) throw new Error('No legal action');
  return action;
}
function castMetrics(report) {
  const granted = (report.chain?.initialAuto ?? 0) + (report.chain?.steps ?? []).reduce((sum, step) => sum + step.addedAuto, 0);
  const left = report.chain?.remainingAuto ?? 0;
  const rescues = report.path.filter(event => event.rescue).length;
  const fuelInputs = report.path.filter(event => event.source === 'chain').length;
  if (rescues > 1 || left < 0 || left > granted) throw new Error('Invalid once-per-cast rescue / fuel accounting');
  return { chain: report.path.length, sheets: report.sheetsCompleted ?? 0, stop: report.chain?.stopReason ?? null,
    rescues, bridges: report.path.filter(event => event.bridge).length,
    fuelGranted: granted, fuelRemaining: left, fuelSpent: granted - left, fuelInputs, rescueTax: rescues * 5,
    fuelUseRate: granted ? (granted - left) / granted : null, productiveFuelUseRate: granted ? fuelInputs / granted : null };
}
function summarize(battles, casts) {
  const won = battles.filter(battle => battle.defeated && !battle.lost), fuel = casts.reduce((sum, cast) => sum + cast.fuelGranted, 0);
  return { attemptedBattles: battles.length, kills: won.length, casts: casts.length, oneHitWins: won.filter(battle => battle.casts === 1).length,
    oneHitWinRate: won.length ? won.filter(battle => battle.casts === 1).length / won.length : null,
    castsPerWonBattle: won.length ? won.reduce((sum, battle) => sum + battle.casts, 0) / won.length : null,
    noTargetCasts: casts.filter(cast => cast.stop === 'no-target').length, rescueCasts: casts.filter(cast => cast.rescues > 0).length,
    rescues: casts.reduce((sum, cast) => sum + cast.rescues, 0), fuelGranted: fuel,
    fuelRemaining: casts.reduce((sum, cast) => sum + cast.fuelRemaining, 0),
    fuelUseRate: fuel ? casts.reduce((sum, cast) => sum + cast.fuelSpent, 0) / fuel : null,
    productiveFuelUseRate: fuel ? casts.reduce((sum, cast) => sum + cast.fuelInputs, 0) / fuel : null,
    rescueTax: casts.reduce((sum, cast) => sum + cast.rescueTax, 0),
    completedSheets: casts.reduce((sum, cast) => sum + cast.sheets, 0), received: casts.reduce((sum, cast) => sum + cast.received, 0),
    bossAttempts: battles.filter(battle => battle.boss).length,
    bosses: battles.filter(battle => battle.boss).map(battle => ({ wave: battle.wave, casts: battle.casts, received: battle.received, defeated: battle.defeated, lost: battle.lost })),
  };
}

for (const wave of [1, 15, 50, 51, 80, 100, 145, 150, 200]) {
  const e = engines.full, save = e.newSave(); save.meta.clears = 99;
  const run = e.startRun(save, 'lumen', 102).run; run.stage = wave - 1;
  const previous = engines.baseline.enemyForRun({ ...run, endgameBalanceVersion: undefined }), next = e.enemyForRun(run);
  curves.push({ wave, boss: next.isBoss, previousHp: previous.hp, nextHp: next.hp, previousAttack: previous.attack, nextAttack: next.attack });
}

for (const character of characters) for (const seed of seeds) for (const mode of modes) {
  if (elapsed() >= timeLimitSeconds) { method.timeLimitReachedBeforeAllSamples = true; break; }
  const e = engines[mode], save = e.newSave(); save.meta.clears = 99;
  let run = e.startRun(save, character, seed).run;
  const result = { character, seed, mode, kind: 'organic-initial-state', rewards: [], casts: [], battles: [], checkpoints: [] };
  let battle = null, reason = null;
  while (run.phase === 'battle' || run.phase === 'reward') {
    if (run.phase === 'reward' && run.stage + 1 >= stageLimit) { reason = 'stage-limit'; break; }
    if (elapsed() >= timeLimitSeconds) { reason = 'time-limit'; break; }
    if (result.casts.length >= 2000) { reason = 'cast-limit'; break; }
    if (run.phase === 'reward') {
      const selected = [...run.rewards].sort((a, b) => rewardValue(e, run, b) - rewardValue(e, run, a))[0];
      const replace = e.needsRelicReplacement(run, selected) ? [...run.inventory].sort((a, b) => preferenceIndex(b) - preferenceIndex(a))[0] : undefined;
      result.rewards.push({ wave: run.stage + 1, step: run.rewardStep, choices: [...run.rewards], selected, replace: replace ?? null,
        forcedReplacementMenu: run.rewards.every(id => e.needsRelicReplacement(run, id)), fullInventory: run.inventory.length >= e.RELIC_CAPACITY });
      run = e.resolveAction(run, { type: 'reward', relic: selected, replace, revision: run.revision });
      continue;
    }
    if (!battle) {
      const enemy = e.enemyForRun(run);
      battle = { wave: run.stage + 1, boss: enemy.isBoss, enemyHp: run.enemyHp, attack: enemy.attack, level: run.spellLevel, hpBefore: run.hp, maxHp: run.maxHp, casts: 0, received: 0, defeated: false, lost: false };
      if ([1, 50, 75, 100, 125, 150, 175, 200].includes(run.stage + 1)) result.checkpoints.push({ wave: run.stage + 1, spellLevel: run.spellLevel, hp: run.hp, maxHp: run.maxHp, mana: run.mana, freeSkillTokens: run.freeSkillTokens, inventory: [...run.inventory], relicLevels: { ...run.relicLevels }, tiers: { ...run.tier }, skills: { ...run.skillLevels } });
    }
    const action = bestAction(e, run), before = { wave: run.stage + 1, level: run.spellLevel, hpBefore: run.hp, maxHpBefore: run.maxHp, enemyBefore: run.enemyHp, boss: battle.boss };
    run = e.resolveAction(run, action);
    const report = run.lastReport;
    result.casts.push({ ...before, ...castMetrics(report), skill: action.skillId ?? null, cell: action.cell, damage: report.damage,
      guaranteedDamage: report.guaranteedDamage, received: report.received, incoming: report.incoming, shield: report.shield,
      hp: run.hp, maxHp: run.maxHp, levelAfter: run.spellLevel, defeated: report.defeated });
    battle.casts++; battle.received += report.received;
    if (report.defeated || run.phase === 'lost') {
      battle.defeated = report.defeated; battle.lost = run.phase === 'lost'; result.battles.push(battle); battle = null;
    }
    if (result.casts.length % 20 === 0) console.log(JSON.stringify({ progress: { character, seed, mode, wave: run.stage + 1, casts: result.casts.length, level: run.spellLevel, seconds: Math.round(elapsed()) } }));
  }
  if (battle) result.battles.push({ ...battle, unfinished: true });
  result.final = { phase: run.phase, termination: run.phase === 'lost' ? 'defeat' : reason ?? run.phase, censored: reason !== null,
    deathWave: run.phase === 'lost' ? run.stage + 1 : null, reachedWave: run.stage + 1, kills: run.stats.kills,
    casts: result.casts.length, spellLevel: run.spellLevel, hp: run.hp, maxHp: run.maxHp, bestChain: run.stats.bestChain, completedSheets: run.stats.sheets,
    inventory: [...run.inventory], relicLevels: { ...run.relicLevels }, tiers: { ...run.tier }, skillLevels: { ...run.skillLevels } };
  result.summary = summarize(result.battles, result.casts);
  result.summary.fullInventoryMenus = result.rewards.filter(reward => reward.fullInventory).length;
  result.summary.forcedReplacementMenus = result.rewards.filter(reward => reward.forcedReplacementMenu).length;
  result.windows = Object.fromEntries([[1, 50], [51, 100], [101, 150], [151, 200]].map(([from, to]) => [`${from}-${to}`, summarize(result.battles.filter(battle => battle.wave >= from && battle.wave <= to), result.casts.filter(cast => cast.wave >= from && cast.wave <= to))]));
  // Production saves, including death/reward states, must pass the real parser.
  e.parseSave(JSON.stringify({ ...save, run })); result.saveRoundTripValidated = true;
  samples.push(result); persist();
  console.log(JSON.stringify({ completed: { character, seed, mode, ...result.final, summary: { oneHitWins: result.summary.oneHitWins, noTargetCasts: result.summary.noTargetCasts, rescues: result.summary.rescues, fuelUseRate: result.summary.fuelUseRate, received: result.summary.received, forcedReplacementMenus: result.summary.forcedReplacementMenus }, seconds: Math.round(elapsed()) } }));
}

if (process.env.SKIP_FIXTURES !== '1' && elapsed() < timeLimitSeconds) {
  for (const character of characters) for (const seed of seeds) for (const level of fixtureLevels) for (const mode of ['baseline', 'full']) {
    if (elapsed() >= timeLimitSeconds) { method.fixturesTimeLimited = true; break; }
    const e = engines[mode], save = e.newSave(); save.meta.clears = 99;
    const run = e.startRun(save, character, seed).run;
    run.stage = 144; run.spellLevel = level; run.hp = run.maxHp = 120 + level * 4; run.mana = 8; run.enemyHp = Number.MAX_SAFE_INTEGER;
    run.inventory = ['wick', 'rekindle', 'pen', 'lens', 'amplifier', 'trinity', 'quint', 'duality'];
    run.relicLevels = Object.fromEntries(run.inventory.map(id => [id, 10]));
    run.tier = Object.fromEntries(run.inventory.map(id => [id, 3]));
    run.acquisitionRank = Object.fromEntries(run.inventory.map(id => [id, 3]));
    run.skillLevels = { [character]: 10, bridge: 10 }; run.skillRank = 2; run.equippedSkills = ['bridge'];
    const skillResults = {};
    for (const skill of ['bridge', character]) {
      const action = bestAction(e, run, skill), report = e.previewAction(run, action.cell, true, skill);
      skillResults[skill] = { cell: action.cell, ...castMetrics(report), guaranteedDamage: report.damage, extraDamage: report.extraDamage, received: report.received };
    }
    fixtures.push({ kind: 'synthetic-fixed-equipment-preview', character, seed, level, mode, wave: 145, allEquipmentLevel: 10, allEquipmentTier: 3,
      bridgeRelativeGuaranteedDamage: skillResults.bridge.guaranteedDamage / skillResults[character].guaranteedDamage, skills: skillResults });
    persist();
  }
}
persist();
console.log(JSON.stringify({ output, naturalSamples: samples.length, fixtures: fixtures.length, elapsedSeconds: Math.round(elapsed()) }));
