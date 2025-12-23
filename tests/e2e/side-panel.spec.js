import { test, expect } from '@playwright/test';

// Verifies the details/side panel content and basic interactions
test('Details side panel shows expected elements and can be closed', async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG>', msg.type(), msg.text()));
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Wait for a feature card to appear and click it to open the side panel
  await page.waitForSelector('feature-card-lit, .feature-card', { timeout: 15000 });
  const card = await page.$('feature-card-lit') || await page.$('.feature-card');
  if (!card) throw new Error('No feature card found');
  await card.click();

  // Wait for panel to be shown
  await page.waitForSelector('details-panel', { state: 'attached', timeout: 5000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('details-panel');
    return !!(el && el.open);
  }, { timeout: 5000 });

  // Assert expected elements exist inside the panel's light DOM
  const closeBtn = await page.$('details-panel >> .details-close');
  expect(closeBtn).not.toBeNull();

  const idLink = await page.$('details-panel >> .details-header a.details-link');
  expect(idLink).not.toBeNull();

  const descLabel = await page.$('details-panel >> text=Description');
  expect(descLabel).not.toBeNull();

  const teamLoadLabel = await page.$('details-panel >> text=Team Load');
  expect(teamLoadLabel).not.toBeNull();

  // Click close button and assert panel hides
  await closeBtn.click();
  await page.waitForFunction(() => {
    const el = document.querySelector('details-panel');
    return !(el && el.open);
  }, { timeout: 3000 });

  const stillOpen = await page.$eval('details-panel', el => !!el.open).catch(() => false);
  expect(stillOpen).toBeFalsy();
});
