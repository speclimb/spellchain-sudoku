import { describe, expect, test } from 'vitest';
import { newSave, startRun } from '../src/game/engine';
import { parseSave } from '../src/game/storage';

describe('readability preference compatibility', () => {
  test('old saves without a text preference preserve the complete adventure', () => {
    const legacy = startRun(newSave(), 'fuse', 413);
    delete legacy.settings.largeText;
    expect(parseSave(JSON.stringify(legacy))).toEqual(legacy);
  });

  test.each([false, true])('round-trips largeText=%s with the adventure intact', largeText => {
    const save = startRun(newSave(), 'fuse', 413);
    save.settings.largeText = largeText;
    expect(parseSave(JSON.stringify(save))).toEqual(save);
  });

  test.each(['false', 1, null, {}])('rejects malformed text preferences: %s', largeText => {
    const save = { ...newSave(), settings: { ...newSave().settings, largeText } };
    expect(() => parseSave(JSON.stringify(save))).toThrow('表示設定が不正です。');
  });
});
