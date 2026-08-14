import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests cover the PURE layers only — the chart engine (spec -> layout ->
 * primitives), number formatting, scales and the datasheet adapters. Everything
 * there is deliberately free of React and the DOM so it runs in plain node and
 * produces byte-identical output on the canvas, in an SSR thumbnail and in an
 * export. Component tests are not the point; `npm run validate:decks` and the
 * browser preview cover the rendering surfaces.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
