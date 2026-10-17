import { describe, expect, it } from 'vitest';
import { newSave, startRun, dispatch, legalOrigins } from '../src/game/engine';
import { snapshotBuild, ensureHistoryRun, boundHistory, emptyHistory } from '../src/game/history';
import { parseHistory } from '../src/game/history-validation';
import { parseSave } from '../src/game/storage';
import { historyBuild, playHistory } from '../src/ui/play-history';
import type { Save } from '../src/game/types';

const fixture = () => startRun(newSave(), 'fuse', 51);
const latest = (s: Save) => s.history!.runs.at(-1)!;
const play = (s: Save) => dispatch(s, { type: 'play', cell: legalOrigins(s.run!)[0], skill: false, revision: s.run!.revision });

describe('frozen adventure build', () => {
  it('records the intrinsic skill and explicitly empty inventory at start', () => {
    const s = fixture(), b = latest(s).build!;
    expect(b).toMatchObject({ version: 1, stage: 0, cast: 0, revision: 0, spellLevel: 1, relics: [] });
    expect(b.skills).toMatchObject([{ id: 'fuse', level: 1, evolution: 1, role: 'intrinsic' }]);
    expect(historyBuild(latest(s))).toContain('所持している遺物はありません');
  });
  it('snapshots owned relics and every skill role with historical descriptions', () => {
    const s = fixture(), r = s.run!;
    r.inventory = ['wick','quint']; r.relicLevels = { wick: 10, quint: 5 }; r.tier = { wick: 3, quint: 2 };
    r.skillLevels = { fuse: 10, bridge: 5, pierce: 2, bastion: 1 }; r.equippedSkills = ['bridge', 'pierce'];
    const b = snapshotBuild(r);
    expect(b.relics).toMatchObject([{ id: 'wick', level: 10, tier: 3 }, { id: 'quint', level: 5, tier: 2 }]);
    expect(b.skills).toMatchObject([{ id: 'fuse', evolution: 3, role: 'intrinsic' }, { id: 'bridge', evolution: 2, role: 'equipped' }, { id: 'pierce', evolution: 1, role: 'equipped' }, { id: 'bastion', role: 'reserve' }]);
    const frozen = JSON.stringify(b); r.relicLevels.wick = 1; r.skillLevels.fuse = 1; r.inventory = [];
    expect(JSON.stringify(b)).toBe(frozen);
  });
  it('updates on equipment changes without adding battle or cast records', () => {
    const initial = fixture(); initial.run!.enemyHp = 1; const s = play(initial); s.run!.skillLevels = { fuse: 1, bridge: 5, pierce: 2, bastion: 1 };
    const next = dispatch(s,{ type:'equip', skills:['bridge','bastion'], revision:s.run!.revision });
    expect(latest(next).build!.skills.filter(x=>x.role==='equipped').map(x=>x.id)).toEqual(['bridge','bastion']);
    expect(latest(next).battles[0].casts).toHaveLength(1);
    expect(latest(s).build!.skills).toHaveLength(1);
    expect(parseSave(JSON.stringify(next))).toEqual(next);
  });
  it('updates after reward acquisition, including the last reward before moving battle', () => {
    const s = fixture(); s.run!.enemyHp = 1; let next = play(s);
    next.run!.rewards = ['wick'];
    next = dispatch(next, { type:'reward', relic:'wick', revision:next.run!.revision });
    expect(latest(next).build).toEqual(snapshotBuild(next.run!));
    expect(latest(next).build!.relics[0].id).toBe('wick');
  });
  it('freezes loss after the committed cast, including unused skills', () => {
    const s = fixture(); s.run!.hp = 1; s.run!.marks = s.run!.marks.map(m => m === 'shield' ? 'weak' : m); s.run!.enemyHp = 100000; s.run!.skillLevels = { fuse: 5, bridge: 2 };
    const next = play(s);
    expect(next.run!.phase).toBe('lost');
    expect(latest(next).build).toEqual(snapshotBuild(next.run!));
    expect(historyBuild(latest(next))).toContain('冒険終了時の構成');
    expect(latest(next).build!.skills.some(x=>x.id==='bridge')).toBe(true);
  });
  it('keeps a retired build independent from the new adventure', () => {
    const s = fixture(); s.run!.inventory = ['ward']; const next = play(s), frozen = structuredClone(latest(next).build);
    const again = startRun(next,'fuse',52);
    expect(again.history!.runs[0].status).toBe('retired');
    expect(again.history!.runs[0].build).toEqual(frozen);
    expect(latest(again).build!.relics).toHaveLength(0);
  });
  it('does not invent builds for completed old history or infer them from rewards', () => {
    const s = fixture(); delete latest(s).build; latest(s).status = 'lost'; s.run!.phase = 'lost';
    ensureHistoryRun(s);
    expect(latest(s).build).toBeUndefined();
    expect(parseHistory(s.history)).toEqual(s.history);
    expect(historyBuild(latest(s))).toContain('構成の記録がありません');
  });
  it('recovers an active legacy run from actual current state, without replay inference', () => {
    const s = fixture(); s.history = emptyHistory(); s.run!.inventory = ['pen']; s.run!.relicLevels = {pen:7};
    const item = ensureHistoryRun(s)!;
    expect(item.partial).toBe(true);
    expect(item.build!.relics[0]).toMatchObject({id:'pen',level:7});
    expect(historyBuild(item)).toContain('最新記録時点の構成');
  });
  it('drops a future current build without dropping healthy logs or the board', () => {
    const s = fixture(); latest(s).build!.revision = 99999;
    const parsed = parseSave(JSON.stringify(s));
    expect(parsed.run).toEqual(s.run); expect(latest(parsed).build).toBeUndefined();
    expect(latest(parsed).battles).toEqual(latest(s).battles);
  });
  it('preserves descriptions on load instead of recalculating from current balance tables', () => {
    const s = fixture(); latest(s).build!.skills[0].description = '以前の実装で記録された効果';
    const parsed = parseSave(JSON.stringify(s)); ensureHistoryRun(parsed);
    expect(latest(parsed).build!.skills[0].description).toBe('以前の実装で記録された効果');
  });
  it.each(['level','role','duplicate','unknown','text'])('drops only malformed optional build: %s', kind => {
    const s = fixture(), b = latest(s).build! as any;
    if(kind==='level') b.skills[0].level = -1;
    if(kind==='role') b.skills[0].role = 'equipped';
    if(kind==='duplicate') b.skills.push({...b.skills[0]});
    if(kind==='unknown') b.relics.push({id:'unknown',name:'x',description:'x',level:1,tier:1});
    if(kind==='text') b.skills[0].description = 'x'.repeat(2001);
    const parsed = parseHistory(s.history)!;
    expect(parsed.runs).toHaveLength(1); expect(parsed.runs[0].build).toBeUndefined();
  });
  it('escapes persisted text and renders builds outside selected battle details', () => {
    const s = fixture(); latest(s).build!.skills[0].name = '<img onerror="bad()">';
    const html = playHistory(s.history,{page:0});
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img onerror');
    expect(html.indexOf('最新記録時点の構成')).toBeLessThan(html.indexOf('history-list-heading'));
    expect(html).toContain('戦闘一覧で開いた戦闘の時点とは異なります');
  });
  it('preserves snapshot when cast details and earlier adventures are trimmed', () => {
    let s = fixture(); for(let i=0;i<11;i++) s = startRun(s,'fuse',52+i);
    const frozen = structuredClone(latest(s).build); boundHistory(s.history!);
    expect(s.history!.runs).toHaveLength(10); expect(latest(s).build).toEqual(frozen);
    expect(parseHistory(JSON.parse(JSON.stringify(s.history)))).toEqual(s.history);
  });
});
