import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildIdentity } from '../scripts/build-identity';
import { APP_BUILD } from '../src/build-version';
import { newSave, startRun, dispatch, legalOrigins } from '../src/game/engine';
import { emptyHistory, ensureHistoryRun, trimHistoryDetails } from '../src/game/history';
import { parseSave } from '../src/game/storage';
import { parseHistory } from '../src/game/history-validation';
import { historyBuild, historyBattleDetails, historyCastDetails, playHistory } from '../src/ui/play-history';
import type { Save } from '../src/game/types';

const original = APP_BUILD.id;
afterEach(() => { APP_BUILD.id = original; });
const latest = (s: Save) => s.history!.runs.at(-1)!;
const play = (s: Save) => dispatch(s, {type:'play',cell:legalOrigins(s.run!)[0],skill:false,revision:s.run!.revision});
const fixture = () => { APP_BUILD.id = '0.1.0+aaa.release'; return startRun(newSave(),'fuse',51); };
function removeVersions(s: Save) {
  for (const r of s.history!.runs) {
    delete r.startedGameVersion; delete r.gameVersions; delete r.versionHistoryPartial;
    if(r.build) delete r.build.gameVersion;
    for(const b of r.battles) {
      delete b.gameVersions; delete b.versionHistoryPartial;
      for(const c of b.casts) delete c.gameVersion;
      for(const reward of b.rewards) delete reward.gameVersion;
    }
  }
}
describe('automatic build identity',()=>{
  it('is deterministic, source-sensitive, distinguishes dev/preview/release and follows commits',()=>{
    const root=mkdtempSync(join(tmpdir(),'spellchain-version-'));
    try {
      writeFileSync(join(root,'package.json'),'{"version":"0.1.0"}'); mkdirSync(join(root,'src')); writeFileSync(join(root,'src','a.ts'),'export const a=1;');
      const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
      git('init'); git('add','.'); git('-c','user.name=Test','-c','user.email=test@example.test','commit','-m','initial');
      const release=buildIdentity(root,'build'); expect(release.channel).toBe('release'); expect(release.commit).toMatch(/^[a-f0-9]{12}$/);
      expect(buildIdentity(root,'build')).toEqual(release); expect(buildIdentity(root,'serve').channel).toBe('dev');
      writeFileSync(join(root,'src','a.ts'),'export const a=2;'); const preview=buildIdentity(root,'build');
      expect(preview.channel).toBe('preview'); expect(preview.id).not.toBe(release.id); expect(preview.fingerprint).not.toBe(release.fingerprint);
      git('add','.'); git('-c','user.name=Test','-c','user.email=test@example.test','commit','-m','next');
      const next=buildIdentity(root,'build'); expect(next.channel).toBe('release'); expect(next.commit).not.toBe(release.commit);
      expect(next.fingerprint).toBe(preview.fingerprint);
      writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"useDefineForClassFields":false}}');
      const compilerChange=buildIdentity(root,'build'); expect(compilerChange.channel).toBe('preview'); expect(compilerChange.id).not.toBe(next.id);
    } finally { rmSync(root,{recursive:true,force:true}); }
  });
});
describe('execution version provenance',()=>{
  it('captures start, cast and frozen build versions and roundtrips without changing core state',()=>{
    const before=fixture(); const next=play(before), r=latest(next), b=r.battles[0];
    expect(r.startedGameVersion).toBe(APP_BUILD.id); expect(r.gameVersions).toEqual([APP_BUILD.id]);
    expect(b.gameVersions).toEqual([APP_BUILD.id]); expect(b.casts[0].gameVersion).toBe(APP_BUILD.id); expect(r.build!.gameVersion).toBe(APP_BUILD.id);
    expect(parseSave(JSON.stringify(next))).toEqual(next); expect(historyCastDetails(b.casts[0])).toContain(APP_BUILD.id);
  });
  it('preserves multiple versions within the same battle and keeps the true start version',()=>{
    let s=fixture(); s.run!.enemyHp=100000; s=play(s); const first=latest(s).battles[0].casts[0].gameVersion;
    APP_BUILD.id='0.1.0+bbb.release'; s=play(s); const r=latest(s), b=r.battles[0];
    expect(r.startedGameVersion).toBe(first); expect(r.gameVersions).toEqual([first,APP_BUILD.id]); expect(b.gameVersions).toEqual(r.gameVersions);
    expect(b.casts.map(c=>c.gameVersion)).toEqual([first,APP_BUILD.id]); expect(r.build!.gameVersion).toBe(APP_BUILD.id);
    expect(historyBattleDetails(b)).toContain(first!); expect(playHistory(s.history,{page:0})).toContain(APP_BUILD.id);
    trimHistoryDetails(s.history!,100); expect(b.gameVersions).toEqual([first,APP_BUILD.id]); expect(r.gameVersions).toEqual([first,APP_BUILD.id]);
  });
  it('records reward and next battle versions, then retains them on retirement',()=>{
    let s=fixture(); s.run!.enemyHp=1; s=play(s); s.run!.rewards=['wick']; APP_BUILD.id='0.1.0+reward.release';
    s=dispatch(s,{type:'reward',relic:'wick',revision:s.run!.revision}); const r=latest(s);
    expect(r.battles[0].rewards[0].gameVersion).toBe(APP_BUILD.id); expect(r.battles[1].gameVersions).toEqual([APP_BUILD.id]);
    const frozen=structuredClone(r); const next=startRun(s,'fuse',52); expect(next.history!.runs[0].build).toEqual(frozen.build);
    expect(next.history!.runs[0].gameVersions).toEqual(frozen.gameVersions);
  });
  it('does not invent old versions on load, including recovered live snapshots',()=>{
    const s=fixture(); removeVersions(s); const loaded=parseSave(JSON.stringify(s)); ensureHistoryRun(loaded);
    expect(latest(loaded).startedGameVersion).toBeUndefined(); expect(latest(loaded).build!.gameVersion).toBeUndefined();
    expect(playHistory(loaded.history,{page:0})).toContain('不明（旧記録）');
    loaded.history=emptyHistory(); expect(ensureHistoryRun(loaded)!.build!.gameVersion).toBeUndefined();
  });
  it('marks unknown earlier versions when continuing a legacy battle and never rewrites old casts',()=>{
    let s=fixture(); s.run!.enemyHp=100000; s=play(s); removeVersions(s); APP_BUILD.id='0.1.0+new.release'; s=play(s);
    const r=latest(s), b=r.battles[0]; expect(r.startedGameVersion).toBeUndefined(); expect(r.versionHistoryPartial).toBe(true); expect(b.versionHistoryPartial).toBe(true);
    expect(b.casts[0].gameVersion).toBeUndefined(); expect(b.casts[1].gameVersion).toBe(APP_BUILD.id); expect(b.gameVersions).toEqual([APP_BUILD.id]);
    expect(playHistory(s.history,{page:0})).toContain('以前のバージョンは不明'); expect(parseHistory(JSON.parse(JSON.stringify(s.history)))).toEqual(s.history);
  });
  it('discards malformed optional versions only and escapes saved version strings',()=>{
    const s=fixture(), r=latest(s); (r as any).gameVersions=[42]; (r.build as any).gameVersion=42;
    expect(parseHistory(s.history)!.runs).toHaveLength(1); expect(r.gameVersions).toBeUndefined(); expect(r.build!.gameVersion).toBeUndefined();
    r.startedGameVersion='<img onerror="bad()">'; r.build!.gameVersion=r.startedGameVersion;
    expect(playHistory(s.history,{page:0})).not.toContain('<img onerror'); expect(historyBuild(r)).toContain('&lt;img');
  });
  it('formats frozen effect decimals without changing the stored historical wording',()=>{
    const s=fixture(), r=latest(s); r.build!.skills[0].description='通常攻撃 ×1.6400000000000001';
    expect(historyBuild(r)).toContain('通常攻撃 ×1.64'); expect(historyBuild(r)).not.toContain('1.6400000000000001');
    expect(r.build!.skills[0].description).toBe('通常攻撃 ×1.6400000000000001');
  });
});
