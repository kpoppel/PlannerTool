import { test, expect } from '@playwright/test';
import { clearOverlays } from './helpers.js';

test.describe('Modal interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Ensure session created by global-setup is applied and remove any blocking overlays
    try { await page.waitForSelector('#openConfigBtn', { timeout: 5000 }); } catch (e) {}
    await clearOverlays(page);
  });

  test('Open config modal and close via close button', async ({ page }) => {
    await page.click('#openConfigBtn');
    await page.waitForSelector('#configForm', { timeout: 5000 });
    await page.click('#closeConfigBtn');
    // The modal overlay should be hidden when closed
    const modal = await page.$('.config-modal-overlay');
    const visible = modal ? await modal.evaluate(el => window.getComputedStyle(el).display !== 'none') : false;
    expect(visible).toBeFalsy();
  });

  test('Open config modal and close by clicking outside modal', async ({ page }) => {
    await page.click('#openConfigBtn');
    await page.waitForSelector('#configForm', { timeout: 5000 });
    // Click on the overlay background (near the top-left corner) to ensure we hit the overlay, not the inner modal
    // For the lit-based modal the overlay is a child of the inner `modal-lit` element.
    await page.click('config-modal >> .modal-overlay', { position: { x: 10, y: 10 } });
    const modal = await page.$('config-modal >> .modal-overlay');
    const visible = modal ? await modal.evaluate(el => window.getComputedStyle(el).display !== 'none') : false;
    expect(visible).toBeFalsy();
  });

  test('Open help modal and close via close button', async ({ page }) => {
    await page.click('#openHelpBtn');
    // Wait for the help-modal element to be attached (it may be present but not yet visible)
    await page.waitForSelector('help-modal', { state: 'attached', timeout: 5000 });
    // Use nested locators to find the Close button inside the nested modal-lit and click it
    // Select the Close button that is visible inside the help modal (avoid duplicate buttons)
    const helpModal = page.locator('help-modal');
    await helpModal.waitFor({ state: 'attached', timeout: 7000 });
    // Pick the first visible Close button inside the help modal
    const closeButtons = helpModal.locator('button', { hasText: 'Close' });
    await closeButtons.first().waitFor({ state: 'visible', timeout: 7000 });
    await closeButtons.first().click();
    // Wait for the help-modal host to be detached
    await page.waitForSelector('help-modal', { state: 'detached', timeout: 5000 });
  });

  test('Open help modal and close by clicking outside modal area', async ({ page }) => {
    await page.click('#openHelpBtn');
    await page.waitForSelector('help-modal', { state: 'attached', timeout: 5000 });
    // Wait for Close button to be visible to ensure modal has finished rendering
    await page.waitForSelector('help-modal >> text=Close', { state: 'visible', timeout: 7000 });
    // Click near the top-left of the document to simulate an outside click
    await page.click('body', { position: { x: 10, y: 10 } });
    // Wait briefly for modal removal
    await page.waitForTimeout(300);
    await expect(page.locator('help-modal')).toHaveCount(0);
  });

});
