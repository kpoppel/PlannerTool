import { chromium } from 'playwright';
import path from 'path';

const BASE_URL = process.env.PHASE6_BASE_URL || 'http://127.0.0.1:8010';
const REPEATS = Number(process.env.PHASE6_REPEATS || 3);
const STORAGE_STATE = path.resolve('tests/e2e/storageState.json');

async function runOnce(useStateStore) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();

  await page.addInitScript((enabled) => {
    window.__featureFlags = {
      ...(window.__featureFlags || {}),
      USE_STATE_STORE: enabled,
    };
  }, useStateStore);

  const navStart = Date.now();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('region', { name: 'Timeline and Features' }).waitFor({
    state: 'visible',
    timeout: 20000,
  });
  const navEnd = Date.now();

  const timings = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance
      .getEntriesByType('paint')
      .find((e) => e.name === 'first-contentful-paint');
    return {
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
      loadEventMs: nav ? nav.loadEventEnd : null,
      firstContentfulPaintMs: fcp ? fcp.startTime : null,
    };
  });

  const searchOpenStart = Date.now();
  await page.locator('body').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+Shift+F');
  await page.waitForSelector('search-tool', { timeout: 10000 });
  const searchOpenMs = Date.now() - searchOpenStart;

  const toggleStart = Date.now();
  await page.locator('app-sidebar .filter-option').first().click();
  await page.waitForTimeout(100);
  const sidebarToggleMs = Date.now() - toggleStart;

  await context.close();
  await browser.close();

  return {
    wallNavMs: navEnd - navStart,
    searchOpenMs,
    sidebarToggleMs,
    ...timings,
  };
}

function average(rows, key) {
  const values = rows.map((r) => r[key]).filter((v) => typeof v === 'number');
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function runCase(label, useStateStore) {
  const rows = [];
  for (let i = 0; i < REPEATS; i++) {
    rows.push(await runOnce(useStateStore));
  }
  return {
    label,
    repeats: REPEATS,
    samples: rows,
    averages: {
      wallNavMs: average(rows, 'wallNavMs'),
      domContentLoadedMs: average(rows, 'domContentLoadedMs'),
      loadEventMs: average(rows, 'loadEventMs'),
      firstContentfulPaintMs: average(rows, 'firstContentfulPaintMs'),
      searchOpenMs: average(rows, 'searchOpenMs'),
      sidebarToggleMs: average(rows, 'sidebarToggleMs'),
    },
  };
}

(async () => {
  const off = await runCase('USE_STATE_STORE=false', false);
  const on = await runCase('USE_STATE_STORE=true', true);
  const report = {
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    off,
    on,
  };

  console.log(JSON.stringify(report, null, 2));
})();
