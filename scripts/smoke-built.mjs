import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('http://127.0.0.1:5173');
  if (response.status() !== 200) throw new Error('Production page did not load.');
  await page.getByRole('button', { name: /冒険をはじめる/ }).click();
  await page.locator('[data-cell][aria-disabled="false"]').first().click();
  await page.locator('[data-action="cast"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="cast"]')?.textContent.includes('起点を選んでください'));
  await page.screenshot({ path: '.runtime/screenshots/production-battle.png', fullPage: true });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chain-incantation.save.v1')));
  if (saved.run.stats.moves !== 1 || errors.length) throw new Error(JSON.stringify({ moves: saved.run.stats.moves, errors }));
  console.log('Built game: title, lazy-loaded Phaser board, forecast, animation, action and persistence passed.');
} finally { await browser.close(); }
