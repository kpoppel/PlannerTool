import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import base from './playwright.config.js';

const port = 8012;
const url = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'planner-local-task-e2e-'));

export default {
  ...base,
  testMatch: '**/local-task-publication.e2e.js',
  globalSetup: undefined,
  metadata: { testDataDir: dataDir },
  use: { ...base.use, baseURL: url, storageState: undefined },
  webServer: {
    ...base.webServer,
    command: `.venv/bin/python -m uvicorn tests.e2e.playwright_test_app:make_local_task_app --factory --port ${port}`,
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...base.webServer.env, PLANNER_E2E_TEST_DATA_DIR: dataDir },
    url,
  },
};