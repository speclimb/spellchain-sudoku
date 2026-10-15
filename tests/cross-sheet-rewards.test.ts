import { describe, expect, it } from 'vitest';
import { dispatch, newSave, startRun } from '../src/game/engine';
import { relicValues } from '../src/game/growth';
import { applyGrowthReward, canTakeReward, rollRelicRewards, rollRewards, rollSkillRewards } from '../src/game/rewards';
import { parseSave } from '../src/game/storage';
import { Random, singles } from '../src/game/sudoku';
import type { CharacterId, RelicId, RewardId, Run, Save } from '../src/game/types';

const characters: CharacterId[] = ['fuse', 'scribe', 'lumen'];
function fixture(character: CharacterId = 'fuse', stage = 4): Save {
  const initial = newSave(); initial.meta.clears = 99;
  const save = startRun(initial, character, 73), run = save.run!;
  run.stage = stage; run.stats.kills = stage + 1; run.phase = 'reward';
  run.enemyHp = 0; run.cells = [...run.solution]; run.rewardStep = 'relic';
  return save;
}
function own(run: Run, id: RelicId, level = 1, tier = 1): void {
  if (!run.inventory.includes(id)) run.inventory.push(id);
  run.relicLevels![id] = level; run.acquisitionRank[id] = 1; run.tier[id] = tier;
}
const baseOf = (id: RewardId) => (id.startsWith('greater:') ? id.slice(8) : id.startsWith('apex:') ? id.slice(5) : id) as RelicId;
function expectValidOffers(run: Run, offers: RewardId[]): void {
  expect(offers).toHaveLength(3);
  expect(new Set(offers.map(baseOf)).size).toBe(3);
  expect(offers.every(id => canTakeReward({ ...run, rewardStep: 'relic' }, id))).toBe(true);
}
function rollAt(save: Save, stage: number): Save {
  const next = structuredClone(save), run = next.run!;
  run.stage = stage; run.stats.kills = stage + 1; run.phase = 'reward';
  run.enemyHp = 0; run.cells = [...run.solution]; run.lastReport = null;
  run.rewardStep = 'relic'; run.pendingRelicRewards = [];
  const random = new Random(run.randomState);
  run.rewards = rollRelicRewards(run, random); run.randomState = random.state;
  return next;
}
function choose(save: Save, relic: RewardId): Save {
  return dispatch(save, { type: 'reward', relic, revision: save.run!.revision });
}

describe('cross-sheet relic offer guarantees', () => {
  it.each(characters)('offers unowned wick from battle 3 for %s without losing an owned upgrade', character => {
    for (const stage of [2, 3, 4, 5, 9, 14, 30]) {
      const run = fixture(character, stage).run!; own(run, 'pen');
      const before = structuredClone(run);
      for (let seed = 0; seed < 100; seed++) {
        const offers = rollRelicRewards(run, new Random(seed));
        expectValidOffers(run, offers); expect(offers).toContain('wick');
        expect(offers.some(id => baseOf(id) === 'pen')).toBe(true);
        expect(offers).not.toContain('greater:wick');
      }
      expect(run).toEqual(before);
    }
  });

  it.each(characters)('guarantees greater:wick on every eligible boss for %s, including max-level wick', character => {
    for (const stage of [4, 9, 14, 49]) for (const level of [1, 5, 10]) {
      const run = fixture(character, stage).run!;
      own(run, 'wick', level); own(run, 'pen'); own(run, 'battery'); own(run, 'lens');
      const before = structuredClone(run);
      for (let seed = 0; seed < 100; seed++) {
        const offers = rollRelicRewards(run, new Random(seed));
        expectValidOffers(run, offers); expect(offers).toContain('greater:wick');
        expect(offers).not.toContain('wick'); expect(offers).not.toContain('apex:wick');
        expect(offers.some(id => run.pool.includes(id as RelicId) && !run.inventory.includes(id as RelicId))).toBe(true);
      }
      expect(run).toEqual(before); expect(relicValues(run, 'wick').carry).toBe(false);
    }
  });

  it('keeps versionless first and second battle rolls unchanged', () => {
    const expected: Record<CharacterId, RewardId[]> = {
      fuse: ['glass', 'echo', 'sept'], scribe: ['glass', 'pen', 'sept'], lumen: ['glass', 'battery', 'sept'],
    };
    for (const character of characters) for (const stage of [0, 1]) {
      const random = new Random(73);
      const run = fixture(character, stage).run!; delete run.relicBalanceVersion;
      expect(rollRewards(run, random)).toEqual(expected[character]);
      expect(random.state).toBe(775954742);
    }
  });

  it('keeps offering after repeated declines, late acquisition, and declined boss upgrades', () => {
    let save = fixture('scribe', 2);
    for (const stage of [2, 3, 4, 5, 6, 7, 8]) {
      save = rollAt(save, stage);
      expect(save.run!.rewards).toContain('wick');
      save = choose(save, stage === 8 ? 'wick' : save.run!.rewards.find(id => id !== 'wick')!);
      expect(save.run!.inventory.includes('wick')).toBe(stage === 8);
    }
    for (const stage of [9, 14, 19]) {
      save = rollAt(save, stage);
      expect(save.run!.rewards).toContain('greater:wick');
      save = choose(save, stage === 19 ? 'greater:wick' : save.run!.rewards.find(id => id !== 'greater:wick')!);
      expect(relicValues(save.run!, 'wick').carry).toBe(stage === 19);
    }
    save = rollAt(save, 24);
    expect(save.run!.rewards).not.toContain('greater:wick');
  });

  it('handles a missing pool entry and exhausted remaining relics without inserting an invalid choice', () => {
    for (const stage of [2, 4, 9]) {
      const run = fixture('lumen', stage).run!; run.pool = run.pool.filter(id => id !== 'wick'); own(run, 'pen');
      for (let seed = 0; seed < 100; seed++) {
        const offers = rollRelicRewards(run, new Random(seed));
        expectValidOffers(run, offers); expect(offers.some(id => baseOf(id) === 'wick')).toBe(false);
        expect(offers.some(id => baseOf(id) === 'pen')).toBe(true);
        expect(offers.some(id => run.pool.includes(id as RelicId) && !run.inventory.includes(id as RelicId))).toBe(true);
      }
    }
    const run = fixture().run!; run.pool = ['wick']; own(run, 'wick', 10);
    for (let seed = 0; seed < 20; seed++) {
      const offers = rollRelicRewards(run, new Random(seed));
      expectValidOffers(run, offers); expect(offers).toContain('greater:wick');
      expect(offers.filter(id => ['training', 'vitality', 'recovery', 'magic-boon', 'defense-boon'].includes(id))).toHaveLength(2);
    }
  });

  it('does not offer upper wick outside bosses or after the upper tier was chosen', () => {
    for (const stage of [2, 3, 5, 8, 10]) {
      const run = fixture('scribe', stage).run!; own(run, 'wick');
      for (let seed = 0; seed < 40; seed++) {
        const offers = rollRelicRewards(run, new Random(seed));
        expectValidOffers(run, offers); expect(offers).not.toContain('greater:wick');
      }
    }
    for (const tier of [2, 3]) {
      const run = fixture().run!; own(run, 'wick', 5, tier);
      for (let seed = 0; seed < 40; seed++) {
        const offers = rollRelicRewards(run, new Random(seed));
        expectValidOffers(run, offers); expect(offers).not.toContain('greater:wick');
      }
    }
  });

  it('keeps versionless skill rolls separate and preserves their original reward RNG draws', () => {
    const run = fixture('lumen').run!; own(run, 'wick'); run.rewardStep = 'skill';
    delete run.relicBalanceVersion;
    const before = structuredClone(run);
    for (let seed = 0; seed < 100; seed++) {
      const skills = rollRewards(run, new Random(seed));
      expect(skills).toEqual(rollSkillRewards(run, new Random(seed)));
      expect(skills.every(id => id.startsWith('skill:'))).toBe(true);
      expect(skills).toContain('skill:lumen');
      const random = new Random(seed), replay = new Random(seed), reference = new Random(seed);
      const relics = rollRelicRewards(run, random);
      expect(relics).toEqual(rollRelicRewards(run, replay)); expect(random.state).toBe(replay.state);
      // With only wick owned, the original roll shuffles its two variants, the
      // 16 candidates, three fillers, and three final choices, in that order.
      reference.shuffle(['wick', 'greater:wick']); reference.shuffle(run.pool);
      reference.shuffle(['training', 'vitality', 'recovery']); reference.shuffle([0, 1, 2]);
      expect(random.state).toBe(reference.state); expect(relics).toContain('greater:wick');
    }
    expect(run).toEqual(before);
  });

  it('only enables cross-sheet carry when the player actually selects greater:wick', () => {
    const run = fixture().run!; own(run, 'wick');
    const offers = rollRelicRewards(run, new Random(41));
    expect(offers).toContain('greater:wick'); expect(relicValues(run, 'wick').carry).toBe(false);
    applyGrowthReward(run, offers.find(id => id !== 'greater:wick')!);
    expect(relicValues(run, 'wick').carry).toBe(false);
    applyGrowthReward(run, 'greater:wick'); expect(relicValues(run, 'wick').carry).toBe(true);
  });
});

describe('already sampled rewards and saves', () => {
  it.each(characters)('persists a newly rolled boss guarantee through both reward steps for %s', character => {
    const save = fixture(character), run = save.run!; own(run, 'wick');
    run.phase = 'battle'; run.rewardStep = undefined; run.enemyHp = 1; run.stats.kills = 4;
    run.cells = run.givens.map((given, cell) => given ? run.solution[cell] : 0);
    const before = structuredClone(save);
    const defeated = dispatch(save, { type: 'play', cell: singles(run.cells)[0], skill: false, revision: run.revision });
    expect(save).toEqual(before);
    expect(defeated.run!.rewardStep).toBe('skill');
    expect(defeated.run!.rewards.every(id => id.startsWith('skill:'))).toBe(true);
    expect(defeated.run!.pendingRelicRewards).toContain('greater:wick');
    const loaded = parseSave(JSON.stringify(defeated)); expect(loaded).toEqual(defeated);
    const next = choose(loaded, `skill:${character}`);
    expect(next.run!.randomState).toBe(loaded.run!.randomState);
    expect(next.run!.rewards).toEqual(loaded.run!.pendingRelicRewards);
    const selected = choose(next, 'greater:wick');
    expect(selected.run!.phase).toBe('battle'); expect(selected.run!.stage).toBe(5);
    expect(relicValues(selected.run!, 'wick').carry).toBe(true);
    expect(parseSave(JSON.stringify(selected))).toEqual(selected);
  });

  it('preserves a pre-change pending boss roll through reload and the skill-to-relic transition', () => {
    const save = fixture('scribe'), run = save.run!; own(run, 'wick');
    run.rewardStep = 'skill'; run.rewards = ['skill:scribe', 'skill:bridge', 'skill:pierce'];
    run.pendingRelicRewards = ['pen', 'wick', 'lens'];
    const before = structuredClone(save), loaded = parseSave(JSON.stringify(save));
    expect(loaded).toEqual(before);
    const next = choose(loaded, 'skill:scribe');
    expect(next.run!.rewards).toEqual(before.run!.pendingRelicRewards);
    expect(next.run!.pendingRelicRewards).toEqual([]); expect(next.run!.rewardStep).toBe('relic');
    expect(next.run!.randomState).toBe(before.run!.randomState);
    expect(next.run!.tier.wick).toBe(1); expect(next.run!.rewards).not.toContain('greater:wick');
    expect(parseSave(JSON.stringify(next))).toEqual(next);
    const accepted = choose(next, 'wick');
    expect(accepted.run!.relicLevels!.wick).toBe(2); expect(accepted.run!.tier.wick).toBe(1);
  });

  it('preserves saved ordinary and boss relic choices that omit the new guarantee', () => {
    for (const stage of [2, 4]) {
      const save = fixture('lumen', stage), run = save.run!;
      if (stage === 4) own(run, 'wick');
      run.rewards = ['pen', 'battery', 'lens'];
      const loaded = parseSave(JSON.stringify(save));
      expect(loaded).toEqual(save); expect(loaded.run!.randomState).toBe(run.randomState);
      const next = choose(loaded, 'pen');
      expect(next.run!.inventory.includes('wick')).toBe(stage === 4);
      expect(relicValues(next.run!, 'wick').carry).toBe(false);
    }
  });

  it('leaves legacy sampling, migration, and already offered choices unchanged', () => {
    for (const character of characters) {
      const run = fixture(character).run!; run.rewardStep = 'legacy';
      const random = new Random(73);
      expect(rollRewards(run, random)).toEqual(['skill-upgrade', 'greater:quint', 'greater:wick']);
      expect(random.state).toBe(3330908523);
    }
    const save = fixture('scribe'), run = save.run!;
    run.rewards = ['skill-upgrade', 'greater:lens', 'greater:quint'];
    delete run.expansionVersion; delete run.enemyRulesVersion; delete run.skillLevels; delete run.equippedSkills;
    delete run.relicLevels; delete run.rewardStep; delete run.pendingRelicRewards; delete run.contributions;
    const loaded = parseSave(JSON.stringify(save));
    expect(loaded.run!.rewardStep).toBe('legacy'); expect(loaded.run!.rewards).toEqual(run.rewards);
    expect(loaded.run!.randomState).toBe(run.randomState); expect(loaded.run!.inventory).toEqual(run.inventory);
    const next = choose(loaded, 'greater:lens');
    expect(next.run!.tier.lens).toBe(2); expect(next.run!.inventory).not.toContain('wick');
  });
});
