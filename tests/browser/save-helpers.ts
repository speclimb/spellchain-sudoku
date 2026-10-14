import type { Page } from '@playwright/test';
/** A click dispatches an async durable transaction. Wait for its completion,
 * rather than assuming a synchronous localStorage.setItem inside the handler. */
export async function savedText(page: Page, key = 'chain-incantation.save.v1'): Promise<string | null> {
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true');
  return page.evaluate(key => localStorage.getItem(key), key);
}

/** Read the logical save, including the archive moved out of localStorage. */
export async function savedGame(page: Page): Promise<import('../../src/game/types').Save> {
  await savedText(page);
  return page.evaluate(async () => {
    const path = '/src/game/history-storage.ts';
    const { HistoryStorage } = await import(/* @vite-ignore */ path);
    const storage = new HistoryStorage(), { save } = await storage.load(); storage.close();
    delete save.historyStorage;
    return save;
  });
}

/** Repeated synthetic fixtures intentionally start over. Clear their DB before
 * injecting an older local snapshot, instead of triggering real stale-tab protection. */
export async function resetHistoryDatabase(page: Page): Promise<void> {
  await page.waitForFunction(() => !!document.querySelector('[data-action="history"]'));
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('chain-incantation.history.v1');
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Fixture database remained open'));
  }));
}
