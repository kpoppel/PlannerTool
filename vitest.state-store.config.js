import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [
      './tests/setup-state-store-flag.js',
      './tests/setup-msw.js',
      './tests/00-setup.test.js',
    ],
    exclude: [
      'tests/00-setup.test.js',
      'tests/setup-msw.js',
      'tests/e2e/**',
      'node_modules/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
