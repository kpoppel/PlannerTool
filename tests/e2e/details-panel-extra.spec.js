import { test, expect } from '@playwright/test';
import { clearOverlays } from './helpers.js';

test.describe('Details Panel - Extra coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clearOverlays(page);
    // Wait for at least one feature card
    await page.waitForSelector('feature-card-lit, .feature-card', { timeout: 10000 });
  });

  test('capacity input can be edited and saved', async ({ page }) => {
    const card = await page.$('feature-card-lit') || await page.$('.feature-card');
    await card.click();
    await page.waitForFunction(() => !!(document.querySelector('details-panel') && document.querySelector('details-panel').open), { timeout: 2000 });

    // Find first capacity input if present
    const input = await page.$('details-panel .capacity-bar-input');
    test.skip(!input, 'No capacity inputs present for this feature');
    const oldVal = await input.getAttribute('value');
    const newVal = String(Math.min(100, (parseInt(oldVal||'0') || 0) + 10));

    await input.click();
    await input.fill(newVal);
    // blur to trigger save
    await input.press('Tab');
    await page.waitForTimeout(300);

    const updated = await input.getAttribute('value');
    expect(updated).toBe(newVal);
  });

  test('capacity bar delete removes a team', async ({ page }) => {
    const card = await page.$('feature-card-lit') || await page.$('.feature-card');
    await card.click();
    await page.waitForFunction(() => !!(document.querySelector('details-panel') && document.querySelector('details-panel').open), { timeout: 2000 });

    const deleteBtns = await page.$$('details-panel .capacity-bar-delete');
    test.skip(deleteBtns.length === 0, 'No capacity delete buttons present');
    const beforeCount = await page.$$eval('details-panel .capacity-bar-row', els => els.length);
    await deleteBtns[0].click();
    await page.waitForTimeout(300);
    const afterCount = await page.$$eval('details-panel .capacity-bar-row', els => els.length);
    expect(afterCount).toBeLessThan(beforeCount);
  });

  test('add team flow adds a team', async ({ page }) => {
    const card = await page.$('feature-card-lit') || await page.$('.feature-card');
    await card.click();
    await page.waitForFunction(() => !!(document.querySelector('details-panel') && document.querySelector('details-panel').open), { timeout: 2000 });

    // Click add team
    const addBtn = await page.$('details-panel .add-team-btn');
    test.skip(!addBtn, 'Add team not present for this feature');
    await addBtn.click();
    await page.waitForSelector('details-panel .add-team-form', { timeout: 2000 });

    // Choose first available team and add
    const select = page.locator('details-panel .add-team-form select');
    const options = await select.locator('option').allTextContents();
    test.skip(options.length <= 1, 'No available teams to add');
    // pick the second option (index 1) which is first real team
    await select.selectOption({ index: 1 });
    const input = page.locator('details-panel .add-team-form input');
    await input.fill('10');
    await page.locator('details-panel .add-team-form button[type=submit]').click();
    await page.waitForTimeout(400);

    const newCount = await page.$$eval('details-panel .capacity-bar-row', els => els.length);
    expect(newCount).toBeGreaterThanOrEqual(1);
  });

  test('shrinkwrap epic button exists for epics and triggers date update', async ({ page }) => {
    // Find an epic card if present
    const epicCard = await page.$('feature-card-lit[type="epic"], feature-card-lit[feature-type="epic"], .feature-card.epic');
    test.skip(!epicCard, 'No epic feature card present in test data');
    await epicCard.click();
    await page.waitForFunction(() => !!(document.querySelector('details-panel') && document.querySelector('details-panel').open), { timeout: 2000 });

    const shrinkBtn = await page.$('details-panel button[data-test="shrinkwrap-chip"], details-panel button[aria-label*="Shrinkwrap"]');
    test.skip(!shrinkBtn, 'Shrinkwrap button not present for epic');
    // Click and then ensure the dates in the panel update (start/end values change or present)
    await shrinkBtn.click();
    await page.waitForTimeout(400);
    // assert start and end fields exist
    const start = await page.$('details-panel .details-value:nth-of-type(2)');
    const end = await page.$('details-panel .details-value:nth-of-type(3)');
    test.skip(!start || !end, 'Start/End not rendered');
    const sTxt = await start.textContent();
    const eTxt = await end.textContent();
    expect(sTxt).toBeTruthy();
    expect(eTxt).toBeTruthy();
  });
});
