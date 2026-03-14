import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    // Run the project setup file but exclude it from being treated as a test suite
    setupFiles: ['./tests/00-setup.test.js'],
    exclude: ['tests/00-setup.test.js', 'tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov']
    }
  }
})
