import { defineConfig } from 'vite';

// Relative asset URLs also work below a GitHub Pages repository path.
export default defineConfig({ base: './', build: { target: 'es2022', assetsInlineLimit: 0 } });
