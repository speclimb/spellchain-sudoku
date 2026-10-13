import { defineConfig } from 'vite';

// Relative asset URLs also work below a GitHub Pages repository path.
export default defineConfig({ base: './', build: { assetsInlineLimit: 0 } });
