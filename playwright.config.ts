import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 120000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5174', channel: process.platform === 'win32' ? 'msedge' : 'chromium', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run dev -- --port 5174 --strictPort`, url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
