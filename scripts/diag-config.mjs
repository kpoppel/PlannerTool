import { chromium } from 'playwright';
import fs from 'fs';

const baseURL = process.env.BASE_URL || 'http://localhost:8000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG>', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR>', err.message));

  try {
    console.log('[diag-config] navigating to', baseURL);
    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 20000 });

    // Check for open config button
    const ts = Date.now();
    const openBtn = await page.$('#openConfigBtn');
    if (!openBtn) {
      console.warn('[diag-config] #openConfigBtn not found');
      await page.screenshot({ path: `tests/e2e/diag-${ts}-no-openbtn.png`, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(`tests/e2e/diag-${ts}-no-openbtn.html`, html, 'utf8');
      process.exit(2);
    }

    console.log('[diag-config] found #openConfigBtn; clicking');
    await openBtn.click();

    // Wait briefly for form
    try {
      await page.waitForSelector('#configForm', { timeout: 5000 });
      console.log('[diag-config] #configForm visible');
      await page.screenshot({ path: `tests/e2e/diag-${ts}-form-visible.png`, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(`tests/e2e/diag-${ts}-form-visible.html`, html, 'utf8');
      process.exit(0);
    } catch (e) {
      console.warn('[diag-config] #configForm not visible after click');
      await page.screenshot({ path: `tests/e2e/diag-${ts}-no-form.png`, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(`tests/e2e/diag-${ts}-no-form.html`, html, 'utf8');
      process.exit(3);
    }
  } catch (err) {
    console.error('[diag-config] error', err && err.message);
    const ts = Date.now();
    try { await page.screenshot({ path: `tests/e2e/diag-${ts}-error.png`, fullPage: true }); } catch(e){}
    try { fs.writeFileSync(`tests/e2e/diag-${ts}-error.txt`, String(err.stack || err)); } catch(e){}
    process.exit(1);
  } finally {
    try { await browser.close(); } catch(e){}
  }

})();
