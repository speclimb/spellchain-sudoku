import { describe, expect, it } from 'vitest';
import { chainCapacity, dispatch, legalOrigins, longestOrigins, newSave, previewAction, resolveAction, startRun } from '../src/game/engine';
import { CAMPAIGN_BATTLES, FINAL_BOSS_ATTACK, FINAL_BOSS_ATTACK_RAMP, FINAL_BOSS_HP, PROGRESSION_FINAL_BOSS_HP, PROGRESSION_FINAL_BOSS_ATTACK, PROGRESSION_FINAL_BOSS_ATTACK_RAMP, enemyForRun, enemyIncoming, enemyIntent } from '../src/game/enemies';
import { parseSave } from '../src/game/storage';
import { awardRescueItems } from '../src/game/endgame';
import { skillValues } from '../src/game/growth';

function finalBattle() {
  const save = startRun(newSave(), 'fuse', 102, 'campaign');
  const run = save.run!;
  run.stage = 99; run.stats.kills = 99; run.enemyHp = enemyForRun(run).hp;
  save.history = undefined;
  return save;
}
describe('100 battle campaign', () => {
  it('strengthens the new campaign road at fixed waves while preserving old encounters', () => {
    const save = startRun(newSave(), 'fuse', 102, 'campaign'), run = save.run!;
    const old = structuredClone(run); delete old.progressionVersion;
    for (const stage of [0, 4, 14, 19]) {
      run.stage = old.stage = stage;
      expect(enemyForRun(run)).toEqual(enemyForRun(old));
    }
    run.stage = old.stage = 74;
    expect(enemyForRun(run).hp).toBeGreaterThan(enemyForRun(old).hp * 3);
    expect(enemyIncoming(run)).toBeGreaterThan(enemyIncoming(old));
    const fixed = enemyForRun(run);
    run.spellLevel = 5000; run.inventory = ['pen', 'glass'];
    expect(enemyForRun(run)).toEqual(fixed);
    run.stage = old.stage = 99;
    expect(enemyForRun(old).hp).toBe(FINAL_BOSS_HP);
    expect(enemyForRun(run).hp).toBe(PROGRESSION_FINAL_BOSS_HP);
    for (const turn of [0, 7, 14]) {
      run.turn = old.turn = turn;
      expect(enemyIncoming(old)).toBe(FINAL_BOSS_ATTACK + turn * FINAL_BOSS_ATTACK_RAMP);
      expect(enemyIncoming(run)).toBe(PROGRESSION_FINAL_BOSS_ATTACK + turn * PROGRESSION_FINAL_BOSS_ATTACK_RAMP);
    }
  });
  it('keeps explicit modes and legacy endless saves separate', () => {
    const campaign = finalBattle();
    const endless = startRun(newSave(), 'fuse', 102, 'endless'); endless.run!.stage = 99;
    expect(enemyForRun(campaign.run!).hp).toBe(PROGRESSION_FINAL_BOSS_HP);
    expect(enemyForRun(endless.run!).hp).not.toBe(FINAL_BOSS_HP);
    expect(parseSave(JSON.stringify(campaign))).toEqual(campaign);
    const legacy = startRun(newSave(), 'fuse', 102); delete legacy.run!.mode; delete legacy.run!.progressionVersion;
    expect(parseSave(JSON.stringify(legacy)).run!.mode).toBeUndefined();
  });
  it('raises the final boss counter every turn independently of player growth and inventory', () => {
    const run = finalBattle().run!, base = enemyIncoming(run);
    for (let turn = 0; turn < 20; turn++) {
      run.turn = turn;
      expect(enemyIncoming(run)).toBe(base + turn * PROGRESSION_FINAL_BOSS_ATTACK_RAMP);
      expect(enemyIntent(run).nextIncoming).toBe(base + (turn + 1) * PROGRESSION_FINAL_BOSS_ATTACK_RAMP);
    }
    run.spellLevel = 9999; run.inventory = ['glass', 'trinity'];
    expect(enemyForRun(run).hp).toBe(PROGRESSION_FINAL_BOSS_HP);
  });
  it('ends on the hundredth kill, persists victory and records it once', () => {
    const save = finalBattle(), run = save.run!;
    run.enemyHp = 1;
    const action = { type: 'play' as const, cell: legalOrigins(run)[0], skill: false, revision: run.revision };
    const next = dispatch(save, action);
    expect(next.run!.phase).toBe('won'); expect(next.run!.stats.kills).toBe(CAMPAIGN_BATTLES);
    expect(next.meta.wins).toBe(1); expect(next.run!.rewards).toEqual([]);
    expect(next.run!.rewardStep).toBeUndefined(); expect(next.run!.pendingRelicRewards).toEqual([]);
    expect(parseSave(JSON.stringify(next))).toEqual(next);
    expect(() => dispatch(next, action)).toThrow();
    expect(() => resolveAction(next.run!, { type: 'reward', relic: 'training', revision: next.run!.revision })).toThrow();
    expect(() => resolveAction(next.run!, { ...action, revision: next.run!.revision })).toThrow();
  });
  it('continues endless beyond the hundredth kill', () => {
    let run = startRun(newSave(), 'fuse', 102, 'endless').run!;
    run.stage = 99; run.stats.kills = 99; run.enemyHp = 1;
    run = resolveAction(run, { type: 'play', cell: legalOrigins(run)[0], skill: false, revision: run.revision });
    expect(run.phase).toBe('reward');
    run = resolveAction(run, { type: 'reward', relic: run.rewards[0], revision: run.revision });
    run = resolveAction(run, { type: 'reward', relic: run.rewards[0], revision: run.revision });
    expect(run.stage).toBe(100); expect(run.phase).toBe('battle');
  });
  it('lets late normal casts exhaust hundreds of fuel without requiring wick and keeps previews pure', () => {
    for (const seed of [102, 104, 106]) {
      const run = startRun(newSave(), 'fuse', seed, 'campaign').run!;
      run.spellLevel = 300; run.stage = 99; run.stats.kills = 99; run.enemyHp = enemyForRun(run).hp;
      run.hp = run.maxHp = 5000; awardRescueItems(run);
      const before = structuredClone(run), best = longestOrigins(run);
      expect(best.length).toBe(chainCapacity(run) + 1);
      const prediction = previewAction(run, best.cells[0]);
      expect(run).toEqual(before);
      const after = resolveAction(run, { type: 'play', cell: best.cells[0], skill: false, revision: run.revision });
      expect(after.lastReport!.path).toEqual(prediction.path);
      expect(after.lastReport!.damage).toBe(prediction.damage);
      expect(after.lastReport!.received).toBe(prediction.received);
      expect(after.lastReport!.sheetsCompleted).toBeGreaterThan(7);
      expect(after.lastReport!.healed).toBe(60);
      expect(after.turn).toBe(1);
      const save = newSave(); save.run = after;
      expect(parseSave(JSON.stringify(save)).run).toEqual(after);
    }
  });
  it('keeps every campaign skill upgrade meaningful and endless multipliers unchanged', () => {
    const campaign = startRun(newSave(), 'fuse', 102, 'campaign').run!;
    for (const id of ['scribe', 'lumen', 'bastion'] as const) {
      const field = id === 'scribe' ? 'completionMultiplier' : id === 'lumen' ? 'damageMultiplier' : 'situationalAttack';
      let previous = 0;
      for (let level = 1; level <= 10; level++) {
        campaign.skillLevels = { [id]: level };
        const current = skillValues(campaign, id)[field];
        expect(current).toBeGreaterThan(previous); previous = current;
      }
      expect(skillValues({ ...campaign, campaignVersion: undefined }, id)[field]).toBeGreaterThan(previous);
    }
  });
});
