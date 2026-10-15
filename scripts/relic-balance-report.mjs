/** Compare organic reward policies against the fixed, pre-adjustment release.
 * node scripts/relic-balance-report.mjs --quick
 * node scripts/relic-balance-report.mjs --seeds=102,103,104 --encounters=20
 * No hidden prime outcomes are inspected. Encounter/move caps are censored runs,
 * never reported as wins or losses. Snapshots are synthetic and separate.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE = '6c10611';
const WORK = join(ROOT, '.runtime', 'relic-balance');
const policies = [
  { id: 'chain', name: '連鎖', skills: ['bridge', 'pierce', 'bastion'], relics: ['wick', 'echo', 'rekindle', 'sept', 'afterglow', 'battery', 'amplifier', 'ward', 'pen', 'quint', 'stroke', 'trinity', 'lens', 'duality', 'glass', 'gold'] },
  { id: 'completion', name: '完成', skills: ['bridge', 'bastion', 'pierce'], relics: ['pen', 'stroke', 'ward', 'gold', 'rekindle', 'wick', 'echo', 'amplifier', 'trinity', 'battery', 'afterglow', 'duality', 'quint', 'sept', 'lens', 'glass'] },
  { id: 'mana', name: '魔力', skills: ['pierce', 'bridge', 'bastion'], relics: ['battery', 'quint', 'amplifier', 'afterglow', 'glass', 'wick', 'trinity', 'lens', 'echo', 'stroke', 'rekindle', 'sept', 'pen', 'duality', 'ward', 'gold'] },
  { id: 'guard', name: '守護', skills: ['bastion', 'bridge', 'pierce'], relics: ['ward', 'duality', 'gold', 'pen', 'stroke', 'wick', 'battery', 'quint', 'rekindle', 'echo', 'sept', 'lens', 'amplifier', 'afterglow', 'trinity', 'glass'] },
  { id: 'balanced', name: '均衡', skills: ['bridge', 'bastion', 'pierce'], relics: ['wick', 'ward', 'pen', 'battery', 'lens', 'stroke', 'quint', 'gold', 'amplifier', 'duality', 'echo', 'rekindle', 'trinity', 'afterglow', 'sept', 'glass'] },
];
const args = new Map(process.argv.slice(2).map(arg => {
  if (arg === '--quick') return ['quick', 'true'];
  const match = /^--(seeds|characters|policies|versions|encounters|moves|output|snapshots)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  return [match[1], match[2]];
}));
const quick = args.has('quick');
const seeds = (args.get('seeds') ?? (quick ? '102' : '102,103,104')).split(',').map(Number);
const characters = (args.get('characters') ?? (quick ? 'fuse' : 'fuse,scribe,lumen')).split(',');
const policyIds = (args.get('policies') ?? (quick ? 'chain,guard' : policies.map(policy => policy.id).join(','))).split(',');
const versions = (args.get('versions') ?? 'baseline,candidate').split(',');
const encounterCap = Number(args.get('encounters') ?? (quick ? 5 : 20));
const moveCap = Number(args.get('moves') ?? 300);
const snapshots = args.get('snapshots') !== 'false';
const output = resolve(ROOT, args.get('output') ?? (quick ? '.runtime/relic-balance/smoke.json' : '.runtime/relic-balance/report.json'));
const distinct = values => new Set(values).size === values.length;
if (!distinct(seeds) || seeds.some(seed => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) throw new Error('Invalid seeds.');
if (!distinct(characters) || characters.some(id => !['fuse', 'scribe', 'lumen'].includes(id))) throw new Error('Invalid characters.');
if (!distinct(policyIds) || policyIds.some(id => !policies.some(policy => policy.id === id))) throw new Error('Invalid policies.');
if (!distinct(versions) || versions.some(id => !['baseline', 'candidate'].includes(id))) throw new Error('Invalid versions.');
if (!Number.isInteger(encounterCap) || encounterCap < 1 || encounterCap > 100 || !Number.isInteger(moveCap) || moveCap < 1 || moveCap > 2000) throw new Error('Invalid observation cap.');
if (args.has('snapshots') && !['true', 'false'].includes(args.get('snapshots'))) throw new Error('snapshots must be true or false.');
const selectedPolicies = policies.filter(policy => policyIds.includes(policy.id));
mkdirSync(WORK, { recursive: true });

function git(...arguments_) {
  return execFileSync('git', arguments_, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
}
const baselineCommit = git('rev-parse', `${BASELINE}^{commit}`).toString().trim();
const baselineRoot = join(WORK, `baseline-${baselineCommit}`);
function exportBaseline() {
  const files = git('ls-tree', '-r', '--name-only', baselineCommit, '--', 'src/game').toString().trim().split(/\r?\n/);
  for (const file of files) {
    const target = join(baselineRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, git('show', `${baselineCommit}:${file}`));
  }
}
function sourceDigest(root) {
  const hash = createHash('sha256');
  const walk = path => readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach(entry => {
    const target = join(path, entry.name);
    if (entry.isDirectory()) walk(target);
    else { hash.update(target.slice(root.length).replaceAll('\\', '/')); hash.update(readFileSync(target)); }
  });
  walk(join(root, 'src', 'game'));
  return hash.digest('hex');
}
async function loadApi(version) {
  const root = version === 'baseline' ? baselineRoot : ROOT;
  const namespaces = ['engine', 'growth', 'content', 'enemies', 'rewards', 'storage'];
  if (existsSync(join(root, 'src/game/relic-slots.ts'))) namespaces.push('relic-slots');
  const entry = namespaces.map(name => `export * as ${name.replace('-', '_')} from ${JSON.stringify(join(root, 'src/game', `${name}.ts`).replaceAll('\\', '/'))};`).join('\n');
  const path = join(WORK, `${version}-runtime.mjs`);
  const sourceSha256 = sourceDigest(root);
  await build({ stdin: { contents: entry, loader: 'ts', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile: path, logLevel: 'silent' });
  return { ...await import(`${pathToFileURL(path).href}?${sourceSha256}`), version, sourceSha256 };
}

function freshRun(api, character, seed) {
  const save = api.engine.newSave();
  save.meta.clears = 99;
  return { save, run: api.engine.startRun(save, character, seed).run };
}
function slotsFor(api, run) {
  if (run.relicBalanceVersion !== 1) return Infinity;
  return api.relic_slots?.RELIC_CAPACITY ?? 8;
}
const relicId = id => id.startsWith('greater:') ? id.slice(8) : id.startsWith('apex:') ? id.slice(5) : id;

function bestPlay(api, run) {
  let best;
  const skills = api.engine.canUseSkill(run) ? [undefined, run.character, ...(run.equippedSkills ?? [])] : [undefined];
  for (const skillId of skills) for (const cell of api.engine.legalOrigins(run, !!skillId, skillId)) {
    const forecast = api.engine.previewAction(run, cell, !!skillId, skillId);
    // Only guaranteed forecast and worst-case received damage are available to the policy.
    const value = (forecast.defeated ? 1e9 : 0) + Math.min(run.enemyHp, forecast.damage) - forecast.received * 15 + (forecast.fullClear ? 5 : 0) - (skillId ? .001 : 0);
    if (!best || value > best.value) best = { value, forecast, action: { type: 'play', cell, skill: !!skillId, skillId, revision: run.revision } };
  }
  if (!best) throw new Error(`No legal action: ${api.version}/${run.seed}/${run.stage}`);
  return best;
}
function equipSkills(api, run, policy) {
  const skills = policy.skills.filter(id => api.growth.skillLevel(run, id) > 0).slice(0, api.growth.MAX_EQUIPPED_SKILLS);
  return JSON.stringify(skills) === JSON.stringify(run.equippedSkills ?? []) ? run : api.engine.resolveAction(run, { type: 'equip', skills, revision: run.revision });
}
function chooseReward(api, run, policy) {
  const rank = id => policy.relics.indexOf(id);
  const weakest = [...run.inventory].sort((a, b) => rank(b) - rank(a))[0];
  const limit = slotsFor(api, run);
  const choices = run.rewards.map(id => {
    let value = -Infinity, replace;
    if (id.startsWith('skill:')) {
      const skill = id.slice(6), level = api.growth.skillLevel(run, skill);
      const preference = skill === run.character ? 1 : policy.skills.indexOf(skill);
      value = 900 - preference * 35 - level * 12 + Number(level === 4 || level === 9) * 20;
    } else if (id === 'recovery') value = run.hp < run.maxHp * .55 ? 1100 : 0;
    else if (id === 'vitality') value = run.hp < run.maxHp * .4 ? 1050 : 90;
    else if (id === 'training') value = run.hp < run.maxHp * .25 ? 1000 : 120;
    else if (id === 'defense-boon') value = 220;
    else if (id === 'magic-boon') value = 200;
    else if (id === 'skill-upgrade') value = 900;
    else {
      const relic = relicId(id);
      if (!policy.relics.includes(relic)) throw new Error(`Unranked reward ${id}`);
      const owned = run.inventory.includes(relic), level = api.growth.relicLevel(run, relic);
      if (!owned && run.inventory.length >= limit) {
        if (rank(relic) >= rank(weakest)) return { id, value, replace };
        if (!api.relic_slots?.needsRelicReplacement(run, id)) throw new Error('Policy and reducer disagree about relic slots.');
        replace = weakest;
      }
      value = 600 - rank(relic) * 15 + (owned ? 35 - level * 8 : run.inventory.length < limit ? 80 : 0);
      if (id.startsWith('greater:') || id.startsWith('apex:')) value += 80 + level * 5;
      if (!owned && run.stowedRelics?.[relic]) value += run.stowedRelics[relic].level * 4;
    }
    return { id, value, replace };
  }).sort((a, b) => b.value - a.value);
  if (!Number.isFinite(choices[0]?.value)) throw new Error(`No acceptable reward: ${api.version}/${policy.id}/${run.rewards.join(',')}`);
  const best = choices[0];
  return { type: 'reward', relic: best.id, revision: run.revision, ...(best.replace ? { replace: best.replace } : {}) };
}
function metricTotals(target, ledger) {
  for (const [id, metric] of Object.entries(ledger?.relics ?? {})) {
    target[id] ??= {};
    for (const [key, value] of Object.entries(metric)) if (typeof value === 'number') target[id][key] = (target[id][key] ?? 0) + value;
  }
}
function simulate(api, policy, character, seed) {
  const began = performance.now();
  const initial = freshRun(api, character, seed);
  let run = initial.run, outcome;
  const rewards = [], casts = [], relicMetrics = {};
  while (run.phase === 'battle' || run.phase === 'reward') {
    if (run.phase === 'battle' && run.stats.kills >= encounterCap) { outcome = 'encounter-cap'; break; }
    if (run.phase === 'battle' && run.stats.moves >= moveCap) { outcome = 'move-cap'; break; }
    if (run.phase === 'reward') {
      run = equipSkills(api, run, policy);
      const before = run, action = chooseReward(api, run, policy);
      run = api.engine.resolveAction(run, action);
      rewards.push({ encounter: before.stage + 1, step: before.rewardStep, offers: [...before.rewards], selected: action.relic, replaced: action.replace ?? null, inventory: [...run.inventory], levels: { ...run.relicLevels }, tiers: { ...run.tier } });
    } else {
      const before = run, { action } = bestPlay(api, run);
      run = api.engine.resolveAction(run, action);
      const report = run.lastReport;
      metricTotals(relicMetrics, report.ledger);
      casts.push({ encounter: before.stage + 1, cast: run.stats.moves, skill: report.skillId ?? null, chain: report.path.length, sheets: report.sheetsCompleted ?? 0, segments: report.segments?.length ?? 1, damage: report.damage, hpDamage: Math.min(before.enemyHp, report.damage), overkill: Math.max(0, report.damage - before.enemyHp), received: report.received, healed: report.healed, hpAfter: run.hp, defeated: report.defeated });
    }
    if (run.inventory.length > slotsFor(api, run)) throw new Error('Relic slot limit exceeded.');
  }
  outcome ??= run.phase === 'lost' ? 'lost' : `unexpected:${run.phase}`;
  if (outcome.startsWith('unexpected:')) throw new Error(outcome);
  try {
    api.storage.parseSave(JSON.stringify({ ...initial.save, run }));
  } catch (error) {
    const failurePath = join(WORK, `invalid-save-${api.version}-${policy.id}-${character}-${seed}.json`);
    writeFileSync(failurePath, JSON.stringify({ context: { version: api.version, policy: policy.id, character, seed, sourceSha256: api.sourceSha256 }, save: { ...initial.save, run } }, null, 2));
    throw new Error(`Save validation failed; fixture saved to ${failurePath}`, { cause: error });
  }
  return {
    version: api.version, sourceSha256: api.sourceSha256, relicBalanceVersion: run.relicBalanceVersion ?? null,
    policy: policy.id, character, seed, outcome, kills: run.stats.kills, moves: run.stats.moves,
    hp: run.hp, maxHp: run.maxHp, spellLevel: run.spellLevel, maxChain: run.stats.bestChain, score: run.score,
    hpDamage: casts.reduce((sum, cast) => sum + cast.hpDamage, 0), overkill: casts.reduce((sum, cast) => sum + cast.overkill, 0),
    received: casts.reduce((sum, cast) => sum + cast.received, 0), combatHealing: casts.reduce((sum, cast) => sum + cast.healed, 0),
    crossSheetCasts: casts.filter(cast => cast.segments > 1).length,
    skills: run.stats.skills, replacements: rewards.filter(reward => reward.replaced).length,
    finalInventory: [...run.inventory], finalLevels: { ...run.relicLevels }, finalTiers: { ...run.tier }, finalSkills: { ...run.skillLevels },
    acquiredRelics: [...new Set(rewards.map(reward => relicId(reward.selected)).filter(id => policy.relics.includes(id)))],
    relicMetrics, rewards, casts, elapsedSeconds: Number(((performance.now() - began) / 1000).toFixed(3)),
  };
}
function fixtureSnapshots(api) {
  const rows = [];
  for (const policy of selectedPolicies) for (const character of characters) for (const level of [1, 5, 10]) {
    const { run } = freshRun(api, character, 20261015);
    const tier = level === 1 ? 1 : level === 5 ? 2 : 3;
    run.inventory = policy.relics.slice(0, 8);
    run.relicLevels = Object.fromEntries(run.inventory.map(id => [id, level]));
    run.acquisitionRank = Object.fromEntries(run.inventory.map(id => [id, Math.min(3, level)]));
    run.tier = Object.fromEntries(run.inventory.map(id => [id, tier]));
    run.skillLevels = Object.fromEntries([character, ...policy.skills.slice(0, 2)].map(id => [id, level]));
    run.equippedSkills = policy.skills.slice(0, 2); run.skillRank = level > 1 ? 2 : 1;
    run.spellLevel = 20; run.stage = 19; run.stats.kills = 19;
    run.hp = 150; run.maxHp = 200; run.mana = 8;
    run.enemyHp = api.enemies.enemyForRun(run).hp;
    const { forecast, action } = bestPlay(api, run);
    rows.push({ version: api.version, policy: policy.id, character, level, tier, spellLevel: 20,
      inventory: run.inventory, values: Object.fromEntries(run.inventory.map(id => [id, api.growth.relicValues(run, id)])),
      skill: action.skillId ?? null, cell: action.cell, guaranteedDamage: forecast.damage,
      possibleDamage: forecast.forecast?.damageMax ?? forecast.damage, shield: forecast.shield,
      worstReceived: forecast.received, chain: forecast.path.length, sheets: forecast.sheetsCompleted ?? 0,
    });
  }
  return rows;
}
const average = values => Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
const sortedInventory = row => [...row.finalInventory].sort().join(',');
function summarize(results) {
  return versions.flatMap(version => selectedPolicies.map(policy => {
    const rows = results.filter(row => row.version === version && row.policy === policy.id);
    if (!rows.length) return null;
    return { version, policy: policy.id, runs: rows.length, averageKills: average(rows.map(row => row.kills)), averageMoves: average(rows.map(row => row.moves)), lost: rows.filter(row => row.outcome === 'lost').length,
      encounterCaps: rows.filter(row => row.outcome === 'encounter-cap').length, moveCaps: rows.filter(row => row.outcome === 'move-cap').length,
      averageReceived: average(rows.map(row => row.received)), averageInventory: average(rows.map(row => row.finalInventory.length)),
      distinctFinalInventories: new Set(rows.map(sortedInventory)).size,
      averageReplacements: average(rows.map(row => row.replacements)),
    };
  }).filter(Boolean));
}
function paired(results) {
  return results.filter(row => row.version === 'candidate').flatMap(candidate => {
    const baseline = results.find(row => row.version === 'baseline' && row.policy === candidate.policy && row.character === candidate.character && row.seed === candidate.seed);
    if (!baseline) return [];
    const commonKills = Math.min(baseline.kills, candidate.kills);
    const common = row => row.casts.filter(cast => cast.encounter <= commonKills);
    const a = common(baseline), b = common(candidate);
    return [{ policy: candidate.policy, character: candidate.character, seed: candidate.seed, commonKills,
      baselineOutcome: baseline.outcome, candidateOutcome: candidate.outcome,
      baselineMoves: a.length, candidateMoves: b.length,
      baselineReceived: a.reduce((sum, cast) => sum + cast.received, 0), candidateReceived: b.reduce((sum, cast) => sum + cast.received, 0),
      baselineOverkill: a.reduce((sum, cast) => sum + cast.overkill, 0), candidateOverkill: b.reduce((sum, cast) => sum + cast.overkill, 0),
    }];
  });
}

exportBaseline();
const began = performance.now(), results = [], snapshotResults = [], sourceHashes = {};
const report = complete => ({
  baselineCommit, complete, runtime: process.version, sourceHashes,
  method: 'Organic real-reducer runs from empty inventories. Policies alter reward priorities and extra-skill equipment. No future random proc is read. Existing and new slots follow their own versioned rules.',
  actionPolicy: 'Guaranteed kill, then min(enemy HP, guaranteed damage) - 15 * worst received + 5 for sheet completion. Ties prefer normal input, then earlier skill/root. Future mana, healing and proc value are not optimized.',
  rewardPolicy: 'Shared emergency healing thresholds; policy rank, current level and evolution determine the other choices. At a full candidate inventory, only a better-ranked new relic replaces the weakest rank. Each boss reward step is selected separately.',
  limits: 'Encounter-cap and move-cap are censored observations, not survival or terminal-balance claims. Paired seeds can diverge in board/reward/proc streams after different decisions. Relic ledger increments overlap and must not be summed into a damage allocation.',
  snapshotMethod: 'Synthetic fixed initial board, eight policy relics, Lv.1/5/10 and tier 1/2/3, spell Lv.20, encounter 20, all available selected skills at that same level. Best guaranteed immediate action; not organically acquired builds.',
  seeds, characters, policies: selectedPolicies, versions, encounterCap, moveCap,
  expectedRuns: seeds.length * characters.length * selectedPolicies.length * versions.length,
  elapsedSeconds: Number(((performance.now() - began) / 1000).toFixed(3)),
  summaries: summarize(results), paired: paired(results), results, snapshots: snapshotResults,
});
function persist(complete = false) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report(complete), null, 2) + '\n'); }
for (const version of versions) {
  const api = await loadApi(version);
  sourceHashes[version] = api.sourceSha256;
  for (const policy of selectedPolicies) {
    const currentIds = new Set(api.content.RELICS.map(relic => relic.id));
    if (new Set(policy.relics).size !== currentIds.size || policy.relics.some(id => !currentIds.has(id))) throw new Error(`Policy ${policy.id} does not rank the ${version} catalog.`);
    for (const character of characters) for (const seed of seeds) {
      const sample = simulate(api, policy, character, seed);
      results.push(sample); persist();
      console.log(`[${version}] ${policy.name}/${character}/${seed}: ${sample.kills} kills, ${sample.moves} casts, ${sample.outcome}, ${sample.finalInventory.length} relics, ${sample.replacements} replacements (${sample.elapsedSeconds}s)`);
    }
  }
  if (snapshots) snapshotResults.push(...fixtureSnapshots(api));
  persist();
}
persist(true);
console.table(summarize(results));
console.log(`Saved ${results.length} runs and ${snapshotResults.length} snapshots to ${output}`);
