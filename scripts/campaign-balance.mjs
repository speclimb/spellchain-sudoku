/** Reproducible campaign balance evidence, not an optimal solver or human playtest.
 * SEEDS=107,108 CHARACTERS=fuse,scribe,lumen POLICIES=balanced,defense
 * ROOT_BUDGET=4 OUTPUT=.runtime/campaign-balance.json node scripts/campaign-balance.mjs
 * START_STATE replays an organically saved boss checkpoint; it is labeled separately.
 * OVERRIDES is a JSON map of exported numeric enemy constants, for test-only tuning.
 * NORMAL_BEFORE_FINAL=1 restricts waves 1–99 to normal casts.
 * AUTOPLAY_BEFORE_FINAL=1 uses the production autoplay selector on waves 1–99.
 * AUTOPLAY_RESCUE_IF_SHORT=1 adds a manual bookmark only when the autoplay preview stalls.
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = process.cwd(), began = performance.now();
const output = resolve(process.env.OUTPUT ?? '.runtime/campaign-balance.json');
const rootBudget = Number(process.env.ROOT_BUDGET ?? 4);
const seeds = (process.env.SEEDS ?? '107,108').split(',').map(Number);
const characters = (process.env.CHARACTERS ?? 'fuse,scribe,lumen').split(',');
const policies = (process.env.POLICIES ?? 'balanced,defense').split(',');
const overrides = JSON.parse(process.env.OVERRIDES ?? '{}');
const castLimit = Number(process.env.CAST_LIMIT ?? 600);
const timeLimit = Number(process.env.TIME_LIMIT_SECONDS ?? 1200);
const mode = process.env.MODE ?? 'campaign';
const longestRoot = process.env.LONGEST_ROOT !== '0';
const normalBeforeFinal = process.env.NORMAL_BEFORE_FINAL === '1';
const autoplayBeforeFinal = process.env.AUTOPLAY_BEFORE_FINAL === '1';
const autoplayRescueIfShort = process.env.AUTOPLAY_RESCUE_IF_SHORT === '1';
const startState = process.env.START_STATE;
for (const value of [rootBudget, castLimit, timeLimit]) if (!(value > 0)) throw new Error('Budgets must be positive');
mkdirSync('.runtime', { recursive: true });
const sourceHashes = Object.fromEntries(readdirSync('src/game').filter(file => /\.(ts|json)$/.test(file)).map(file => [file, createHash('sha256').update(readFileSync(`src/game/${file}`)).digest('hex')]));
const bundle = resolve(`.runtime/campaign-balance-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * from './src/game/engine.ts'; export * from './src/game/growth.ts'; export * from './src/game/enemies.ts'; export * from './src/game/relic-slots.ts'; export * from './src/game/fusions.ts'; export * from './src/game/autoplay.ts';`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
  plugins: [{ name: 'explicit-balance-overrides', setup(builder) {
    builder.onLoad({ filter: /[\\/]enemies\.ts$/ }, args => {
      let contents = readFileSync(args.path, 'utf8').replaceAll('\r\n', '\n');
      for (const [name, value] of Object.entries(overrides)) {
        if (!/^[A-Z_]+$/.test(name) || typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid numeric override');
        const pattern = new RegExp(`(export const ${name} = )[^;]+;`);
        if (!pattern.test(contents)) throw new Error(`Unknown constant ${name}`);
        contents = contents.replace(pattern, `$1${value};`);
      }
      return { contents, loader: 'ts' };
    });
  } }],
});
const e = await import(pathToFileURL(bundle).href);
const preferences = {
  attack: ['wick', 'trinity', 'glass', 'pen', 'rekindle', 'amplifier', 'quint', 'lens', 'ward', 'battery', 'echo', 'stroke', 'duality', 'sept', 'afterglow', 'gold'],
  defense: ['wick', 'ward', 'duality', 'gold', 'pen', 'rekindle', 'battery', 'quint', 'amplifier', 'trinity', 'glass', 'echo', 'lens', 'stroke', 'sept', 'afterglow'],
  skill: ['wick', 'amplifier', 'quint', 'battery', 'pen', 'afterglow', 'rekindle', 'ward', 'trinity', 'glass', 'lens', 'echo', 'duality', 'stroke', 'sept', 'gold'],
  balanced: ['wick', 'ward', 'amplifier', 'quint', 'battery', 'pen', 'rekindle', 'duality', 'afterglow', 'trinity', 'glass', 'lens', 'echo', 'stroke', 'sept', 'gold'],
  history: ['wick', 'glass', 'pen', 'ward', 'trinity', 'duality', 'lens', 'amplifier', 'rekindle', 'quint', 'battery', 'afterglow', 'echo', 'stroke', 'sept', 'gold'],
};
for (const policy of policies) if (!preferences[policy]) throw new Error(`Unknown policy ${policy}`);
const elapsed = () => (performance.now() - began) / 1000;
const samples = [];
const method = {
  kind: startState ? 'natural-checkpoint-replay' : 'organic-initial-state', mode, sourceHashes, overrides, rootBudget, longestRoot, normalBeforeFinal, autoplayBeforeFinal, autoplayRescueIfShort, seeds, characters, policies, castLimit, timeLimit,
  bundle: { path: bundle, sha256: createHash('sha256').update(readFileSync(bundle)).digest('hex') },
  startState: startState ? { path: startState, sha256: createHash('sha256').update(readFileSync(startState)).digest('hex') } : null,
  selection: `At most ${rootBudget} legal roots per available skill, ${longestRoot ? 'including a longest-path normal-cast root and each skill longest-path root at stage100, ' : ''}weak and shield marks then evenly spaced. Guaranteed kill first, then capped guaranteed damage minus worst-case incoming damage times a policy weight (attack 10, defense 30, skill 15, balanced/history 20). No random outcome, future reward, or damageMax lookup. Rescue requested on bosses only when stock exists. First eligible fusion is taken once per boss relic step; history restricts recipes to prism-spear and twin-covenant. Balanced/history policies replace non-target unfused relics to aim for their eight priorities; other policies retain a full inventory. History is a build preference inspired by the exported player run, not an exact historical action replay. NORMAL_BEFORE_FINAL restricts waves 1–99 to normal casts when enabled; AUTOPLAY_BEFORE_FINAL uses the production longest-chain then guaranteed-damage selector and spends no rescue items before final by default. The separate AUTOPLAY_RESCUE_IF_SHORT flag allows a manual bookmark when stock exists and the autoplay preview stops at no-target without defeating the enemy.`,
  progression: 'Every run begins with normal level/HP/resources and only meta character/relic unlocks. Every growth, reward, evolution and fusion uses the production reducer. Checkpoints are written before the first stage100 action. START_STATE preserves those attained stats and refreshes only enemy HP from current fixed constants.',
  limits: 'Limited greedy roots and explicit build preferences are not optimal or representative human play. Seed-specific survival and cast counts are evidence for calibration, not guaranteed difficulty. Failure and all censoring reasons remain visible.',
  runtime: process.version,
};
function persist() { writeFileSync(output, JSON.stringify({ method, elapsedSeconds: elapsed(), samples }, null, 2)); }
function preference(policy, id) { const i = preferences[policy].indexOf(id); return i < 0 ? 99 : i; }
function rewardValue(run, id, policy) {
  if (id === 'recovery') return run.hp < run.maxHp * .45 ? 2000 : 0;
  if (id === 'wick' && !run.inventory.includes('wick')) return 1800;
  if (id === 'greater:wick') return 1900;
  if (id.startsWith('skill:')) {
    const skill = id.slice(6), target = policy === 'defense' ? 'bastion' : run.character;
    return skill === target ? 1500 - e.skillLevel(run, skill) : skill === run.character ? 1400 : skill === 'bridge' ? 1300 : 900;
  }
  if (id === 'defense-boon') return policy === 'defense' && !run.boons.defense ? 950 : 450;
  if (id === 'magic-boon') return policy !== 'defense' && !run.boons.magic ? 950 : 450;
  if (id === 'training') return 550;
  if (id === 'vitality') return run.hp < run.maxHp * .7 ? 560 : 500;
  const base = id.replace(/^(greater:|apex:)/, '');
  if (id.startsWith('greater:') || id.startsWith('apex:')) return 1300 - preference(policy, base) * 15;
  if (run.inventory.includes(base)) return 1000 - preference(policy, base) * 15 - e.relicLevel(run, base) * 5;
  if (run.inventory.length >= e.RELIC_CAPACITY) {
    const worst = Math.max(...run.inventory.filter(id => !e.fusionForRelic(run, id)).map(id => preference(policy, id)));
    return ['balanced', 'history'].includes(policy) && preference(policy, base) < worst && preference(policy, base) < 8 ? 1150 - preference(policy, base) * 20 : 100 - preference(policy, base);
  }
  return 1100 - preference(policy, base) * 35;
}
function roots(run, skillId, useRescue) {
  const legal = e.legalOrigins(run, !!skillId, skillId), chosen = [];
  const add = cell => { if (cell !== undefined && !chosen.includes(cell) && chosen.length < rootBudget) chosen.push(cell); };
  if (longestRoot && (!skillId || run.stage === 99)) add(e.longestOrigins(run, !!skillId, skillId, useRescue).cells[0]);
  add(legal.find(cell => run.marks[cell] === 'weak'));
  add(legal.find(cell => run.marks[cell] === 'shield'));
  for (let i = 0; i < rootBudget; i++) add(legal[Math.floor(i * (legal.length - 1) / Math.max(1, rootBudget - 1))]);
  for (const cell of legal) add(cell);
  return chosen;
}
function bestAction(run, policy) {
  if (autoplayBeforeFinal && run.stage < 99) {
    const selected = e.selectAutoplayOrigin(run);
    if (!selected) throw new Error('Autoplay found no legal action');
    if (autoplayRescueIfShort && (run.rescueItems ?? 0) > 0 && selected.preview.chain.stopReason === 'no-target' && !selected.preview.defeated) {
      let rescued;
      for (const cell of e.longestOrigins(run, false, undefined, true).cells) {
        const preview = e.previewAction(run, cell, false, undefined, true);
        if (!rescued || preview.guaranteedDamage > rescued.preview.guaranteedDamage) rescued = { cell, preview };
      }
      if (rescued) return { type: 'play', cell: rescued.cell, skill: false, useRescue: true, revision: run.revision };
    }
    return { type: 'play', cell: selected.cell, skill: false, useRescue: false, revision: run.revision };
  }
  let action, best = -Infinity;
  const useRescue = (run.rescueItems ?? 0) > 0 && e.enemyForRun(run).isBoss;
  const skills = e.canUseSkill(run) && !(normalBeforeFinal && run.stage < 99) ? [undefined, run.character, ...run.equippedSkills] : [undefined];
  for (const skillId of [...new Set(skills)]) for (const cell of roots(run, skillId, useRescue)) {
    const p = e.previewAction(run, cell, !!skillId, skillId, useRescue);
    const value = (p.defeated ? 1e15 : 0) + Math.min(run.enemyHp, p.damage) - p.received * ({ attack: 10, defense: 30, skill: 15, balanced: 20, history: 20 }[policy]) + (p.fullClear ? 5 : 0) - (skillId ? .001 : 0);
    if (value > best) { best = value; action = { type: 'play', cell, skill: !!skillId, skillId, useRescue, revision: run.revision }; }
  }
  if (!action) throw new Error('No legal action');
  return action;
}
function stats(run) {
  return { wave: run.stage + 1, phase: run.phase, mode: run.mode, progressionVersion: run.progressionVersion ?? null,
    relicMaxLevel: e.relicMaxLevel(run), fusionLevelRequirement: e.fusionLevelRequirement(run), level: run.spellLevel, hp: run.hp, maxHp: run.maxHp, enemyHp: run.enemyHp,
    skills: { ...run.skillLevels }, relics: { ...run.relicLevels }, tiers: { ...run.tier }, inventory: [...run.inventory], fusions: run.fusions ?? [],
    matureRelics: run.inventory.filter(id => e.relicLevel(run, id) >= e.fusionLevelRequirement(run) && e.relicTierLevel(run, id) === 3), rescueItems: run.rescueItems };
}
const total = (values, key) => values.reduce((sum, value) => sum + (value[key] ?? 0), 0);
const median = values => { const ordered = [...values].filter(Number.isFinite).sort((a, b) => a - b); return ordered.length ? (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2 : null; };
function battleSummary(battles) {
  const wins = battles.filter(battle => battle.won), completed = battles.filter(battle => !battle.unfinished);
  return { attempted: battles.length, completed: completed.length, wins: wins.length, losses: battles.filter(battle => battle.lost).length,
    casts: total(battles, 'casts'), meanCasts: completed.length ? total(completed, 'casts') / completed.length : null,
    medianCasts: median(completed.map(battle => battle.casts)), oneCastWins: wins.filter(battle => battle.casts === 1).length,
    oneCastWinRate: wins.length ? wins.filter(battle => battle.casts === 1).length / wins.length : null,
    received: total(battles, 'received'), zeroReceivedBattles: completed.filter(battle => battle.received === 0).length,
    healed: total(battles, 'healed'), meanHpAfterRatio: completed.length ? total(completed, 'hpRatioAfter') / completed.length : null,
    minHpAfterRatio: completed.length ? Math.min(...completed.map(battle => battle.hpRatioAfter)) : null,
    damage: total(battles, 'damage'), hpDamage: total(battles, 'hpDamage'), overkill: total(battles, 'overkill'),
    overkillShare: total(battles, 'damage') ? total(battles, 'overkill') / total(battles, 'damage') : null,
    medianDamageToEnemyHp: median(completed.map(battle => battle.damage / battle.enemyHp)),
    medianFirstCastDamage: median(battles.map(battle => battle.firstCastDamage)), medianEnemyHp: median(battles.map(battle => battle.enemyHp)) };
}
outer: for (const character of characters) for (const seed of seeds) for (const policy of policies) {
  if (elapsed() >= timeLimit) { method.timeLimitReachedBeforeAllSamples = true; break outer; }
  const save = e.newSave(); save.meta.clears = 99;
  let run = startState ? JSON.parse(readFileSync(startState, 'utf8')) : e.startRun(save, character, seed, mode).run;
  if (startState) run.enemyHp = e.enemyForRun(run).hp;
  const result = { character: run.character, seed: run.seed, policy, start: stats(run), checkpoints: [], rewards: [], casts: [], battles: [] };
  let battle, termination;
  while (['battle', 'reward'].includes(run.phase)) {
    if (elapsed() >= timeLimit) { termination = 'time-limit'; break; }
    if (result.casts.length >= castLimit) { termination = 'cast-limit'; break; }
    if (run.phase === 'reward') {
      if (run.stage >= 99) { termination = 'stage-limit'; break; }
      const fusion = e.availableFusions(run).find(candidate => policy !== 'history' || ['prism-spear', 'twin-covenant'].includes(candidate.id));
      if (fusion) {
        result.rewards.push({ wave: run.stage + 1, step: 'fusion', selected: fusion.id });
        run = e.resolveAction(run, { type: 'fuse', fusion: fusion.id, revision: run.revision });
        continue;
      }
      const selected = [...run.rewards].sort((a, b) => rewardValue(run, b, policy) - rewardValue(run, a, policy))[0];
      const replace = e.needsRelicReplacement(run, selected) ? run.inventory.filter(id => !e.fusionForRelic(run, id)).sort((a, b) => preference(policy, b) - preference(policy, a))[0] : undefined;
      const rewardRelic = e.rewardRelicId(run, selected);
      const rewardRecord = { wave: run.stage + 1, step: run.rewardStep, choices: [...run.rewards], selected, replace: replace ?? null,
        ...(rewardRelic ? { relic: rewardRelic, levelBefore: e.relicLevel(run, rewardRelic), tierBefore: e.relicTierLevel(run, rewardRelic) } : {}) };
      run = e.resolveAction(run, { type: 'reward', relic: selected, replace, revision: run.revision });
      result.rewards.push({ ...rewardRecord, ...(rewardRelic ? { levelAfter: e.relicLevel(run, rewardRelic), tierAfter: e.relicTierLevel(run, rewardRelic) } : {}) });
      continue;
    }
    if (!battle) {
      battle = { wave: run.stage + 1, boss: e.enemyForRun(run).isBoss, hpBefore: run.hp, maxHpBefore: run.maxHp, enemyHp: run.enemyHp,
        levelBefore: run.spellLevel, fusionCount: run.fusions?.length ?? 0, matureRelicCount: stats(run).matureRelics.length,
        casts: 0, damage: 0, hpDamage: 0, overkill: 0, received: 0, healed: 0 };
      if ([25, 50, 75, 95, 100].includes(run.stage + 1)) result.checkpoints.push(stats(run));
      if (run.stage === 99 && !startState) {
        const checkpointText = JSON.stringify(run);
        result.bossCheckpointSha256 = createHash('sha256').update(checkpointText).digest('hex');
        result.bossCheckpoint = `.runtime/campaign-checkpoint-${character}-${seed}-${policy}-${result.bossCheckpointSha256.slice(0, 12)}.json`;
        writeFileSync(result.bossCheckpoint, checkpointText);
      }
    }
    const action = bestAction(run, policy);
    run = e.resolveAction(run, action);
    const report = run.lastReport, granted = report.chain.initialAuto + report.chain.steps.reduce((sum, step) => sum + step.addedAuto, 0);
    const cast = { wave: run.stage + 1, chain: report.path.length, capacity: report.chain.initialAuto, granted, fuelSpent: granted - report.chain.remainingAuto,
      fuelUseRate: granted ? (granted - report.chain.remainingAuto) / granted : null, stop: report.chain.stopReason,
      damage: report.damage, hpDamage: report.ledger?.hpDamage ?? Math.min(report.damage, report.enemyBefore),
      overkill: report.ledger?.overkill ?? Math.max(0, report.damage - report.enemyBefore),
      received: report.received, healed: report.healed, incoming: report.incoming, shield: report.shield, hp: run.hp, maxHp: run.maxHp,
      skill: action.skillId ?? null, rescue: action.useRescue, level: run.spellLevel, defeated: report.defeated };
    result.casts.push(cast); battle.firstCastDamage ??= cast.damage; battle.casts++; battle.damage += cast.damage;
    battle.hpDamage += cast.hpDamage; battle.overkill += cast.overkill; battle.received += report.received; battle.healed += report.healed;
    if (report.defeated || run.phase === 'lost') { result.battles.push({ ...battle, hpAfter: run.hp, maxHpAfter: run.maxHp, hpRatioAfter: run.hp / run.maxHp, won: report.defeated, lost: run.phase === 'lost' }); battle = null; }
    if (result.casts.length % 40 === 0) console.log(JSON.stringify({ progress: { character, seed, policy, wave: run.stage + 1, casts: result.casts.length, elapsed: Math.round(elapsed()) } }));
  }
  if (battle) result.battles.push({ ...battle, unfinished: true });
  result.final = { ...stats(run), termination: termination ?? run.phase, kills: run.stats.kills, casts: result.casts.length };
  const bossCasts = result.casts.filter(cast => cast.wave === 100), sum = (key) => bossCasts.reduce((total, cast) => total + cast[key], 0);
  result.boss = bossCasts.length ? { casts: bossCasts.length, won: bossCasts.at(-1).defeated, damage: sum('damage'), received: sum('received'), fuelUseRate: sum('granted') ? sum('fuelSpent') / sum('granted') : null, meanChain: sum('chain') / bossCasts.length, hpAfter: run.hp, maxHpAfter: run.maxHp } : null;
  result.path = battleSummary(result.battles.filter(battle => battle.wave < 100));
  result.stageBands = Object.fromEntries([[1, 10], [11, 25], [26, 50], [51, 75], [76, 99]].map(([from, to]) => {
    const inBand = result.battles.filter(battle => battle.wave >= from && battle.wave <= to);
    return [`${from}-${to}`, { ordinary: battleSummary(inBand.filter(battle => !battle.boss)), boss: battleSummary(inBand.filter(battle => battle.boss)) }];
  }));
  result.fusionSummary = { count: run.fusions?.length ?? 0, timeline: result.rewards.filter(reward => reward.step === 'fusion').map(reward => ({ wave: reward.wave, fusion: reward.selected })),
    matureRelicsAt100: result.checkpoints.find(checkpoint => checkpoint.wave === 100)?.matureRelics.length ?? null,
    firstMatureRelicWave: startState ? null : result.battles.find(battle => battle.matureRelicCount > 0)?.wave ?? null };
  result.progressionSummary = { progressionVersion: run.progressionVersion ?? null, relicMaxLevel: e.relicMaxLevel(run), fusionLevelRequirement: e.fusionLevelRequirement(run),
    ordinaryEvolutions: result.rewards.filter(reward => reward.wave % 5 !== 0 && /^(greater:|apex:)/.test(reward.selected)).map(reward => ({ wave: reward.wave, selected: reward.selected })),
    relicGrowth: result.rewards.filter(reward => reward.relic !== undefined).map(({ wave, relic, selected, levelBefore, levelAfter, tierBefore, tierAfter }) => ({ wave, relic, selected, levelBefore, levelAfter, tierBefore, tierAfter })) };
  samples.push(result); persist(); console.log(JSON.stringify({ result: { character: run.character, seed: run.seed, policy, final: result.final, boss: result.boss } }));
}
persist();
console.log(JSON.stringify({ output, samples: samples.length, elapsedSeconds: elapsed() }));
