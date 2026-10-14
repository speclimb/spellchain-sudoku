/** Paired deterministic-policy evidence. No player-adaptive HP; combat and procs stay real.
 * Examples:
 *   CHARACTERS=fuse SEEDS=102,103 POLICIES=early MODES=baseline,guarantee,candidate node scripts/cross-sheet-balance.mjs
 *   MODES=production OUTPUT=.runtime/cross-sheet-final.json node scripts/cross-sheet-balance.mjs
 * START_STATE resumes an explicitly labelled natural checkpoint; SYNTHETIC_WAVE changes only its wave for controlled fixtures.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const root=process.cwd(), output=process.env.OUTPUT??'.runtime/cross-sheet-balance.json';
mkdirSync('.runtime',{recursive:true});
const chars=(process.env.CHARACTERS??'fuse,scribe,lumen').split(',');
const seeds=(process.env.SEEDS??'102,103').split(',').map(Number);
const policies=(process.env.POLICIES??'early,defer,decline').split(',');
const modes=(process.env.MODES??'baseline,guarantee,candidate').split(',');
const stageLimit=Number(process.env.STAGE_LIMIT??90);
const desired=process.env.DESIRED??'bridge';
const baselineRef=process.env.BASELINE_REF??'356aafb';
const baselineRoot=process.env.BASELINE_ROOT??'.runtime/cross-sheet-baseline';
if(process.env.SYNTHETIC_WAVE&&modes.includes('production'))throw new Error('SYNTHETIC_WAVE is only supported in explicit override modes; use natural START_STATE for production.');
if(!existsSync(`${baselineRoot}/src/game/engine.ts`)){
 mkdirSync(baselineRoot,{recursive:true});
 try{const archive=execFileSync('git',['archive',baselineRef,'src'],{maxBuffer:64*1024*1024});execFileSync('tar',['-xf','-','-C',baselineRoot],{input:archive});}
 catch(error){throw new Error(`Could not prepare baseline ${baselineRef}. Set BASELINE_REF to the public baseline commit or BASELINE_ROOT to a directory containing src/game/engine.ts. ${error.message}`);}
}
// Ref changes must never silently reuse a different cached source tree.
for(const file of execFileSync('git',['ls-tree','-r','--name-only',baselineRef,'src/game'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)){
 const cached=`${baselineRoot}/${file}`, expected=execFileSync('git',['show',`${baselineRef}:${file}`],{maxBuffer:64*1024*1024});
 if(!existsSync(cached)||!readFileSync(cached).equals(expected))throw new Error(`Cached baseline differs from ${baselineRef}: ${cached}. Use a new BASELINE_ROOT directory or the matching BASELINE_REF.`);
}
const began=performance.now(), processTag=`${process.pid}`;
const sourceHashes={};
const engines={};
for(const name of ['baseline','current']) {
 const source=name==='baseline'?`${baselineRoot}/src`:'src';
 const entry=`export * from '${resolve(source+'/game/engine.ts')}';export * from '${resolve(source+'/game/growth.ts')}';export * from '${resolve(source+'/game/enemies.ts')}';export {enemyOf} from '${resolve(source+'/game/content.ts')}';export {parseSave} from '${resolve(source+'/game/storage.ts')}';`;
 sourceHashes[name]=Object.fromEntries(['engine','rewards','growth','enemies','content','types','storage'].map(file=>[file,createHash('sha256').update(readFileSync(`${source}/game/${file}.ts`)).digest('hex')]));
 const bundle=resolve(`.runtime/cross-sheet-${processTag}-${name}.mjs`);
 await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:bundle,logLevel:'silent'});
 engines[name]=await import(`file://${bundle}`);
}
const curves={
 baseline:{normal:0,bossLinear:0,bossQuad:0},
 guarantee:{normal:0,bossLinear:0,bossQuad:0},
 mild:{normal:.01,bossLinear:.025,bossQuad:.0006},
 candidate:{normal:.012,bossLinear:.04,bossQuad:.0015},
 strong:{normal:.015,bossLinear:.05,bossQuad:.0025},
 production:null,
};
function enemyHp(e,run,mode){
 if(mode==='production')return e.enemyForRun(run).hp;
 const base=e.enemyOf(run.stage,run.balanceVersion),excess=Math.max(0,run.stage+1-15),c=curves[mode];
 return Math.min(Number.MAX_SAFE_INTEGER,Math.round(base.hp*(1+(base.isBoss?c.bossLinear*excess+c.bossQuad*excess**2:c.normal*excess))));
}
function rewardValue(e,run,id,policy){
 const wave=run.stage+1,hasCarry=(run.tier.wick??1)>=2;
 if(!hasCarry && (id==='greater:wick'||id==='apex:wick')) {
  if(policy==='decline'||policy==='no-carry'||policy==='defer'&&wave<45)return -1000;
  return 1200;
 }
 if(id==='wick'&&!run.inventory.includes('wick'))return policy==='decline'?-1000:1150;
 if(id===`skill:${desired}`)return 1000+(10-e.skillLevel(run,desired));
 if(id.startsWith('skill:'))return id===`skill:${run.character}`?800:700;
 if(id==='recovery')return run.hp<run.maxHp*.5?950:0;
 if(id==='greater:wick')return 990;if(id==='greater:lens')return 950;
 if(id.startsWith('greater:')||id.startsWith('apex:'))return 700;
 const preference=['ward','wick','echo','rekindle','pen','lens','amplifier','stroke','duality','quint','sept','battery','afterglow','glass','trinity','gold'];
 if(preference.includes(id))return 600-preference.indexOf(id)*5-e.relicLevel(run,id)*10;
 return id==='training'?300:id==='defense-boon'?400:100;
}
function summarize(battles){
 const killed=battles.filter(x=>x.defeated&&!x.lost),ones=killed.filter(x=>x.casts===1);
 const castCount=battles.reduce((a,x)=>a+x.casts,0),totalDamage=battles.reduce((a,x)=>a+x.damage,0),overkill=battles.reduce((a,x)=>a+x.overkill,0);
 let longestOneShot=0,oneShot=0,longestUnchallenged=0,unchallenged=0;
 for(const b of battles){oneShot=b.defeated&&!b.lost&&b.casts===1?oneShot+1:0;longestOneShot=Math.max(longestOneShot,oneShot);unchallenged=b.defeated&&!b.lost&&b.received===0?unchallenged+1:0;longestUnchallenged=Math.max(longestUnchallenged,unchallenged);}
 return {attempted:battles.length,killed:killed.length,oneShot:ones.length,oneShotRate:killed.length?ones.length/killed.length:null,casts:castCount,castsPerAttempt:battles.length?castCount/battles.length:null,castsPerSuccessfulKill:killed.length?killed.reduce((a,x)=>a+x.casts,0)/killed.length:null,maxSuccessfulCasts:killed.length?Math.max(...killed.map(x=>x.casts)):null,damage:totalDamage,overkill,overkillShare:totalDamage?overkill/totalDamage:null,longestOneShot,longestUnchallenged,received:battles.reduce((a,x)=>a+x.received,0)};
}
function windowSummary(battles){return Object.fromEntries([[1,15],[16,30],[31,45],[46,90],[91,130]].map(([from,to])=>{const b=battles.filter(x=>x.wave>=from&&x.wave<=to);return [`${from}-${to}`,{all:summarize(b),normal:summarize(b.filter(x=>!x.boss)),boss:summarize(b.filter(x=>x.boss))}];}));}
const samples=[];
const method={description:'Same seeds, fixed reward policy and guaranteed-outcome greedy action policy; each organic run starts at initial state. Baseline source is identified by baselineRef and verified file hashes. Guarantee mode uses current reward implementation and old HP. Curve modes use current rewards and fixed wave-only HP. Production uses shipped enemyForRun HP. Changed rewards and longer combat legitimately diverge later boards and cast-index procs.',policy:'Choose guaranteed kill first, then min(enemyHp, guaranteed damage) minus 15*received + 5 for full clear; no hidden proc outcome lookup. Early prioritizes missing wick and upper wick, defer chooses normal wick but refuses carry until wave45, decline refuses both normal and upper wick; no-carry acquires normal wick but refuses upper carry. Additional skill preference '+desired+'.',limits:'Not human balance validation or an optimal solver. One-shot denominator is killed battles only, deaths are never one-shots; attempted/killed and survival are reported. Unchallenged means won with zero HP damage, not necessarily no enemy attack. No invented extra player stats in organic runs.',stageLimit,baselineRef,baselineRoot,curves,sourceHashes,runtime:process.version};
function persist(){writeFileSync(output,JSON.stringify({method,elapsedSeconds:(performance.now()-began)/1000,samples},null,2));}
for(const character of chars)for(const seed of seeds)for(const policy of policies)for(const mode of modes){
 if(!(mode in curves))throw new Error(`Unknown mode ${mode}`);
 const e=engines[mode==='baseline'?'baseline':'current'];
 const save=e.newSave();save.meta.clears=99;let run=process.env.START_STATE?JSON.parse(readFileSync(process.env.START_STATE,'utf8')):e.startRun(save,character,seed).run;
 if(process.env.START_STATE&&(run.character!==character||run.seed!==seed))throw new Error('Checkpoint identity mismatch');
 const startWave=run.stage+1;
 if(process.env.SYNTHETIC_WAVE){run.stage=Number(process.env.SYNTHETIC_WAVE)-1;run.turn=0;run.phase='battle';run.lastReport=null;}
 const endStage=process.env.ONE_BATTLE==='1'?run.stage+1:stageLimit;
 if(mode!=='production')run.enemyHealthVersion=0;
 const result={character,seed,policy,mode,desired,scenarioKind:process.env.SYNTHETIC_WAVE?'controlled-wave-fixture':process.env.START_STATE?'natural-checkpoint-fork':'organic',startWave,startStatePath:process.env.START_STATE??null,initialCheckpoint:process.env.START_STATE?{wave:run.stage+1,level:run.spellLevel,hp:run.hp,maxHp:run.maxHp,castCounter:run.castCounter,randomState:run.randomState,skills:{...run.skillLevels},relics:{...run.relicLevels},tiers:{...run.tier},acquisitionRanks:{...run.acquisitionRank}}:null,firstNormalOffer:null,firstNormalAcquisition:null,firstUpperOffer:null,firstUpperAcquisition:null,rewards:[],battles:[],casts:[],checkpoints:[]};
 let battle=null,seenStage=-1;
 while((run.phase==='battle'||run.phase==='reward')&&run.stage<endStage){
  if(run.castCounter>3000)throw new Error('Organic run exceeded 3000 casts');
  if(run.phase==='reward'){
   if(run.rewards.includes('wick'))result.firstNormalOffer??=run.stage+1;
   if(run.rewards.includes('greater:wick'))result.firstUpperOffer??=run.stage+1;
   const choice=[...run.rewards].sort((a,b)=>rewardValue(e,run,b,policy)-rewardValue(e,run,a,policy))[0];
   result.rewards.push({wave:run.stage+1,step:run.rewardStep,choices:[...run.rewards],selected:choice,level:run.spellLevel,wick:e.relicLevel(run,'wick'),tier:run.tier.wick??1});
   if(choice==='wick'&&!run.inventory.includes('wick'))result.firstNormalAcquisition=run.stage+1;
   if((choice==='greater:wick'||choice==='apex:wick')&&(run.tier.wick??1)<2)result.firstUpperAcquisition=run.stage+1;
   run=e.resolveAction(run,{type:'reward',relic:choice,revision:run.revision});
   if(mode!=='production')run.enemyHealthVersion=0;
   continue;
  }
  if(run.stage!==seenStage){
   seenStage=run.stage;const plannedHp=enemyHp(e,run,mode);
   if(mode==='production'&&run.enemyHp!==plannedHp)throw new Error('Production encounter HP disagrees with enemyForRun');
   if(mode!=='production')run.enemyHp=plannedHp;
   const actual=e.enemyOf(run.stage,run.balanceVersion);
   battle={wave:run.stage+1,boss:actual.isBoss,enemyMaxHp:run.enemyHp,baseHp:actual.hp,attack:actual.attack,carry:(run.tier.wick??1)>=2,level:run.spellLevel,casts:0,damage:0,overkill:0,received:0,defeated:false,lost:false,procTriggers:0};
   if([15,30,45,60,90,120].includes(run.stage+1))result.checkpoints.push({wave:run.stage+1,level:run.spellLevel,hp:run.hp,maxHp:run.maxHp,skillLevels:{...run.skillLevels},relicLevels:{...run.relicLevels},tiers:{...run.tier},acquisitionRanks:{...run.acquisitionRank}});
   if(process.env.SAVE_CHECKPOINTS==='1'&&[44,45,59,60,89,90,119,120].includes(run.stage))writeFileSync(`.runtime/cross-sheet-state-${character}-${seed}-${policy}-${mode}-${run.stage+1}.json`,JSON.stringify(run));
  }
  let best,bestValue=-Infinity;
  const ids=e.canUseSkill(run)?[undefined,character,...run.equippedSkills]:[undefined];
  for(const skillId of ids)for(const cell of e.legalOrigins(run,!!skillId,skillId)){
   const p=e.previewAction(run,cell,!!skillId,skillId);
   const value=(p.defeated?1e9:0)+Math.min(run.enemyHp,p.damage)-p.received*15+(p.fullClear?5:0)-(skillId?.001:0);
   if(value>bestValue){bestValue=value;best={type:'play',cell,skill:!!skillId,skillId,revision:run.revision};}
  }
  if(!best)throw new Error('No legal action');
  const before={wave:run.stage+1,boss:battle.boss,enemyMaxHp:battle.enemyMaxHp,enemyHp:run.enemyHp,level:run.spellLevel,carry:battle.carry,turn:run.turn};
  run=e.resolveAction(run,best);const p=run.lastReport;
  const cast={...before,damage:p.damage,guaranteedDamage:p.guaranteedDamage,damageToMaxHp:p.damage/battle.enemyMaxHp,chain:p.path.length,sheets:p.sheetsCompleted??0,segments:p.segments?.length??1,received:p.received,incoming:p.incoming,shield:p.shield,hp:run.hp,maxHp:run.maxHp,levelAfter:run.spellLevel,defeated:p.defeated,skill:best.skillId??null,overkill:p.ledger?.overkill??0,procs:p.procs??[]};
  result.casts.push(cast);battle.casts++;battle.damage+=p.damage;battle.overkill+=cast.overkill;battle.received+=p.received;battle.procTriggers+=cast.procs.filter(x=>x.triggered).length;
  if(battle.casts===1)battle.firstDamageRatio=cast.damageToMaxHp;
  if(p.defeated||run.phase==='lost'){battle.defeated=p.defeated;battle.lost=run.phase==='lost';result.battles.push(battle);battle=null;}
 }
 result.final={phase:run.phase,kills:run.stats.kills,deathWave:run.phase==='lost'?run.stage+1:null,censored:run.phase!=='lost'&&run.stage>=endStage,level:run.spellLevel,hp:run.hp,maxHp:run.maxHp,bestChain:run.stats.bestChain,casts:result.casts.length,skills:{...run.skillLevels},relics:{...run.relicLevels},tiers:{...run.tier},acquisitionRanks:{...run.acquisitionRank}};
 result.summary={all:summarize(result.battles),normal:summarize(result.battles.filter(x=>!x.boss)),boss:summarize(result.battles.filter(x=>x.boss)),windows:windowSummary(result.battles),crossSheetCasts:result.casts.filter(x=>x.segments>1).length,procTriggers:result.casts.flatMap(x=>x.procs).filter(x=>x.triggered).length};
 if(mode==='production'&&!process.env.SYNTHETIC_WAVE){e.parseSave(JSON.stringify({...save,run}));result.saveRoundTripValidated=true;}
 samples.push(result);persist();
 console.log(JSON.stringify({character,seed,policy,mode,normalAt:result.firstNormalAcquisition,upperOffer:result.firstUpperOffer,upperAt:result.firstUpperAcquisition,...result.final,late:result.summary.windows['46-90'],elapsedSeconds:Math.round((performance.now()-began)/1000)}));
}
