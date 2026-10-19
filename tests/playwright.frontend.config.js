import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const playwrightPort = process.env.PLANNER_PLAYWRIGHT_PORT === undefined
  ? 5175
  : Number(process.env.PLANNER_PLAYWRIGHT_PORT);
const baseURL = `http://127.0.0.1:${playwrightPort}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['reconciliation.spec.js', 'admin-workforce.spec.js', 'admin-plans.spec.js', 'admin-users.spec.js', 'admin-iterations.spec.js', 'allocation-units.spec.js',
    'keyboard-shortcuts.spec.js'],
  workers: 1,
  use: { baseURL, viewport: { width: 1366, height: 900 } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: `npx vite --host 127.0.0.1 --port ${playwrightPort} --strictPort`,
    url: `${baseURL}/js/modules.config.json`,
    reuseExistingServer: false,
  },
});