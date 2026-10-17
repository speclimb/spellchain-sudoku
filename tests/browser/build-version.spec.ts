import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for(const width of [320,390,1280]) test(`version visible on title and play, history and JSON at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900}); await page.goto('/');
  const label=page.locator('[data-build-version]'); await expect(label).toContainText('開発版');
  const version=await label.getAttribute('data-build-version'); expect(version).toMatch(/^0\.1\.0\+.+\.dev$/);
  await page.screenshot({path:`.runtime/version-title-${width}.png`});
  await page.evaluate(async()=>{
    const ep='/src/game/engine.ts'; const {newSave,startRun,dispatch,legalOrigins}=await import(/* @vite-ignore */ ep);
    let s=startRun(newSave(),'fuse',51); s=dispatch(s,{type:'play',cell:legalOrigins(s.run)[0],skill:false,revision:s.run.revision});
    s.settings.reducedMotion=true; s.settings.sound=false; s.meta.tutorialDone=true;
    localStorage.setItem('chain-incantation.save.v1',JSON.stringify(s));
  });
  await page.reload(); await page.locator('[data-action="resume"]').click(); await expect(label).toBeVisible();
  await expect(label).toHaveAttribute('data-build-version',version!); await expect(page.locator('canvas')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`.runtime/version-play-${width}.png`});
  await page.locator('[data-action="history"]').click(); const dialog=page.getByRole('dialog',{name:'プレイ履歴',exact:true});
  await expect(dialog).toContainText(`冒険開始版：${version}`); await expect(dialog).toContainText(`構成記録版：${version}`);
  await dialog.locator('[data-history-battle] summary').first().click(); await expect(dialog).toContainText(`この戦闘でプレイした版：${version}`);
  await dialog.locator('[data-history-cast] summary').first().click(); await expect(dialog).toContainText(`詠唱実行版：${version}`);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const download=page.waitForEvent('download'); await dialog.getByRole('button',{name:'JSONを保存'}).click();
  const file=await download; const json=JSON.parse(await readFile((await file.path())!,'utf8'));
  expect(json.exportedByVersion).toBe(version); expect(json.history.runs[0].startedGameVersion).toBe(version);
  expect(json.history.runs[0].battles[0].casts[0].gameVersion).toBe(version);
  await dialog.locator('.history-version').first().scrollIntoViewIfNeeded(); await page.screenshot({path:`.runtime/version-history-${width}.png`});
});
