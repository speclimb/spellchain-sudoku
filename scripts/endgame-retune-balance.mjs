/** Reproducible paired endgame trials. This limited-preview policy is not human
 * or optimal play. Baseline must be a complete frozen copy of the prior v1 src.
 * Run: node scripts/endgame-retune-balance.mjs
 * Defaults: v1 vs unmodified current source, three characters and two seeds.
 * Exploration env: MODES=v1,items,a,b,c,d SEEDS=102 STAGE_LIMIT=200 CAST_LIMIT=450
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = process.cwd(), began = performance.now();
const output = process.env.OUTPUT ?? '.runtime/endgame-retune-balance.json';
const snapshot = resolve(process.env.V1_SNAPSHOT ?? '.runtime/endgame-v1-snapshot');
const characters = (process.env.CHARACTERS ?? 'fuse,scribe,lumen').split(',');
const seeds = (process.env.SEEDS ?? '102,103').split(',').map(Number);
const modes = (process.env.MODES ?? 'v1,full').split(',');
const stageLimit = Number(process.env.STAGE_LIMIT ?? 200);
const castLimit = Number(process.env.CAST_LIMIT ?? 450);
const rootBudget = Number(process.env.ROOT_BUDGET ?? 6);
const timeLimitSeconds = Number(process.env.TIME_LIMIT_SECONDS ?? 1200);
const tuning = {
  v1: { attackSlope: 6, attackQuadraticDivisor: null, bossHpRatio: 6, rescue: 'v1 free once per cast' },
  items: { attackSlope: 6, attackQuadraticDivisor: null, bossHpRatio: 6, rescue: 'finite items' },
  a: { attackSlope: 8, attackQuadraticDivisor: 160, bossHpRatio: 8, rescue: 'finite items' },
  b: { attackSlope: 9, attackQuadraticDivisor: 120, bossHpRatio: 9, rescue: 'finite items' },
  c: { attackSlope: 10, attackQuadraticDivisor: null, bossHpRatio: 8, rescue: 'finite items' },
  d: { attackSlope: 7, attackQuadraticDivisor: null, bossHpRatio: 7, rescue: 'finite items' },
  full: null,
};
for (const [name, value] of Object.entries({ rootBudget, stageLimit, castLimit })) if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
for (const mode of modes) if (!(mode in tuning)) throw new Error(`Unknown mode ${mode}`);
mkdirSync('.runtime', { recursive: true });
const digest = content => createHash('sha256').update(content).digest('hex');
const tracked = ['engine', 'enemies', 'endgame', 'rewards', 'types', 'storage', 'growth', 'sudoku', 'board-generation', 'content'];
const hashes = Object.fromEntries(['v1', 'current'].map(kind => [kind, Object.fromEntries(tracked.map(file => [file,
  digest(readFileSync(resolve(kind === 'v1' ? snapshot : root, `src/game/${file}.ts`)))]))]));
const engines = {};
for (const mode of modes) {
  const overridden = {};
  const bundle = resolve(`.runtime/endgame-retune-${process.pid}-${mode}.mjs`);
  await build({
    stdin: { contents: `export * from './src/game/engine.ts'; export * from './src/game/growth.ts'; export * from './src/game/enemies.ts'; export * from './src/game/relic-slots.ts'; export { parseSave } from './src/game/storage.ts';`, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
    plugins: [{ name: 'explicit-retune-variant', setup(build) {
      build.onLoad({ filter: /\.(?:ts|json)$/ }, args => {
        const file = relative(root, args.path).replaceAll('\\', '/');
        if (!file.startsWith('src/')) return;
        let contents = readFileSync(mode === 'v1' ? resolve(snapshot, file) : args.path, 'utf8');
        if (mode !== 'v1' && mode !== 'full' && file === 'src/game/enemies.ts') {
          for (const [key, value] of Object.entries({
            ENDGAME_ATTACK_SLOPE: tuning[mode].attackSlope,
            ENDGAME_ATTACK_QUADRATIC_DIVISOR: tuning[mode].attackQuadraticDivisor ?? 'Infinity',
            ENDGAME_BOSS_HP_RATIO: tuning[mode].bossHpRatio,
          })) {
            const pattern = new RegExp(`(export const ${key} = )[^;]+;`);
            if (!pattern.test(contents)) throw new Error(`Missing candidate override ${key}`);
            contents = contents.replace(pattern, `$1${value};`);
            overridden[key] = value;
          }
        }
        return { contents, loader: file.endsWith('.json') ? 'json' : 'ts' };
      });
    } }],
  });
  engines[mode] = await import(pathToFileURL(bundle).href);
  console.log(JSON.stringify({ bundled: mode, testOnlyConstantOverrides: overridden }));
}

const method = {
  description: 'Paired organic initial-state runs; complete frozen v1 source vs current finite-item source with explicit test-only enemy constant overrides. No production changes are made by this script.',
  snapshot, hashes, runtime: process.version, characters, seeds, modes, tuning, stageLimit, castLimit, rootBudget, timeLimitSeconds,
  selection: `At most ${rootBudget} fixed roots per available normal/intrinsic/equipped skill: weak/shield marks then evenly spaced legal roots. Choose guaranteed kill, then capped guaranteed damage minus 15 times worst-case received damage plus 5 for a completed sheet. Ties prefer normal cast. Rewards follow one fixed preference. Never use random proc outcomes or damageMax to choose.`,
  limitations: 'Greedy limited-root policy is neither optimal nor human play. No natural growth is pregranted; meta unlocks only enable character/relic choices. Diverging source can change later board/reward streams. Defeat, stage-limit, cast-limit and time-limit are recorded separately.',
};
const samples = [], curves = [];
const elapsed = () => (performance.now() - began) / 1000;
function persist() { writeFileSync(output, JSON.stringify({ method, elapsedSeconds: elapsed(), curves, samples }, null, 2)); }
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
function bestAction(e, run) {
  let action, report, best = -Infinity;
  const skillIds = e.canUseSkill(run) ? [undefined, run.character, ...run.equippedSkills] : [undefined];
  for (const skillId of [...new Set(skillIds)]) for (const cell of rootChoices(e, run, skillId)) {
    const p = e.previewAction(run, cell, !!skillId, skillId);
    const value = (p.defeated ? 1e15 : 0) + Math.min(run.enemyHp, p.damage) - p.received * 15 + (p.fullClear ? 5 : 0) - (skillId ? .001 : 0);
    if (value > best) { best = value; action = { type: 'play', cell, skill: !!skillId, skillId, revision: run.revision }; report = p; }
  }
  if (!action) throw new Error('No legal action');
  return { action, report };
}
function rescueState(run) { return { items: run.rescueItems ?? null, milestones: run.rescueMilestones ?? null }; }
function castMetrics(report) {
  const granted = (report.chain?.initialAuto ?? 0) + (report.chain?.steps ?? []).reduce((sum, step) => sum + step.addedAuto, 0);
  const left = report.chain?.remainingAuto ?? 0, rescues = report.path.filter(event => event.rescue).length;
  if (rescues > 1 || left < 0 || left > granted) throw new Error('Invalid rescue/fuel accounting');
  return { chain: report.path.length, sheets: report.sheetsCompleted ?? 0, stop: report.chain?.stopReason ?? null,
    rescues, bridges: report.path.filter(event => event.bridge).length,
    fuelGranted: granted, fuelRemaining: left, fuelSpent: granted - left,
    fuelInputs: report.path.filter(event => event.source === 'chain').length, rescueTax: rescues * 5 };
}
function summarize(battles, casts) {
  const won = battles.filter(battle => battle.defeated && !battle.lost), fuel = casts.reduce((sum, cast) => sum + cast.fuelGranted, 0);
  return { attemptedBattles: battles.length, kills: won.length, casts: casts.length,
    inputs: casts.reduce((sum, cast) => sum + cast.chain, 0),
    oneHitWins: won.filter(battle => battle.casts === 1).length,
    oneHitWinRate: won.length ? won.filter(battle => battle.casts === 1).length / won.length : null,
    castsPerWonBattle: won.length ? won.reduce((sum, battle) => sum + battle.casts, 0) / won.length : null,
    noTargetCasts: casts.filter(cast => cast.stop === 'no-target').length,
    rescueCasts: casts.filter(cast => cast.rescues > 0).length, rescues: casts.reduce((sum, cast) => sum + cast.rescues, 0),
    fuelGranted: fuel, fuelUseRate: fuel ? casts.reduce((sum, cast) => sum + cast.fuelSpent, 0) / fuel : null,
    completedSheets: casts.reduce((sum, cast) => sum + cast.sheets, 0),
    received: casts.reduce((sum, cast) => sum + cast.received, 0),
    hpAtRiskCasts: casts.filter(cast => !cast.defeated && cast.hp > 0 && cast.hp < cast.maxHp * .35).length,
    highHpFirstCounterBossDeaths: battles.filter(battle => battle.boss && battle.lost && battle.casts === 1 && battle.hpBefore >= battle.maxHp * .5).length,
    bossesSurvivingThreeDamagingCounters: battles.filter(battle => battle.boss && casts.filter(cast => cast.wave === battle.wave && cast.received > 0 && cast.hp > 0).length >= 3).length,
    bosses: battles.filter(battle => battle.boss).map(battle => ({ wave: battle.wave, casts: battle.casts, received: battle.received, hpBefore: battle.hpBefore, maxHp: battle.maxHp, hpAfter: battle.hpAfter, defeated: battle.defeated, lost: battle.lost })),
  };
}
for (const mode of modes) for (const wave of [50, 51, 80, 100, 125, 145, 150, 175, 200]) {
  const e = engines[mode], save = e.newSave(); save.meta.clears = 99;
  const run = e.startRun(save, 'lumen', 102).run; run.stage = wave - 1;
  const enemy = e.enemyForRun(run);
  curves.push({ mode, wave, boss: enemy.isBoss, hp: enemy.hp, attack: enemy.attack });
}
persist();
for (const character of characters) for (const seed of seeds) for (const mode of modes) {
  if (elapsed() >= timeLimitSeconds) { method.timeLimitReachedBeforeAllSamples = true; persist(); break; }
  const e = engines[mode], save = e.newSave(); save.meta.clears = 99;
  let run = e.startRun(save, character, seed).run;
  const result = { character, seed, mode, kind: 'organic-initial-state', rewards: [], casts: [], battles: [], checkpoints: [] };
  let battle = null, reason = null;
  while (run.phase === 'battle' || run.phase === 'reward') {
    if (run.phase === 'reward' && run.stage + 1 >= stageLimit) { reason = 'stage-limit'; break; }
    if (elapsed() >= timeLimitSeconds) { reason = 'time-limit'; break; }
    if (result.casts.length >= castLimit) { reason = 'cast-limit'; break; }
    if (run.phase === 'reward') {
      const selected = [...run.rewards].sort((a, b) => rewardValue(e, run, b) - rewardValue(e, run, a))[0];
      const replace = e.needsRelicReplacement(run, selected) ? [...run.inventory].sort((a, b) => preferenceIndex(b) - preferenceIndex(a))[0] : undefined;
      const rewardRecord = { wave: run.stage + 1, step: run.rewardStep, choices: [...run.rewards], selected, replace: replace ?? null,
        rescueBefore: rescueState(run), levelBefore: run.spellLevel,
        forcedReplacementMenu: run.rewards.every(id => e.needsRelicReplacement(run, id)), fullInventory: run.inventory.length >= e.RELIC_CAPACITY };
      run = e.resolveAction(run, { type: 'reward', relic: selected, replace, revision: run.revision });
      result.rewards.push({ ...rewardRecord, levelAfter: run.spellLevel, rescueAfter: rescueState(run) });
      continue;
    }
    if (!battle) {
      const enemy = e.enemyForRun(run);
      battle = { wave: run.stage + 1, boss: enemy.isBoss, enemyHp: run.enemyHp, attack: enemy.attack, level: run.spellLevel,
        hpBefore: run.hp, maxHp: run.maxHp, casts: 0, received: 0, defeated: false, lost: false };
      if ([1, 50, 75, 100, 125, 150, 175, 200].includes(run.stage + 1)) result.checkpoints.push({ wave: run.stage + 1,
        spellLevel: run.spellLevel, hp: run.hp, maxHp: run.maxHp, mana: run.mana, freeSkillTokens: run.freeSkillTokens,
        rescue: rescueState(run), inventory: [...run.inventory], relicLevels: { ...run.relicLevels }, tiers: { ...run.tier }, skills: { ...run.skillLevels } });
    }
    const beforeState = JSON.stringify(run), { action, report: preview } = bestAction(e, run);
    if (beforeState !== JSON.stringify(run)) throw new Error('Preview mutated source state');
    const before = { wave: run.stage + 1, level: run.spellLevel, hpBefore: run.hp, maxHpBefore: run.maxHp,
      enemyBefore: run.enemyHp, boss: battle.boss, rescueBefore: rescueState(run) };
    run = e.resolveAction(run, action);
    const report = run.lastReport, metrics = castMetrics(report), rescueAfter = rescueState(run);
    if (preview.path.filter(event => event.rescue).length !== metrics.rescues) throw new Error('Preview/settlement rescue count mismatch');
    const usedItems = before.rescueBefore.items === null ? null : metrics.rescues;
    const grantedItems = usedItems === null ? null : rescueAfter.items - before.rescueBefore.items + usedItems;
    if (grantedItems !== null && (!Number.isSafeInteger(grantedItems) || grantedItems < 0 || rescueAfter.items < 0)) throw new Error('Invalid finite item accounting');
    if (grantedItems !== null && (report.rescueItemsBefore !== before.rescueBefore.items || report.rescueItemsAfter !== rescueAfter.items || report.rescueItemsGranted !== grantedItems)) throw new Error('Finite item report/state mismatch');
    result.casts.push({ ...before, ...metrics, skill: action.skillId ?? null, cell: action.cell,
      damage: report.damage, guaranteedDamage: report.guaranteedDamage, received: report.received,
      incoming: report.incoming, shield: report.shield, hp: run.hp, maxHp: run.maxHp, levelAfter: run.spellLevel,
      rescueAfter, usedItems, grantedItems, defeated: report.defeated });
    battle.casts++; battle.received += report.received; battle.hpAfter = run.hp;
    if (report.defeated || run.phase === 'lost') {
      battle.defeated = report.defeated; battle.lost = run.phase === 'lost'; result.battles.push(battle); battle = null;
    }
    if (result.casts.length % 40 === 0) console.log(JSON.stringify({ progress: { character, seed, mode, wave: run.stage + 1, casts: result.casts.length, level: run.spellLevel, rescue: rescueState(run), seconds: Math.round(elapsed()) } }));
  }
  if (battle) result.battles.push({ ...battle, unfinished: true });
  result.final = { phase: run.phase, termination: run.phase === 'lost' ? 'defeat' : reason ?? run.phase, censored: reason !== null,
    deathWave: run.phase === 'lost' ? run.stage + 1 : null, reachedWave: run.stage + 1, kills: run.stats.kills,
    casts: result.casts.length, spellLevel: run.spellLevel, hp: run.hp, maxHp: run.maxHp, bestChain: run.stats.bestChain,
    completedSheets: run.stats.sheets, rescue: rescueState(run), inventory: [...run.inventory],
    relicLevels: { ...run.relicLevels }, tiers: { ...run.tier }, skillLevels: { ...run.skillLevels } };
  result.summary = summarize(result.battles, result.casts);
  result.summary.fullInventoryMenus = result.rewards.filter(reward => reward.fullInventory).length;
  result.summary.forcedReplacementMenus = result.rewards.filter(reward => reward.forcedReplacementMenu).length;
  result.summary.itemsGrantedInCasts = result.casts.reduce((sum, cast) => sum + (cast.grantedItems ?? 0), 0);
  result.summary.itemsConsumed = result.casts.reduce((sum, cast) => sum + (cast.usedItems ?? 0), 0);
  result.summary.itemsGrantedInRewards = result.rewards.reduce((sum, reward) => sum + (reward.rescueBefore.items === null ? 0 : reward.rescueAfter.items - reward.rescueBefore.items), 0);
  result.summary.itemsGrantedTotal = result.summary.itemsGrantedInCasts + result.summary.itemsGrantedInRewards;
  if (run.rescueItems !== undefined && (run.rescueItems + result.summary.itemsConsumed !== run.rescueMilestones || result.summary.itemsGrantedTotal !== run.rescueMilestones)) throw new Error('Total finite item accounting mismatch');
  result.windows = Object.fromEntries([[1, 50], [51, 100], [101, 150], [151, 200]].map(([from, to]) => [`${from}-${to}`, summarize(result.battles.filter(battle => battle.wave >= from && battle.wave <= to), result.casts.filter(cast => cast.wave >= from && cast.wave <= to))]));
  const parsed = e.parseSave(JSON.stringify({ ...save, run }));
  if (JSON.stringify(rescueState(parsed.run)) !== JSON.stringify(rescueState(run))) throw new Error('Save roundtrip changed finite item state');
  result.saveRoundTripValidated = true;
  samples.push(result); persist();
  console.log(JSON.stringify({ completed: { character, seed, mode, ...result.final,
    summary: { noTargetCasts: result.summary.noTargetCasts, rescues: result.summary.rescues, itemsGranted: result.summary.itemsGrantedInCasts,
      received: result.summary.received, forcedReplacementMenus: result.summary.forcedReplacementMenus }, seconds: Math.round(elapsed()) } }));
}
persist();
console.log(JSON.stringify({ output, samples: samples.length, elapsedSeconds: Math.round(elapsed()) }));
