import { CHARACTERS, RELICS } from './content';
import { HISTORY_LIMITS, boundHistory, historyBytes, historyCounts, type PlayHistory } from './history';
import type { EffectMetric } from './types';

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const skills = ['fuse','scribe','lumen','bridge','pierce','bastion'];
const relics = new Set(RELICS.map(r => r.id));
const effects: (keyof EffectMetric)[] = ['heldCasts','opportunities','triggers','damage','addedInputs','fuelGranted','fuelUsed','mana','prevented','tokensGranted','tokensUsed','score','healed'];
const known = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
/** Invalid optional provenance is omitted, never allowed to destroy a healthy save. */
function cleanVersion(v: any, aggregate = false): void {
  if (!object(v)) return;
  for (const key of ['gameVersion', 'startedGameVersion']) if (v[key] !== undefined && !text(v[key],160)) delete v[key];
  if (aggregate) {
    if (v.gameVersions !== undefined && (!Array.isArray(v.gameVersions) || v.gameVersions.length > HISTORY_LIMITS.casts || !v.gameVersions.every((x: unknown) => text(x,160)))) {
      delete v.gameVersions; v.versionHistoryPartial = true;
    }
    if (v.versionHistoryPartial !== undefined && typeof v.versionHistoryPartial !== 'boolean') v.versionHistoryPartial = true;
  }
}
function metric(v: unknown, sparse = false): boolean {
  return object(v) && known(v, effects) && Object.values(v).every(n => integer(n)) && (sparse || effects.every(k => k === 'healed' && v[k] === undefined || integer(v[k])));
}
function ledger(v: any): boolean {
  return object(v) && integer(v.stage) && typeof v.boss === 'boolean' && (v.balanceVersion === undefined || [1,2].includes(v.balanceVersion))
    && ['casts','damage','hpDamage','overkill','score'].every(k => integer(v[k])) && v.damage === v.hpDamage + v.overkill
    && object(v.skills) && Object.entries(v.skills).every(([id,m]) => skills.includes(id) && object(m) && known(m,['uses','damage','hpDamage','overkill','level']) && integer(m.level,1,10)
      && ['uses','damage','hpDamage','overkill'].every(k => integer(m[k])) && m.damage === m.hpDamage+m.overkill && m.uses <= v.casts)
    && object(v.relics) && Object.entries(v.relics).every(([id,m]) => relics.has(id as any) && metric(m))
    && known(v,['stage','boss','balanceVersion','casts','damage','hpDamage','overkill','score','skills','relics']);
}
function cast(v: any): boolean {
  cleanVersion(v);
  return object(v) && ['id','turn','spellLevel','chain','sheetFrom','sheetTo','hpBefore','enemyBefore'].every(k => integer(v[k],1))
    && ['sheetsCompleted','damage','hpDamage','overkill','received','hpLost','incoming','shield','healed','hpAfter','enemyAfter','score','fuelBefore','fuelAfter','tokensBefore','tokensAfter'].every(k => integer(v[k]))
    && ['manaBefore','manaAfter','charged','overflowBefore','overflowAfter','overflowRestored'].every(k => integer(v[k],0,8))
    && (['rescueItemsBefore','rescueItemsAfter','rescueItemsGranted'].every(k => v[k] === undefined)
      || ['rescueItemsBefore','rescueItemsAfter','rescueItemsGranted'].every(k => integer(v[k]))
        && [0,1].includes(v.rescueItemsBefore + v.rescueItemsGranted - v.rescueItemsAfter))
    && (v.rescueRequested === undefined || typeof v.rescueRequested === 'boolean' && integer(v.rescueItemsBefore)
      && (v.rescueRequested || v.rescueItemsBefore + v.rescueItemsGranted === v.rescueItemsAfter))
    && typeof v.freeSkill === 'boolean' && (v.skillId === undefined ? v.skillLevel === undefined : skills.includes(v.skillId) && integer(v.skillLevel,1,10))
    && v.damage === v.hpDamage+v.overkill && v.hpDamage === Math.min(v.damage,v.enemyBefore) && v.overkill === Math.max(0,v.damage-v.enemyBefore)
    && (v.relicHealed === undefined || integer(v.relicHealed,0,Math.min(7,v.healed)))
    && v.enemyAfter === Math.max(0,v.enemyBefore-v.damage) && v.hpLost === Math.min(v.hpBefore+(v.relicHealed ?? 0),v.received) && v.hpAfter === v.hpBefore-v.hpLost+v.healed
    && v.sheetTo >= v.sheetFrom && (v.stopReason === undefined || ['limit','no-target','board-complete'].includes(v.stopReason))
    && Array.isArray(v.procs) && v.procs.length <= 4 && new Set(v.procs.map((p: any) => p?.id)).size === v.procs.length
    && v.procs.every((p: any) => object(p) && ['duality','trinity','quint','sept'].includes(p.id) && typeof p.triggered === 'boolean'
      && typeof p.chance === 'number' && p.chance >= 0 && p.chance <= 1 && typeof p.value === 'number' && Number.isFinite(p.value) && p.value > 0 && known(p,['id','chance','value','triggered']))
    && object(v.relics) && Object.entries(v.relics).every(([id,e]) => relics.has(id as any) && object(e) && integer(e.level,1,10) && integer(e.tier,1,3) && metric(e.metric,true) && known(e,['level','tier','metric']))
    && known(v,['gameVersion','id','turn','skillId','skillLevel','spellLevel','chain','sheetFrom','sheetTo','sheetsCompleted','damage','hpDamage','overkill','received','hpLost','incoming','shield','healed','relicHealed','hpBefore','hpAfter','enemyBefore','enemyAfter','freeSkill','score','procs','relics','fuelBefore','fuelAfter','tokensBefore','tokensAfter','manaBefore','manaAfter','charged','overflowBefore','overflowAfter','overflowRestored','rescueItemsBefore','rescueItemsAfter','rescueItemsGranted','rescueRequested','stopReason']);
}
function build(v: any, character: string): boolean {
  cleanVersion(v);
  if (!object(v) || v.version !== 1 || !['stage','cast','revision'].every(k => integer(v[k])) || !integer(v.spellLevel,1)
    || !known(v,['gameVersion','version','stage','cast','revision','spellLevel','relics','skills'])
    || !Array.isArray(v.relics) || v.relics.length > relics.size || !Array.isArray(v.skills) || v.skills.length > skills.length) return false;
  const entry = (e: any) => object(e) && text(e.name,200) && text(e.description,2000) && integer(e.level,1,10);
  return new Set(v.relics.map((e: any) => e?.id)).size === v.relics.length
    && v.relics.every((e: any) => entry(e) && relics.has(e.id) && integer(e.tier,1,3) && known(e,['id','name','level','tier','description']))
    && new Set(v.skills.map((e: any) => e?.id)).size === v.skills.length
    && v.skills.every((e: any) => entry(e) && skills.includes(e.id) && integer(e.evolution,1,3)
      && ['intrinsic','equipped','reserve'].includes(e.role) && (e.role === 'intrinsic') === (e.id === character)
      && known(e,['id','name','level','evolution','role','description']))
    && v.skills.filter((e: any) => e.role === 'intrinsic').length === 1
    && v.skills.filter((e: any) => e.role === 'equipped').length <= 2;
}
/** Optional log corruption never invalidates a healthy board or reward roll. */
export function parseHistory(value: unknown): PlayHistory | undefined {
  try {
    if (!object(value) || value.version !== 1 || !integer(value.omittedRuns) || !Array.isArray(value.runs) || value.runs.length > HISTORY_LIMITS.runs
      || (value.storageReduced !== undefined && typeof value.storageReduced !== 'boolean') || !known(value,['version','runs','omittedRuns','storageReduced'])
      || historyBytes(value as unknown as PlayHistory) > HISTORY_LIMITS.bytes * 2) return undefined;
    const keys = new Set<string>(); let previousNumber = -1;
    for (const r of value.runs) {
      cleanVersion(r, true);
      if (!object(r) || !text(r.key,120) || keys.has(r.key) || !integer(r.number) || r.number <= previousNumber || !integer(r.seed,0,0xffffffff)
        || !CHARACTERS.some(c => c.id === r.character) || !['battle','reward','won','lost','retired'].includes(r.status) || !integer(r.sinceCast)
        || typeof r.partial !== 'boolean' || !integer(r.omittedBattles) || !Array.isArray(r.battles) || r.battles.length > HISTORY_LIMITS.battles
        || !known(r,['startedGameVersion','gameVersions','versionHistoryPartial','key','number','seed','character','status','sinceCast','partial','omittedBattles','battles','build'])) return undefined;
      if (r.build !== undefined && !build(r.build, r.character)) delete r.build;
      keys.add(r.key); previousNumber = r.number;
      let stage = -1, castId = r.sinceCast;
      for (const b of r.battles) {
        cleanVersion(b, true);
        if (!object(b) || !integer(b.stage) || b.stage <= stage || !text(b.enemy,100) || typeof b.boss !== 'boolean' || !['battle','victory','lost','retired'].includes(b.status)
          || typeof b.partial !== 'boolean' || !['maxChain','received','hpLost','sheetsCompleted'].every(k => integer(b[k])) || !ledger(b.ledger)
          || b.ledger.stage !== b.stage || b.ledger.boss !== b.boss || !Array.isArray(b.casts) || b.casts.length > Math.min(HISTORY_LIMITS.casts,b.ledger.casts)
          || !Array.isArray(b.rewards) || b.rewards.length > 2 || !known(b,['gameVersions','versionHistoryPartial','stage','enemy','boss','status','partial','maxChain','received','hpLost','sheetsCompleted','ledger','casts','rewards'])) return undefined;
        stage = b.stage;
        let rewardRevision = -1;
        for (const reward of b.rewards) {
          cleanVersion(reward);
          if (!object(reward) || !integer(reward.revision,1) || reward.revision <= rewardRevision || !text(reward.id,80) || !text(reward.name,200) || !text(reward.description,2000)
            || !['legacy','skill','relic'].includes(reward.step) || !known(reward,['gameVersion','revision','id','name','description','step'])) return undefined;
          rewardRevision = reward.revision;
        }
        for (const c of b.casts) { if (!cast(c) || c.id <= castId || c.chain > b.maxChain) return undefined; castId = c.id; }
        if (b.casts.length === b.ledger.casts) {
          for (const field of ['damage','hpDamage','overkill','score'] as const) if (b.casts.reduce((sum: number,c: any) => sum+c[field],0) !== b.ledger[field]) return undefined;
          for (const field of ['received','hpLost','sheetsCompleted'] as const) if (b.casts.reduce((sum: number,c: any) => sum+c[field],0) !== b[field]) return undefined;
          if (Math.max(0,...b.casts.map((c: any) => c.chain)) !== b.maxChain) return undefined;
        }
      }
    }
    const h = value as unknown as PlayHistory;
    if (historyCounts(h).battles > HISTORY_LIMITS.battles || historyCounts(h).casts > HISTORY_LIMITS.casts) return undefined;
    boundHistory(h); return h;
  } catch { return undefined; }
}
