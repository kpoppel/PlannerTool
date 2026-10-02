import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      'tests/e2e/**',
      'node_modules/**',
    ],
    projects: [
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./tests/setup/msw.js', './tests/setup/dom.js'],
          include: ['tests/{application,components,core,plugins,services}/**/*.test.js'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: [],
          include: ['tests/tooling/**/*.test.js'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
