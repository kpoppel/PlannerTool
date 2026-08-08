import { devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRootPath = resolve(__dirname, '..');
const isolatedDataDirPath = resolve(__dirname, 'e2e', '.tmp-data');
const e2eBaseUrl = 'http://127.0.0.1:8010';

// Resolve paths relative to this config file so moving files into /tests works
const testDirPath = resolve(__dirname, 'e2e');
const globalSetupPath = resolve(__dirname, 'e2e', 'global-setup.js');
const storageStatePath = resolve(__dirname, 'e2e', 'storageState.json');

export default {
  testDir: testDirPath,
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  // Use a single worker for e2e tests to avoid race conditions against a shared server
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    // Run against an isolated Playwright-owned server instance.
    baseURL: e2eBaseUrl,
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 5000,
    storageState: storageStatePath,
  },
  globalSetup: globalSetupPath,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command:
      `cd ${repoRootPath} && mkdir -p ${isolatedDataDirPath} && python3 -m uvicorn tests.e2e.playwright_test_app:make_app --factory --port 8010`,
    env: {
      PLANNER_SECRET_KEY: 'playwright-e2e-secret-key',
    },
    url: e2eBaseUrl,
    timeout: 120000,
    // Must be false so tests never attach to a user's existing server/data.
    reuseExistingServer: false,
  },
};
