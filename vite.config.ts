import { defineConfig } from 'vite';
import { buildIdentity } from './scripts/build-identity';

// Relative asset URLs also work below a GitHub Pages repository path.
export default defineConfig(({ command }) => ({ base: './',
  define: { __APP_BUILD__: JSON.stringify(buildIdentity(process.cwd(), command)) },
  build: { target: 'es2022', assetsInlineLimit: 0 } }));
