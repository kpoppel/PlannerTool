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
    // If an onboarding modal blocks interaction, remove it from DOM to allow clicks.
    await page.evaluate(() => {
      const selectors = ['onboarding-modal', '.onboarding-modal', '#onboardingModal', '[data-tour="onboarding"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) el.remove();
      }
      // also remove any modal overlays
      const overlays = document.querySelectorAll('.modal-backdrop, .overlay, .onboarding-overlay');
      overlays.forEach(o => o.remove());
    });
    await page.click('#openConfigBtn');
    await page.waitForSelector('#configForm', { timeout: 20000 });
    await page.fill('#configEmail', 'user@example.com');
    await page.click('#saveConfigBtn');
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'networkidle' });
    // Mark onboarding/tour as seen so modals don't intercept clicks in later sessions
    await page.evaluate(() => {
      try { localStorage.setItem('az_planner:onboarding_seen', '1'); } catch (e) {}
      try { localStorage.setItem('az_planner:tour_seen', '1'); } catch (e) {}
    });
    await context.storageState({ path: 'tests/e2e/storageState.json' });
    console.log('[global-setup] storage state saved to tests/e2e/storageState.json');
    // Seed a deterministic scenario with capacity override for a known feature id
    try {
      // Post scenario inside the page context so session cookie is included,
      // return created scenario id (if any) so we can activate it in the UI.
      const createdId = await page.evaluate(async () => {
        try {
          const payload = {
            op: 'save',
            data: {
              name: 'e2e-seed',
              overrides: {
                '516154': {
                  start: '2025-01-01',
                  end: '2025-02-01',
                  capacity: [ { team: 'team-integration', capacity: 20 } ]
                }
              }
            }
          };
          const res = await fetch('/api/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          try { const j = await res.json(); return j && j.id ? j.id : null; } catch(e) { return null; }
        } catch (e) {
          console.warn('[global-setup] scenario seed failed', e);
          return null;
        }
      });

      if (createdId) {
        // Reload so the client picks up the new scenario list, then activate it
        await page.reload({ waitUntil: 'networkidle' });
        // Ensure any onboarding overlays are removed before clicking
        await page.evaluate(() => {
          const overlaySelectors = ['onboarding-modal', '.onboarding-modal', '#onboardingModal', '[data-tour="onboarding"]', '.modal-backdrop', '.onboarding-overlay'];
          overlaySelectors.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
        });
        try {
          const loc = page.locator('#scenarioList .scenario-item', { hasText: 'e2e-seed' }).first();
          await loc.waitFor({ timeout: 4000 });
          await loc.click();
          // allow UI to settle
          await page.waitForTimeout(300);
          console.log('[global-setup] activated seeded scenario', createdId);
        } catch (e) {
          console.warn('[global-setup] failed to activate seeded scenario in UI', e);
        }
      }
    } catch (e) {
      console.warn('[global-setup] failed to seed scenario', e);
    }
  } finally {
    await browser.close();
  }
}
