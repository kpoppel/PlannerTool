import { devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

// Regenerates the Help documentation screenshots in www/docs/img from an isolated
// server backed by the synthetic generator. Run `npm run build` first (the server serves dist/).
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRootPath = resolve(__dirname, '..');
const playwrightPort = process.env.PLANNER_PLAYWRIGHT_PORT === undefined
  ? 8012
  : Number(process.env.PLANNER_PLAYWRIGHT_PORT);
if (process.env.PLANNER_DOCS_RUN_DATA_DIR === undefined) {
  process.env.PLANNER_DOCS_RUN_DATA_DIR = mkdtempSync(join(tmpdir(), 'planner-docs-'));
}
const isolatedDataDirPath = process.env.PLANNER_DOCS_RUN_DATA_DIR;
const docsBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const storageStatePath = resolve(isolatedDataDirPath, 'storage-state.json');

export default {
  testDir: resolve(__dirname, 'docs-capture'),
  metadata: { testDataDir: isolatedDataDirPath, storageStatePath },
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: docsBaseUrl,
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10000,
    storageState: storageStatePath,
  },
  globalSetup: resolve(__dirname, 'docs-capture', 'global-setup.js'),
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command:
      `cd ${repoRootPath} && .venv/bin/python -m uvicorn tests.e2e.playwright_test_app:make_app --factory --port ${playwrightPort}`,
    env: {
      PLANNER_SECRET_KEY: 'playwright-docs-secret-key',
      PLANNER_E2E_TEST_DATA_DIR: isolatedDataDirPath,
    },
    url: docsBaseUrl,
    timeout: 120000,
    reuseExistingServer: false,
  },
};
