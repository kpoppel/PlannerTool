import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default {
  testDir: './e2e',
  testMatch: 'device-auth.spec.js',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8017', headless: true, viewport: { width: 1440, height: 900 } },
  webServer: {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    command: '.venv/bin/python -m uvicorn tests.e2e.playwright_test_app:make_auth_app --factory --port 8017',
    env: {
      PLANNER_AUTH_TEST_DATA_DIR: mkdtempSync(join(tmpdir(), 'planner-auth-e2e-')),
      PLANNER_SECRET_KEY: 'auth-e2e-test-only-secret',
    },
    url: 'http://127.0.0.1:8017',
    reuseExistingServer: false,
  },
};