import { firefox } from 'playwright';
import fs from 'fs';

const baseURL = process.env.BASE_URL || 'http://localhost:8000';

(async () => {
  console.log('[interactive-config] launching firefox headed, baseURL=', baseURL);
  const browser = await firefox.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG>', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR>', err.message));

  try {
    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 20000 });
    console.log('[interactive-config] opened page');
    // Try to open the configuration modal and fill email
    try {
      await page.click('#openConfigBtn');
      console.log('[interactive-config] clicked #openConfigBtn');
      await page.waitForSelector('#configForm', { timeout: 20000 });
      console.log('[interactive-config] config form visible');
      await page.fill('#configEmail', 'user@example.com');
      // Wait for the save button and inspect its state before clicking
      await page.waitForSelector('#saveConfigBtn', { timeout: 5000 });
      const btnInfo = await page.$eval('#saveConfigBtn', el => ({ disabled: el.disabled || false, text: el.textContent && el.textContent.trim() }));
      console.log('[interactive-config] save button info', btnInfo);
      if (btnInfo.disabled) {
        console.warn('[interactive-config] save button is disabled; cannot click');
      } else {
        await page.click('#saveConfigBtn');
        console.log('[interactive-config] clicked #saveConfigBtn');
        // wait for any save/network activity then reload to reflect session
        await page.waitForTimeout(1000);
        await page.reload({ waitUntil: 'networkidle' });
        console.log('[interactive-config] reloaded after save');
      }
      // keep browser open for observation
      console.log('[interactive-config] leaving browser open for inspection. Close manually when done.');
    } catch (err) {
      console.error('[interactive-config] UI flow failed:', err && err.message);
      // capture diagnostics
      try {
        const ts = Date.now();
        await page.screenshot({ path: `tests/e2e/diag-${ts}.png`, fullPage: true });
        const html = await page.content();
        await fs.promises.writeFile(`tests/e2e/diag-${ts}.html`, html, 'utf8');
        console.log('[interactive-config] wrote diagnostics tests/e2e/diag-' + ts + '.{png,html}');
      } catch (diagErr) {
        console.error('[interactive-config] failed to write diagnostics', diagErr && diagErr.message);
      }
      // leave browser open so user can inspect
    }
  } catch (e) {
    console.error('[interactive-config] navigation failed:', e && e.message);
    process.exit(1);
  }
})();
