import { devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    // Point tests to production server on port 8000. Do not start/stop servers from tests.
    baseURL: 'http://localhost:8000',
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 5000,
    storageState: storageStatePath
  },
  globalSetup: globalSetupPath,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
  ],
  // webServer: {
  //   command: 'python3 -m uvicorn planner:app --reload --port 8001 || python -m uvicorn planner:app --reload --port 8001',
  //   url: 'http://localhost:8001',
  //   timeout: 120000,
  //   reuseExistingServer: true
  // }
};