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

// a static host may serve the app below its root, such as a project's GitHub Pages path;
// the app's own fetches join paths to the base, so it starts and ends with one slash
const path = (process.env['BASE'] ?? '').replaceAll(/^\/+|\/+$/g, '');

export default defineConfig({
  base: path ? `/${path}/` : '/',
  plugins: [vue(), tailwindcss()],
  server: { headers: isolation },
  preview: { headers: isolation },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
