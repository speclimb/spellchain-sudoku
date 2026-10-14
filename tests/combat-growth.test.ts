import { describe, expect, it } from 'vitest';
import { canUseSkill, dispatch, legalOrigins, longestOrigins, newSave, previewAction, resolveAction, startRun } from '../src/game/engine';
import { parseSave } from '../src/game/storage';
import { relicValues, skillValues } from '../src/game/growth';
import { enemyForRun } from '../src/game/enemies';
import { mergeBattles } from '../src/game/contributions';
import { PEERS } from '../src/game/sudoku';
import type { Run, Save, SkillId } from '../src/game/types';
function fixture(seed = 71): Save { const save = newSave(); save.meta.clears = 99; return startRun(save,'fuse',seed); }
function play(run:Run, cell=legalOrigins(run)[0], skillId?:SkillId) { return {type:'play' as const,cell,skill:!!skillId,skillId,revision:run.revision}; }
function equip(run:Run,id:SkillId,level=1) { run.skillLevels = {...run.skillLevels,[id]:level}; run.equippedSkills=[id]; run.mana=8; }
function boss(seed=71):Save { const save=fixture(seed),r=save.run!; r.stage=4;r.stats.kills=4;r.enemyHp=1; return dispatch(save,play(r)); }
function old(save:Save):any { const copy=structuredClone(save) as any; for(const key of ['expansionVersion','enemyRulesVersion','skillLevels','equippedSkills','relicLevels','rewardStep','pendingRelicRewards','contributions']) delete copy.run[key]; return copy; }

describe('single selected skill combat',()=>{
  it('does not combine intrinsic auto with an additional skill and shares mana/coupons',()=>{
    const run=fixture().run!;equip(run,'pierce');
    expect(previewAction(run,legalOrigins(run)[0],true,'pierce').chain!.initialAuto).toBe(4);
    expect(previewAction(run,legalOrigins(run)[0],true,'fuse').chain!.initialAuto).toBe(8);
    run.inventory=['quint','battery'];run.freeSkillTokens=1;run.manaOverflow=2;
    const first=resolveAction(run,play(run,legalOrigins(run)[0],'pierce'));
    expect(first).toMatchObject({mana:8,manaOverflow:2,freeSkillTokens:0});expect(first.lastReport!.ledger!.relics.quint!.tokensUsed).toBe(1);
    expect(canUseSkill(first)).toBe(true);
    if(first.phase==='battle') { const second=resolveAction(first,play(first,legalOrigins(first)[0],'fuse'));expect(second.mana).toBe(2);expect(second.manaOverflow).toBe(0); }
  });
  it('rejects unowned and unequipped skills and only changes loadout between fights',()=>{
    const run=fixture().run!;run.mana=8;
    expect(()=>previewAction(run,legalOrigins(run)[0],true,'bridge')).toThrow();
    run.skillLevels!.bridge=1;
    expect(()=>previewAction(run,legalOrigins(run)[0],true,'bridge')).toThrow();
    expect(()=>resolveAction(run,{type:'equip',skills:['bridge'],revision:run.revision})).toThrow();
    const reward=boss().run!;reward.skillLevels!.bridge=1;reward.skillLevels!.pierce=1;reward.skillLevels!.bastion=1;
    const changed=resolveAction(reward,{type:'equip',skills:['bridge','bastion'],revision:reward.revision});
    expect(changed.equippedSkills).toEqual(['bridge','bastion']);expect(changed.skillLevels!.pierce).toBe(1);expect(changed.rewards).toEqual(reward.rewards);
    expect(()=>resolveAction(reward,{type:'equip',skills:['bridge','pierce','bastion'],revision:reward.revision})).toThrow();
  });
  it('bridge reconnects only to a confirmed distinct cell and spends exactly one auto',()=>{
    const run=fixture().run!;equip(run,'bridge',10);
    const a=run.givens.findIndex(g=>!g),b=run.givens.findIndex((g,i)=>!g&&!PEERS[a].includes(i)&&i!==a);
    run.cells=[...run.solution];run.cells[a]=0;run.cells[b]=0;
    const p=previewAction(run,a,true,'bridge');expect(p.path).toHaveLength(2);expect(p.path[1].bridge).toBe(true);
    expect(p.chain!.steps[1].remainingAfter).toBe(p.chain!.steps[1].remainingBefore-1);expect(p.chain!.steps[1].candidateValues).toHaveLength(1);
  });
  it('weak attacks and guard attacks are additive outside Trinity and never add proc rolls',()=>{
    for(const id of ['pierce','bastion'] as const){
      const run=fixture().run!;equip(run,id,10);run.inventory=['trinity','wick','ward'];run.tier.wick=2;run.spellLevel=40;run.enemyHp=1e9;
      const root=longestOrigins(run,true,id).cells[0],p=previewAction(run,root,true,id),result=resolveAction(run,play(run,root,id)).lastReport!;
      const proc=result.procs?.find(p=>p.id==='trinity');
      expect(result.damage).toBe(Math.floor(result.baseDamage!*(proc?.triggered?proc.value:1))+result.clearBonus!+result.extraDamage!);
      expect(result.path).toEqual(p.path);expect(result.procs?.filter(p=>p.id==='trinity').length??0).toBeLessThanOrEqual(1);
      if(id==='pierce') expect(result.extraDamage).toBe(Math.floor((result.weak*55+(result.weak>=3?100:0))*8.8));
      else expect(result.extraDamage).toBe(Math.floor(result.shield*3.6*8.8));
    }
  });
  it('level5 temporary guard does not persist on the sheet and uses maximum not summed shield',()=>{
    const run=fixture().run!;equip(run,'bastion',5);run.spellLevel=80;run.inventory=['wick','ward'];run.tier.wick=2;run.enemyHp=1e9;
    const p=previewAction(run,longestOrigins(run,true,'bastion').cells[0],true,'bastion');
    expect(p.temporaryShield).toBe(6);expect(p.shield).toBeLessThanOrEqual(18+27*3+6);
    expect(p.extraDamage).toBe(Math.floor(p.shield*2.5*(1+79*.2)));
  });
});
describe('two persisted boss choices',()=>{
  it('pre-rolls both choices once, persists each stage, and rejects repeated actions',()=>{
    const save=boss(),r=save.run!;expect(r.rewardStep).toBe('skill');expect(r.pendingRelicRewards).toHaveLength(3);
    const firstAction={type:'reward' as const,relic:r.rewards[0],revision:r.revision},expected=[...r.pendingRelicRewards!],rng=r.randomState;
    const first=dispatch(parseSave(JSON.stringify(save)),firstAction);expect(first.run!.stage).toBe(4);expect(first.run!.rewards).toEqual(expected);expect(first.run!.randomState).toBe(rng);expect(first.run!.rewardStep).toBe('relic');
    expect(()=>dispatch(first,firstAction)).toThrow();expect(parseSave(JSON.stringify(first))).toEqual(first);
    const finalAction={type:'reward' as const,relic:first.run!.rewards[0],revision:first.run!.revision};
    const final=dispatch(parseSave(JSON.stringify(first)),finalAction);expect(final.run).toMatchObject({stage:5,phase:'battle',enemyRulesVersion:1});expect(final.run!.contributions).toEqual(r.contributions);
    expect(()=>dispatch(final,finalAction)).toThrow();expect(parseSave(JSON.stringify(final))).toEqual(final);
  });
  it('supports the all-max skill filler without corrupting a pending second choice',()=>{
    const save=fixture(),r=save.run!;r.stage=4;r.stats.kills=4;r.enemyHp=1;r.skillRank=2;r.skillLevels={fuse:10,bridge:10,pierce:10,bastion:10};
    const killed=dispatch(save,play(r));expect(killed.run!.rewards).toContain('training');
    const trained=dispatch(killed,{type:'reward',relic:'training',revision:killed.run!.revision});expect(trained.run!.phase).toBe('reward');expect(parseSave(JSON.stringify(trained))).toEqual(trained);
  });
});
describe('honest contribution accounting and migration',()=>{
  it('separates actual HP loss, output, excess and score on one cast',()=>{
    const save=fixture(),r=save.run!;r.enemyHp=1;r.inventory=['gold'];const next=dispatch(save,play(r)),p=next.run!.lastReport!,b=next.run!.contributions!.battles[0];
    expect(p.ledger!.hpDamage).toBe(1);expect(p.ledger!.overkill).toBe(p.damage-1);expect(b.damage).toBe(b.hpDamage+b.overkill);expect(b.score).toBe(p.attackScore+500);expect(b.relics.gold!.damage).toBe(0);expect(b.relics.gold!.score).toBe(p.attackScore-p.damage);
  });
  it('single-factor multiplier differences are overlapping, never a 100% allocation',()=>{
    const run=fixture().run!;run.inventory=['glass','amplifier'];run.mana=8;
    const root=legalOrigins(run)[0],r=resolveAction(run,play(run,root,'fuse')).lastReport!;
    for(const id of ['glass','amplifier'] as const){const removed=structuredClone(run);removed.inventory=removed.inventory.filter(x=>x!==id);expect(r.ledger!.relics[id]!.damage).toBe(r.damage-previewAction(removed,root,true).damage);}
  });
  it('attributes Ward-fed guard cannon and does not count refreshed afterglow twice',()=>{
    const run=fixture().run!;equip(run,'bastion',1);run.inventory=['ward','afterglow'];
    const cell=run.givens.findIndex(g=>!g);run.cells=[...run.solution];run.cells[cell]=0;
    const p=previewAction(run,cell,true,'bastion'),removed=structuredClone(run);removed.inventory=['afterglow'];
    expect(p.ledger!.relics.ward!.damage).toBe(p.damage-previewAction(removed,cell,true,'bastion').damage);
    expect(p.ledger!.relics.afterglow!.fuelGranted).toBe(2);
    run.afterglow=true;expect(previewAction(run,cell,true,'bastion').ledger!.relics.afterglow!.fuelGranted).toBe(0);
  });
  it('previews, load and replay rejection never duplicate history',()=>{
    const save=fixture(),r=save.run!,action=play(r);for(let n=0;n<3;n++)previewAction(r,action.cell);expect(r.contributions!.battles).toHaveLength(0);
    const next=dispatch(save,action),before=structuredClone(next.run!.contributions);expect(parseSave(JSON.stringify(next)).run!.contributions).toEqual(before);expect(()=>dispatch(next,action)).toThrow();expect(next.run!.contributions).toEqual(before);
  });
  it('retains exactly the last five encounters including the boss',()=>{
    let save=fixture();for(let stage=0;stage<10;stage++) {save.run!.enemyHp=1;save=dispatch(save,play(save.run!));while(save.run!.phase==='reward')save=dispatch(save,{type:'reward',relic:save.run!.rewards.find(id=>id!=='glass')!,revision:save.run!.revision});}
    expect(save.run!.contributions!.battles.map(b=>b.stage)).toEqual([5,6,7,8,9]);const all=mergeBattles(save.run!.contributions!.battles);expect(all.casts).toBe(5);expect(all.damage).toBe(all.hpDamage+all.overkill);
  });
  it('migrates every old prime rank/tier exactly and does not invent old statistics',()=>{
    for(const rank of [1,2,3])for(const tier of [1,2]) {
      const save=fixture(),r=save.run!;r.inventory=['duality','trinity','quint','sept'];for(const id of r.inventory){r.acquisitionRank[id]=rank;r.tier[id]=tier;}
      const legacy=old(save),loaded=parseSave(JSON.stringify(legacy));expect(loaded.run!.enemyRulesVersion).toBe(0);expect(loaded.run!.contributions).toEqual({sinceCast:0,partial:true,battles:[]});
      for(const id of r.inventory) {expect(relicValues(loaded.run!,id).primeValue).toBe(relicValues(legacy.run,id).primeValue);expect(relicValues(loaded.run!,id).chance).toBe([.3,.45,.6][rank-1]);}
      for(const key of ['cells','enemyHp','mana','randomState'] as const)expect(loaded.run![key]).toEqual(r[key]);
    }
  });
  it('preserves an already rolled old boss reward and upgrades enemy rules only after taking it',()=>{
    const save=fixture(),r=save.run!;r.stage=4;r.stats.kills=5;r.phase='reward';r.enemyHp=0;r.cells=[...r.solution];r.rewards=['skill-upgrade','greater:wick','greater:lens'];
    const loaded=parseSave(JSON.stringify(old(save)));expect(loaded.run!.rewardStep).toBe('legacy');expect(loaded.run!.rewards).toEqual(r.rewards);
    const next=dispatch(loaded,{type:'reward',relic:'greater:wick',revision:r.revision});expect(next.run!.phase).toBe('battle');expect(next.run!.tier.wick).toBe(2);expect(next.run!.enemyRulesVersion).toBe(1);expect(enemyForRun(next.run!).symbol).toBe('frost');
  });
  it('records the actual old encounter boss identity across the next-battle migration',()=>{
    for(const stage of [4,5]) {
      const save=fixture(),r=save.run!;r.balanceVersion=1;r.stage=stage;r.stats.kills=stage;r.enemyHp=1;
      const migrated=parseSave(JSON.stringify(old(save))),killed=dispatch(migrated,play(migrated.run!));
      expect(killed.run!.rewardStep).toBe('legacy');expect(killed.run!.contributions!.battles[0].boss).toBe(stage===5);
      const advanced=dispatch(killed,{type:'reward',relic:killed.run!.rewards[0],revision:killed.run!.revision});
      expect(parseSave(JSON.stringify(advanced))).toEqual(advanced);
    }
  });
  it('rejects forged skill/equipment/pending reward and contribution data',()=>{
    const valid=boss();const mutations=[(r:Run)=>{r.skillLevels!.bridge=11;},(r:Run)=>{r.equippedSkills=['bridge'];},(r:Run)=>{r.pendingRelicRewards=[];},(r:Run)=>{r.contributions!.battles[0].hpDamage++;},(r:Run)=>{r.lastReport!.ledger!.overkill++;}];
    for(const change of mutations){const save=structuredClone(valid);change(save.run!);expect(()=>parseSave(JSON.stringify(save))).toThrow();}
  });
  it('all new skill levels have bounded deliberate evolution values',()=>{
    const run=fixture().run!;for(const id of ['bridge','pierce','bastion'] as const){equip(run,id,5);const five=skillValues(run,id);equip(run,id,10);const ten=skillValues(run,id);expect(five.evolution).toBe(2);expect(ten.evolution).toBe(3);expect(ten.reconnects).toBeLessThanOrEqual(3);}
  });
});
