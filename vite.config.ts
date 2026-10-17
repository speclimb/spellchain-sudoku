import { defineConfig } from 'vite';
import { buildIdentity } from './scripts/build-identity';

// Relative asset URLs also work below a GitHub Pages repository path.
export default defineConfig(({ command }) => ({ base: './',
  define: { __APP_BUILD__: JSON.stringify(buildIdentity(process.cwd(), command)) },
  // Browser downloads are briefly locked on Windows; generated QA artifacts
  // must not enter the source watcher or interrupt an active playtest.
  server: { watch: { ignored: ['**/.runtime/**', '**/test-results/**', '**/playwright-report/**'] } },
  build: { target: 'es2022', assetsInlineLimit: 0 } }));
