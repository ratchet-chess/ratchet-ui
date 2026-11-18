import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

/**
 * Cross-origin isolation lets an engine's Worker hear `stop` and `isready` during a search,
 * through shared memory, and keeps its hash table between moves. A host that cannot send
 * these headers, such as GitHub Pages, gets the Worker's slower fallbacks.
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
