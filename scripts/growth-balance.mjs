/** Real organic runs from the initial state. Greedy forecast policy, not human balance validation. */
import { createServer } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try {
 const e=await server.ssrLoadModule('/src/game/engine.ts');
 const {skillLevel,relicLevel}=await server.ssrLoadModule('/src/game/growth.ts');
 const {parseSave}=await server.ssrLoadModule('/src/game/storage.ts');
 const seeds=Number(process.argv[2]??2);const samples=[];const began=performance.now();
 for(const character of ['fuse','scribe','lumen']) for(const desired of ['bridge','pierce','bastion']) for(let seed=1;seed<=seeds;seed++) {
   const save=e.newSave();save.meta.clears=99;let run=e.startRun(save,character,101+seed).run;
   let casts=0,rewardSteps=0,desiredUses=0,hpDamage=0,overkill=0,total=0,crossSheetCasts=0;const skills={};
   while(run.phase==='battle'||run.phase==='reward') {
     if(casts>2000)throw new Error('Safety failure: organic run exceeded 2000 casts');
     if(run.phase==='reward') {
       if(character==='fuse' && desired==='pierce' && seed===1 && run.stage===9 && run.rewardStep==='skill') writeFileSync('.runtime/growth-showcase.json',JSON.stringify({...save,run,meta:{...save.meta,tutorialDone:true},settings:{sound:false,fast:false,reducedMotion:true}}));
       const value=id=>{
         if(id===`skill:${desired}`)return 1000+(10-skillLevel(run,desired));
         if(id.startsWith('skill:'))return id===`skill:${character}`?800:700;
         if(id==='recovery')return run.hp<run.maxHp*.5?950:0;
         if(id==='greater:wick')return 990;if(id==='greater:lens')return 950;
         if(id.startsWith('greater:')||id.startsWith('apex:'))return 700;
         const preference=['ward','wick','echo','rekindle','pen','lens','amplifier','stroke','duality','quint','sept','battery','afterglow','glass','trinity','gold'];
         if(preference.includes(id))return 600-preference.indexOf(id)*5-relicLevel(run,id)*10;
         return id==='training'?300:id==='defense-boon'?400:100;
       };
       const relic=[...run.rewards].sort((a,b)=>value(b)-value(a))[0];
       run=e.resolveAction(run,{type:'reward',relic,revision:run.revision});rewardSteps++;
     } else {
       let best,bestValue=-Infinity;
       const ids=e.canUseSkill(run)?[undefined,character,...run.equippedSkills]:[undefined];
       for(const skillId of ids)for(const cell of e.legalOrigins(run,!!skillId,skillId)) {
         const p=e.previewAction(run,cell,!!skillId,skillId);
         // Never read hidden proc outcomes: use guaranteed HP, incoming risk and clearing.
         const value=(p.defeated?1e9:0)+Math.min(run.enemyHp,p.damage)-p.received*15+(p.fullClear?5:0)-(skillId?.001:0);
         if(value>bestValue){bestValue=value;best={type:'play',cell,skill:!!skillId,skillId,revision:run.revision};}
       }
       if(!best)throw new Error('No action');run=e.resolveAction(run,best);const p=run.lastReport;
       casts++;if(casts%10===0)console.log('progress',JSON.stringify({character,desired,seed,casts,stage:run.stage,level:run.spellLevel,chain:p.path.length,hp:run.hp}));desiredUses+=best.skillId===desired?1:0;if(best.skillId)skills[best.skillId]=(skills[best.skillId]??0)+1;
       hpDamage+=p.ledger.hpDamage;overkill+=p.ledger.overkill;total+=p.damage;crossSheetCasts+=p.segments.length>1?1:0;
       if(total!==hpDamage+overkill)throw new Error('Damage ledger inconsistent');
     }
     if(run.revision%10===0||run.phase==='lost')parseSave(JSON.stringify({...save,run}));
   }
   const sample={character,desired,seed:101+seed,phase:run.phase,kills:run.stats.kills,casts,rewardSteps,desiredUses,skills,bestChain:run.stats.bestChain,level:run.spellLevel,maxHp:run.maxHp,lastIncoming:run.lastReport.incoming,lastShield:run.lastReport.shield,lastReceived:run.lastReport.received,hpDamage,overkill,total,crossSheetCasts};
   samples.push(sample);console.log(JSON.stringify(sample));
   mkdirSync('.runtime',{recursive:true});writeFileSync('.runtime/growth-balance.json',JSON.stringify({method:'Organic greedy guaranteed-outcome policy; starts at initial state, chooses real sampled rewards; extra skill preferences are cohorts, not pregranted. No human-play or optimal-balance claim.',runtime:process.version,elapsedSeconds:(performance.now()-began)/1000,seedsPerCharacterSkill:seeds,samples},null,2));
 }
}finally{await server.close();}
