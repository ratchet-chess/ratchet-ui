import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

/**
 * Cross-origin isolation lets an engine run threads, and lets its Worker hear `stop` and
 * `isready` during a search through shared memory. A host that cannot send these headers, such
 * as GitHub Pages, gets them from public/isolation-sw.js, which src/isolation.ts registers.
 */
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // a static host may serve the app below its root, such as a project's GitHub Pages path
  base: process.env['BASE'] ?? '/',
  plugins: [vue(), tailwindcss()],
  server: { headers: isolation },
  preview: { headers: isolation },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
