import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const width of [390, 1280]) test(`frozen build, adventure switching, JSON and responsive layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/game/engine.ts', hp = '/src/game/history.ts';
    const { newSave, startRun } = await import(/* @vite-ignore */ path);
    const { snapshotBuild } = await import(/* @vite-ignore */ hp);
    let save = startRun(newSave(),'fuse',51);
    save.run.inventory = ['wick','pen','ward','quint','trinity','lens','battery','gold'];
    save.run.relicLevels = {wick:10,pen:6,ward:4,quint:7,trinity:5,lens:3,battery:2,gold:8};
    save.run.tier = {wick:3,quint:2,trinity:2};
    save.run.skillLevels = {fuse:10,bridge:5,pierce:3,bastion:2};
    save.run.equippedSkills = ['bridge','pierce'];
    save.history.runs[0].build = snapshotBuild(save.run);
    save.history.runs[0].build.relics[0].description = '検証用：当時の効果を保持。';
    save = startRun(save,'fuse',52);
    save.settings.reducedMotion = true; save.settings.sound = false; save.meta.tutorialDone = true;
    localStorage.setItem('chain-incantation.save.v1',JSON.stringify(save));
  });
  await page.reload(); await page.locator('[data-action="history"]').click();
  const dialog = page.getByRole('dialog',{name:'プレイ履歴',exact:true});
  await expect(dialog.locator('.history-build')).toContainText('最新記録時点の構成');
  await dialog.locator('[data-history-run]').selectOption({index:1});
  const build = dialog.locator('.history-build');
  await expect(build).toContainText('冒険終了時の構成');
  await expect(build.locator('[data-build-relic]')).toHaveCount(8);
  await expect(build.locator('[data-build-skill]')).toHaveCount(4);
  await expect(build.locator('[data-build-relic="wick"]')).toContainText('Lv.10 · 極位');
  await expect(build.locator('[data-build-skill="fuse"]')).toContainText('Lv.10 · 最終進化');
  await expect(build).toContainText('習得済み・未装備');
  await build.locator('[data-build-relic="wick"] summary').click();
  await expect(build).toContainText('検証用：当時の効果を保持。');
  await build.locator('[data-build-relic="wick"] summary').click();
  await build.scrollIntoViewIfNeeded();
  await page.screenshot({ path:`.runtime/history-build-${width}.png` });
  if (width === 390) {
    await build.locator('[data-build-skill="fuse"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.runtime/history-build-skills-390.png' });
    await page.evaluate(() => document.documentElement.classList.add('large-text'));
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.evaluate(() => document.documentElement.classList.remove('large-text'));
  }
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await dialog.locator('[data-history-battle] summary').first().click();
  await expect(build).toContainText('Lv.10 · 極位');
  const download = page.waitForEvent('download'); await dialog.getByRole('button',{name:'JSONを保存'}).click();
  const file = await download; const json = JSON.parse(await readFile((await file.path())!,'utf8'));
  expect(json.history.runs[0].build.relics[0].description).toBe('検証用：当時の効果を保持。');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-action="history"]')).toBeFocused();
  await page.reload(); await page.locator('[data-action="history"]').click();
  await dialog.locator('[data-history-run]').selectOption({index:1});
  await expect(dialog.locator('[data-build-relic="wick"]')).toContainText('Lv.10 · 極位');
});

test('legacy finished history is unknown rather than an empty final build', async ({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const path='/src/game/engine.ts'; const {newSave,startRun}=await import(/* @vite-ignore */ path);
    let save=startRun(newSave(),'fuse',51); save=startRun(save,'fuse',52);
    delete save.history.runs[0].build; localStorage.setItem('chain-incantation.save.v1',JSON.stringify(save));
  });
  await page.reload(); await page.locator('[data-action="history"]').click();
  await page.locator('[data-history-run]').selectOption({index:1});
  await expect(page.locator('.history-build')).toContainText('構成の記録がありません');
  await expect(page.locator('.history-build')).not.toContainText('所持している遺物はありません');
});
