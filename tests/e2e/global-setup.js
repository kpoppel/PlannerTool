import { chromium } from 'playwright';
import fs from 'fs';
import http from 'http';

function waitForServer(url, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function ping() {
      const req = http.get(url, res => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(ping, 200);
      });
    })();
  });
}

export default async function globalSetup(config) {
  // Use production server port 8000 by default. Do NOT start a test server here.
  // If you need a local dev server, run it separately in background, e.g.:
  //    python3 -m uvicorn planner:app --reload --port 8001 &
  // or (Windows PowerShell): Start-Process -NoNewWindow python3 -ArgumentList "-m uvicorn planner:app --reload --port 8001"
  // Tests will target the production server running on port 8000 per request.
  const baseURL = (config.use && config.use.baseURL) || (config.projects && config.projects[0] && config.projects[0].use && config.projects[0].use.baseURL) || 'http://localhost:8000';
  console.log('[global-setup] baseURL=', baseURL);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Require the app and the config modal flow to succeed — fail fast if not available.
    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.click('#openConfigBtn');
    await page.waitForSelector('#configForm', { timeout: 20000 });
    await page.fill('#configEmail', 'user@example.com');
    await page.click('#saveConfigBtn');
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'networkidle' });
    await context.storageState({ path: 'tests/e2e/storageState.json' });
    console.log('[global-setup] storage state saved to tests/e2e/storageState.json');
  } finally {
    await browser.close();
  }
}
