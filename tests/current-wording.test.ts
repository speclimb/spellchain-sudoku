import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHARACTERS, RELICS, greaterIds, relicDescription, rewardOf, rewardProgression, skillDescription } from '../src/game/content';
import { newSave, startRun, resolveAction, previewAction, legalOrigins } from '../src/game/engine';
import { relicGrowthDescription, relicNextDescription, relicValues, SKILLS, skillDescriptionFor, skillNextDescription } from '../src/game/growth';
import type { RelicId, RewardId, Run } from '../src/game/types';

const fixture = (): Run => structuredClone(startRun(newSave(), 'fuse', 51).run!);
const own = (run: Run, id: RelicId, lv = 1, tier = 1) => {
  run.inventory = [id]; run.relicLevels = { [id]: lv }; run.tier = { [id]: tier };
  run.acquisitionRank = { [id]: Math.min(3, lv) };
};
const reward = (run: Run, id: RewardId): Run => {
  run.stage = 4; run.phase = 'reward'; run.rewardStep ??= 'relic'; run.rewards = [id];
  return resolveAction(run, { type: 'reward', relic: id, revision: run.revision });
};

describe('current-effect descriptions', () => {
  it('catalog, owned and character descriptions derive from the same current values', () => {
    for (const relic of RELICS) {
      const run = fixture(); own(run, relic.id);
      expect(relic.description).toBe(relicGrowthDescription(run, relic.id));
      expect(relicDescription(relic.id)).toBe(relic.description);
    }
    for (const character of CHARACTERS) {
      const save = newSave(); save.meta.clears = 12;
      const run = startRun(save, character.id, 51).run!;
      expect(skillDescription(run)).toBe(skillDescriptionFor(run, character.id));
    }
  });
  it('current effects do not mix in future unlocks, historical multipliers or currency metaphors', () => {
    for (const lv of [1, 2, 4, 5, 9, 10]) for (const tier of [1, 2, 3]) {
      for (const relic of RELICS) {
        const run = fixture(); own(run, relic.id, lv, tier);
        expect(relicDescription(relic.id, run)).not.toMatch(/無料|有料|旧倍率|旧効果|最大3枚|上位で|極位で|通常より/);
      }
      for (const skill of SKILLS) {
        const run = fixture(); run.skillLevels = { [skill.id]: lv };
        expect(skillDescriptionFor(run, skill.id)).not.toMatch(/Lv\.|習得。|無料|有料/);
      }
    }
  });
  it('shows the current quint capacity and names the consumed resource', () => {
    const run = fixture();
    for (const tier of [1, 2, 3]) {
      own(run, 'quint', 1, tier);
      expect(relicDescription('quint', run)).toContain(`詠唱符${tier}枚を獲得（所持上限${tier}枚）`);
      expect(relicDescription('quint', run)).toContain('魔力・蓄電を温存');
    }
    own(run, 'echo'); expect(relicDescription('echo', run)).toContain('連鎖詠唱数は消費しない');
    expect(relicDescription('echo', run)).not.toContain('＋0');
    own(run, 'amplifier'); expect(relicDescription('amplifier', run)).toContain('＋35％');
    expect(relicDescription('amplifier', run)).toContain('詠唱符の使用時も有効');
  });
  it('keeps growth previews separate from current effects', () => {
    const run = fixture(); own(run, 'wick');
    expect(relicDescription('wick', run)).toBe('連鎖詠唱数＋1。');
    expect(relicNextDescription(run, 'wick')).toContain('次：Lv.2');
    expect(skillDescriptionFor(run, 'fuse')).not.toContain('飛び火');
    expect(skillNextDescription(run, 'fuse')).toContain('飛び火');
    run.skillLevels!.bastion = 5;
    expect(skillDescriptionFor(run, 'bastion')).toContain('最大シート守護＋一時守護');
    run.skillLevels!.bridge = 5;
    expect(skillDescriptionFor(run, 'bridge')).toContain('その3マス分の通常攻撃の5倍を1回追撃');
  });
  it('preserves actual saved effects before balance migration', () => {
    for (const expanded of [false, true]) for (const relic of RELICS) {
      const run = fixture(); own(run, relic.id, 4, 2); delete run.relicBalanceVersion;
      if (!expanded) delete run.expansionVersion;
      expect(relicDescription(relic.id, run)).toBe(relicGrowthDescription(run, relic.id));
    }
  });
});

describe('selected reward text matches the applied result', () => {
  it.each(RELICS.map(relic => relic.id))('%s: new, level growth and evolution at every level/tier', id => {
    const run = fixture();
    expect(rewardOf(id, run).description).toContain(relicGrowthDescription(reward(run, id), id));
    for (const lv of [1, 4, 5, 9, 10]) for (const tier of [1, 2, 3]) {
      const before = fixture(); own(before, id, lv, tier); before.rewardStep = 'relic';
      const ids: RewardId[] = [];
      if (lv < 10) ids.push(id);
      if (tier === 1) ids.push(greaterIds.includes(id as typeof greaterIds[number]) ? `greater:${id}` as RewardId : `apex:${id}`);
      if (tier === 2 && lv >= 5) ids.push(`apex:${id}`);
      for (const chosen of ids) {
        const description = rewardOf(chosen, before).description;
        expect(description).toContain(`選択後：${relicGrowthDescription(reward(structuredClone(before), chosen), id)}`);
        expect(description).not.toContain('旧効果');
      }
    }
  });
  it('restores archived growth before evolving and uses the next battle balance', () => {
    for (const id of ['lens', 'quint', 'wick'] as const) {
      const run = fixture(); run.stowedRelics = { [id]: { level: 7, tier: 2, rank: 3 } }; run.rewardStep = 'relic';
      for (const chosen of [id, `greater:${id}` as RewardId]) {
        const actual = reward(structuredClone(run), chosen);
        expect(rewardOf(chosen, run).description).toContain(relicGrowthDescription(actual, id));
      }
    }
    for (const expanded of [false, true]) for (const id of greaterIds) {
      const run = fixture(); own(run, id, 1); delete run.relicBalanceVersion;
      if (!expanded) delete run.expansionVersion;
      run.rewardStep = 'legacy';
      const chosen = `greater:${id}` as RewardId, actual = reward(structuredClone(run), chosen);
      expect(rewardOf(chosen, run).description).toContain(relicGrowthDescription(actual, id));
      if (id === 'lens') expect(relicValues(actual, id).weakDamage).toBe(20);
    }
  });
  it('skill rewards show only the selected level and keep both boss steps intact', () => {
    for (const skill of SKILLS.filter(skill => ['fuse', 'bridge', 'pierce', 'bastion'].includes(skill.id))) for (const lv of [0, 1, 4, 9]) {
      if (skill.id === 'fuse' && lv === 0) continue;
      const run = fixture(); run.skillLevels = lv ? { [skill.id]: lv } : {}; run.skillRank = 1;
      run.rewardStep = 'skill'; run.pendingRelicRewards = ['wick', 'lens', 'pen'];
      const chosen = `skill:${skill.id}` as RewardId, actual = reward(structuredClone(run), chosen);
      expect(rewardOf(chosen, run).description).toContain(skillDescriptionFor(actual, skill.id));
      expect(actual.rewardStep).toBe('relic');
    }
  });
});

it('keeps obsolete cost language out of live source copy', () => {
  const files = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]);
  for (const path of files('src').filter(path => path.endsWith('.ts') && !path.endsWith('display-wording.ts'))) {
    expect(readFileSync(path, 'utf8'), path).not.toMatch(/無料|有料|自動入力/);
  }
});

// History is factual: normalize terminology for display without rewriting past effects.
import { historicalRewardDescription } from '../src/ui/display-wording';
it('normalizes historical resource names without changing values or stored descriptions', () => {
  const saved = '30％で無料スキル券1枚（所持上限1枚、最大3枚）。無料スキル中は抽選しない。旧倍率と重複しない。';
  const shown = historicalRewardDescription(saved);
  expect(shown).toContain('30％で詠唱符1枚（所持上限1枚、最大3枚）');
  expect(shown).not.toMatch(/無料|有料|旧倍率/);
  expect(saved).toContain('無料スキル券');
  expect(historicalRewardDescription('選択後：自動入力＋1回。')).toBe('連鎖詠唱数＋1。');
  expect(historicalRewardDescription('有料スキル直後。無料で飛び火。')).toBe('魔力を消費するスキル直後。連鎖詠唱数を消費せずに飛び火。');
});


it('reward badges use the actual level, restored tier and rank-only changes', () => {
  const run = fixture(); own(run, 'quint'); run.rewardStep = 'legacy';
  expect(rewardProgression('quint', run)).toBe('発動率 30％ → 45％');
  expect(rewardProgression('skill:bridge', run)).toBe('未習得 → Lv.1');
  run.inventory = []; run.relicLevels = {}; run.tier = {}; run.acquisitionRank = {};
  run.stowedRelics = { lens: { level: 7, tier: 3, rank: 1 } }; run.rewardStep = 'relic';
  const before = structuredClone(run);
  expect(rewardProgression('greater:lens', run)).toBe('Lv.7・極位で再取得');
  expect(rewardOf('greater:lens', run).description).not.toContain('段階を進化');
  expect(run).toEqual(before);
});


import { capacityText, explainStep } from '../src/ui/chain-guide';
it('distinguishes chain-spell capacity from the realized chain and excludes the origin cost', () => {
  const run = fixture();
  expect(capacityText(run, false)).toContain('起点1マス ＋ 連鎖詠唱数4 ＝ 最大5連鎖');
  const report = previewAction(run, legalOrigins(run)[0]);
  expect(report.chain!.steps[0].remainingBefore).toBe(4);
  expect(report.chain!.steps[0].remainingAfter).toBe(4);
  expect(explainStep(report, 0).budget).toContain('残り連鎖詠唱数');
});
