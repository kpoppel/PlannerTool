import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['reconciliation.spec.js', 'admin-workforce.spec.js', 'admin-plans.spec.js', 'allocation-units.spec.js',
    'keyboard-shortcuts.spec.js'],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5175', viewport: { width: 1366, height: 900 } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'npx vite --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175/js/modules.config.json',
    reuseExistingServer: false,
  },
});