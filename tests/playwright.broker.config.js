import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './broker',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:18880',
    viewport: { width: 1280, height: 900 },
    trace: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});