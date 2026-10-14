import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, legalOrigins, longestOrigins, newSave, previewAction, startRun } from '../src/game/engine';
import { boundHistory, emptyHistory, HISTORY_LIMITS, historyBytes, historyCounts, recordHistory, type HistoryCast, type PlayHistory } from '../src/game/history';
import { parseHistory } from '../src/game/history-validation';
import { loadSave, parseSave, persist, SAVE_KEY } from '../src/game/storage';
import type { Save, SkillId } from '../src/game/types';

function fixture(seed = 51): Save { const save = newSave(); save.meta.clears = 99; return startRun(save, 'fuse', seed); }
function play(save: Save, skillId?: SkillId): Save {
  const run = save.run!;
  return dispatch(save, { type: 'play', cell: legalOrigins(run, !!skillId, skillId)[0], skill: !!skillId, skillId, revision: run.revision });
}
const latest = (save: Save) => save.history!.runs.at(-1)!;
function won(): Save { const save = fixture(); save.run!.enemyHp = 1; return play(save); }
function manyHistory(count = 620): PlayHistory {
  const save = won(), h = save.history!, b = latest(save).battles[0], c = structuredClone(b.casts[0]);
  b.casts = Array.from({ length: count }, (_, i) => ({ ...structuredClone(c), id: i+1, turn: i+1 }));
  b.ledger.casts = count;
  for (const field of ['damage','hpDamage','overkill','score'] as const) b.ledger[field] = c[field]*count;
  for (const field of ['received','hpLost','sheetsCompleted'] as const) b[field] = c[field]*count;
  return h;
}
afterEach(() => vi.unstubAllGlobals());

describe('committed play history', () => {
  it('records one event per committed cast; previews and duplicate revisions cannot append', () => {
    const save = fixture(), before = structuredClone(save), run = save.run!;
    previewAction(run,legalOrigins(run)[0]); longestOrigins(run);
    expect(save).toEqual(before);
    const action = { type:'play' as const, cell:legalOrigins(run)[0],skill:false,revision:run.revision };
    const next = dispatch(save,action), b = latest(next).battles[0], c = b.casts[0], report = next.run!.lastReport!;
    expect(b.ledger.casts).toBe(1); expect(c.id).toBe(1); expect(c.chain).toBe(report.path.length);
    expect(c.damage).toBe(report.damage); expect(c.hpDamage+c.overkill).toBe(c.damage);
    expect(c.received).toBe(report.received); expect(c.enemyAfter).toBe(next.run!.enemyHp);
    expect(() => dispatch(next,action)).toThrow('すでに');
    recordHistory(next,run,action); expect(b.ledger.casts).toBe(1);
    expect(parseSave(JSON.stringify(next))).toEqual(next);
  });
  it('keeps cross-sheet casts together with exact skill and relic levels', () => {
    const save = fixture(), r = save.run!;
    r.spellLevel = 70; r.inventory = ['wick','pen','trinity']; r.relicLevels = { wick:5, pen:4, trinity:5 }; r.tier.wick = 2;
    r.skillLevels = { fuse:5 }; r.skillRank = 2; r.mana = 8;
    const next = dispatch(save,{type:'play',cell:longestOrigins(r,true,'fuse').cells[0],skill:true,skillId:'fuse',revision:r.revision}), report = next.run!.lastReport!, b = latest(next).battles[0], c = b.casts[0];
    expect(report.segments!.length).toBeGreaterThan(1); expect(b.casts).toHaveLength(1);
    expect(c.sheetTo-c.sheetFrom+1).toBe(report.segments!.length);
    expect(c.skillId).toBe('fuse'); expect(c.skillLevel).toBe(5); expect(c.relics.pen!.level).toBe(4); expect(c.relics.wick!.tier).toBe(2);
    expect(c.procs).toEqual(report.procs ?? []); expect(c.relics.pen!.metric.damage).toBe(report.ledger!.relics.pen!.damage);
    expect(parseHistory(next.history)).toEqual(next.history);
  });
  it('distinguishes previous coupon/fuel use from this cast issuing them', () => {
    const save = fixture(),r = save.run!;
    r.inventory = ['quint','sept'];r.freeSkillTokens = 1;r.reservedAuto = 3;r.mana=8;
    const next = play(save,'fuse'),c = latest(next).battles[0].casts[0],report=next.run!.lastReport!;
    expect(c.tokensBefore).toBe(1);expect(c.tokensAfter).toBe(0);expect(c.freeSkill).toBe(true);
    expect(c.relics.quint!.metric.tokensUsed).toBe(1);expect(c.relics.quint!.metric.tokensGranted??0).toBe(0);
    expect(c.procs.some(p=>p.id==='quint')).toBe(false);
    expect(c.fuelBefore).toBe(3);expect(c.relics.sept!.metric.fuelUsed??0).toBe(report.ledger!.relics.sept!.fuelUsed);
    expect(c.fuelAfter).toBe(next.run!.reservedAuto);
  });
  it('separates normal charging, paid overflow restoration and coupon preservation',()=>{
    const initial=fixture();initial.run!.inventory=['battery','quint'];initial.run!.mana=8;initial.run!.manaOverflow=2;
    const paid=play(initial,'fuse'),p=latest(paid).battles[0].casts[0];
    expect(p).toMatchObject({manaBefore:8,manaAfter:2,charged:0,overflowBefore:2,overflowAfter:0,overflowRestored:2,freeSkill:false});
    initial.run!.freeSkillTokens=1;const free=play(initial,'fuse'),f=latest(free).battles[0].casts[0];
    expect(f).toMatchObject({manaBefore:8,manaAfter:8,charged:0,overflowBefore:2,overflowAfter:2,overflowRestored:0,freeSkill:true});
    const normal=fixture();const next=play(normal),n=latest(next).battles[0].casts[0];
    expect(n.charged).toBe(next.run!.lastReport!.charge);expect(n.manaAfter-n.manaBefore).toBe(n.charged);
    expect(parseSave(JSON.stringify(paid))).toEqual(paid);expect(parseSave(JSON.stringify(free))).toEqual(free);
  });
  it('records both boss reward steps once with their historical descriptions', () => {
    let save=fixture();save.run!.stage=4;save.run!.stats.kills=4;save.run!.enemyHp=1;
    save=play(save); const battle=latest(save).battles.at(-1)!;
    expect(battle.status).toBe('victory');const first=save.run!.rewards[0];
    const action={type:'reward' as const,relic:first,revision:save.run!.revision};
    save=dispatch(save,action);expect(latest(save).battles.at(-1)!.rewards).toHaveLength(1);
    expect(latest(save).battles.at(-1)!.rewards[0]).toMatchObject({id:first,step:'skill'});
    expect(()=>dispatch(save,action)).toThrow();
    save=parseSave(JSON.stringify(save));save=dispatch(save,{type:'reward',relic:save.run!.rewards[0],revision:save.run!.revision});
    const completed=latest(save).battles.find(b=>b.stage===4)!;
    expect(completed.rewards).toHaveLength(2);expect(completed.rewards[1].step).toBe('relic');expect(completed.rewards[0].description.length).toBeGreaterThan(10);
    expect(latest(save).battles.at(-1)!.stage).toBe(5);expect(parseSave(JSON.stringify(save))).toEqual(save);
  });
  it('keeps lost/abandoned adventures across same-seed restarts without reusing IDs', () => {
    const save=fixture();save.run!.hp=1;save.run!.marks=save.run!.marks.map(m=>m==='shield'?'weak':m);
    const lost=play(save);expect(lost.run!.phase).toBe('lost');
    const next=startRun(lost,'fuse',save.run!.seed);
    expect(next.history!.runs).toHaveLength(2);expect(next.history!.runs[0].status).toBe('lost');expect(next.history!.runs[0].battles[0].status).toBe('lost');
    expect(latest(next).key).not.toBe(next.history!.runs[0].key);
    const again=startRun(next,'fuse',save.run!.seed);expect(again.history!.runs[1].status).toBe('retired');expect(again.history!.runs[1].battles[0].status).toBe('retired');
  });
  it('starts missing historical detail from the next cast, preserving earlier aggregates separately', () => {
    let save=play(fixture());delete save.history;const before=structuredClone(save.run!);
    save=play(save);const h=latest(save),b=h.battles[0];
    expect(h.partial).toBe(true);expect(h.sinceCast).toBe(before.castCounter);expect(b.partial).toBe(true);
    expect(b.ledger.casts).toBe(1);expect(b.casts[0].id).toBe(before.castCounter+1);
    expect(save.run!.contributions!.battles[0].casts).toBe(2);
  });
  it('records prevented counter-damage and actual HP lost separately on defeat', () => {
    const save=fixture(),r=save.run!;r.hp=1;r.stage=44;r.stats.kills=44;r.enemyHp=1_000_000;
    const next=play(save),c=latest(next).battles.at(-1)!.casts[0];
    expect(next.run!.phase).toBe('lost');expect(c.received).toBeGreaterThan(1);expect(c.hpLost).toBe(1);expect(c.hpAfter).toBe(0);
  });
});
describe('bounded and resilient history storage', () => {
  it('keeps ten adventures and marks omitted adventures', () => {
    let save=fixture();for(let i=0;i<13;i++)save=startRun(play(save),'fuse',i);
    expect(save.history!.runs).toHaveLength(10);expect(save.history!.omittedRuns).toBe(4);
    expect(parseHistory(save.history)).toEqual(save.history);
  });
  it('caps cast details while retaining full recorded battle totals', () => {
    const h=manyHistory(HISTORY_LIMITS.casts+20),b=h.runs[0].battles[0],damage=b.ledger.damage;
    boundHistory(h);expect(historyCounts(h).casts).toBe(HISTORY_LIMITS.casts);expect(h.runs[0].battles[0].casts[0].id).toBe(21);
    expect(b.ledger.casts).toBe(HISTORY_LIMITS.casts+20);expect(b.ledger.damage).toBe(damage);expect(historyBytes(h)).toBeLessThanOrEqual(HISTORY_LIMITS.bytes);
    expect(parseHistory(h)).toEqual(h);
  });
  it('caps battles and records the omitted count', () => {
    const h=won().history!,r=h.runs[0],b=r.battles[0];
    r.battles=Array.from({length:HISTORY_LIMITS.battles+15},(_,i)=>({...structuredClone(b),stage:i,ledger:{...structuredClone(b.ledger),stage:i},casts:b.casts.map(c=>({...c,id:i+1}))}));
    boundHistory(h);expect(historyCounts(h).battles).toBe(HISTORY_LIMITS.battles);expect(r.omittedBattles).toBe(15);expect(r.battles[0].stage).toBe(15);expect(parseHistory(h)).toEqual(h);
  });
  it('enforces byte budget for rich casts, retaining summary and newest detail', () => {
    const h=manyHistory(600),c=h.runs[0].battles[0].casts[0];
    const effect={level:10,tier:3,metric:{heldCasts:1,opportunities:1,triggers:1,damage:999999,addedInputs:3,fuelGranted:10,fuelUsed:10,mana:4,prevented:5,tokensGranted:3,tokensUsed:1,score:50}};
    for(const cast of h.runs[0].battles[0].casts)for(const id of ['wick','echo','rekindle','pen','ward','stroke','battery','amplifier','afterglow','lens','glass','gold','trinity','duality','quint','sept'])cast.relics[id as keyof HistoryCast['relics']]=structuredClone(effect);
    const budget=750*1024;expect(historyBytes(h)).toBeGreaterThan(budget);boundHistory(h,budget);
    expect(historyBytes(h)).toBeLessThanOrEqual(budget);expect(historyCounts(h).casts).toBeGreaterThan(0);expect(h.runs[0].battles[0].casts.at(-1)!.id).toBe(600);
    expect(h.runs[0].battles[0].ledger.casts).toBe(600);expect(c.id).toBe(1);expect(parseHistory(h)).toEqual(h);
  });
  it.each(['negative','duplicate','unknown','badDamage','oversize','futureCast','futureRun','wrongKey','futureReward','wrongSeed','wrongCharacter','futureBattle'])('rejects malformed optional history (%s), preserving core', kind=>{
    const save=won(),before=structuredClone(save.run),h=save.history!;
    if(kind==='negative')h.runs[0].battles[0].casts[0].received=-1;
    if(kind==='duplicate')h.runs.push(structuredClone(h.runs[0]));
    if(kind==='unknown')(h as any).payload='x';
    if(kind==='badDamage')h.runs[0].battles[0].casts[0].hpDamage++;
    if(kind==='oversize')h.runs[0].battles[0].enemy='x'.repeat(1000);
    if(kind==='futureCast')h.runs[0].battles[0].casts[0].id=save.run!.castCounter+1;
    if(kind==='futureRun')h.runs[0].number=save.meta.runs+1;
    if(kind==='wrongKey')h.runs[0].key='mismatched';
    if(kind==='wrongSeed')h.runs[0].seed++;
    if(kind==='wrongCharacter')h.runs[0].character='lumen';
    if(kind==='futureBattle'){h.runs[0].battles[0].stage++;h.runs[0].battles[0].ledger.stage++;}
    if(kind==='futureReward')h.runs[0].battles[0].rewards.push({revision:save.run!.revision+1,id:'training',name:'test',description:'test',step:'relic'});
    const loaded=parseSave(JSON.stringify(save));expect(loaded.run).toEqual(before);expect(loaded.history).toBeUndefined();
  });
  it('a corrupt future ID never suppresses the next genuine committed cast',()=>{
    const save=play(fixture());save.history!.runs[0].battles[0].casts[0].id=2;
    const restored=parseSave(JSON.stringify(save));expect(restored.history).toBeUndefined();
    const next=play(restored);expect(latest(next)).toMatchObject({partial:true,sinceCast:1});
    expect(latest(next).battles[0].casts.map(c=>c.id)).toEqual([2]);expect(latest(next).battles[0].ledger.casts).toBe(1);
  });
  it('load migrates missing detail without reconstructing previous turns',()=>{
    const save=play(fixture());delete save.history;
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify(save)});
    const loaded=loadSave();expect(loaded.warning).toBe('');expect(loaded.save.run).toEqual(save.run);
    expect(latest(loaded.save)).toMatchObject({partial:true,sinceCast:1,battles:[]});
  });
  it('recovers corrupt optional history with a warning and the same core',()=>{
    const save=won();(save.history as any).version=7;vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify(save)});
    const loaded=loadSave();expect(loaded.save.run).toEqual(save.run);expect(loaded.warning).toContain('冒険の進行は保持');expect(latest(loaded.save).partial).toBe(true);
  });
  it('retries quota failures atomically with a smaller log and exact current run',()=>{
    const save=won();save.history=manyHistory(600);const before=structuredClone(save.run);let stored='previous';let attempts=0;
    vi.stubGlobal('localStorage',{setItem:(key:string,value:string)=>{expect(key).toBe(SAVE_KEY);attempts++;if(value.length*2>150000)throw new DOMException('Full','QuotaExceededError');stored=value;}});
    expect(persist(save)).toContain('冒険の進行は保存済み');expect(attempts).toBeGreaterThan(1);expect(JSON.parse(stored).run).toEqual(before);
    expect(JSON.parse(stored).history).toEqual(save.history);expect(save.history.storageReduced).toBe(true);
  });
  it('never deletes or replaces a healthy old save if every write fails',()=>{
    const save=won(),history=structuredClone(save.history),stored=JSON.stringify(fixture(123)),remove=vi.fn();
    vi.stubGlobal('localStorage',{setItem:()=>{throw new DOMException('Full','QuotaExceededError');},getItem:()=>stored,removeItem:remove});
    expect(persist(save)).toContain('以前の保存は消していません');expect(localStorage.getItem(SAVE_KEY)).toBe(stored);expect(remove).not.toHaveBeenCalled();expect(save.history).toEqual(history);
  });
  it('does not put history inside the preview-cloned run and tolerates empty history',()=>{
    const save=won();expect((save.run as any).history).toBeUndefined();expect(parseHistory(emptyHistory())).toEqual(emptyHistory());
  });
});
