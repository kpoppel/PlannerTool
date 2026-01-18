import { test, expect } from '@playwright/test';
import { clearOverlays } from './helpers.js';

// This test assumes the dev server is running on http://localhost:8000
test.describe('Details panel (Lit)', () => {
  test('clicking a feature card shows the details panel', async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG>', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR>', err.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clearOverlays(page);

    // Wait for feature board to render at least one feature-card-lit or .feature-card
    await page.waitForSelector('feature-card-lit, .feature-card', { timeout: 10000 });

    // Also first card: await page.getByText('%').first().click();
    // Prefer Lit host if present; click center of first card
    const card = await page.$('feature-card-lit') || await page.$('.feature-card');
    if (!card) throw new Error('No feature card found');
    await card.click();

    // The Lit panel is `details-panel` becoming visible.
    await page.waitForFunction(() => {
      const el = document.querySelector('details-panel');
      return !!(el && el.open);
    }, { timeout: 2000 });
    let isOpen = await page.$eval('details-panel', el => !!el.open);
    expect(isOpen).toBeTruthy();
    // Click outside the details panel to close it (click near top-left corner of the page)
    await page.click('body', { position: { x: 10, y: 10 } });
    // Wait for the panel to close
    await page.waitForFunction(() => {
      const el = document.querySelector('details-panel');
      return !(el && el.open);
    }, { timeout: 2000 });
    const isStillOpen = await page.$eval('details-panel', el => !!el.open).catch(() => false);
    expect(isStillOpen).toBeFalsy();

    // Test relations link alignment
    // pick the first relation item
    await card.click();

    await page.waitForFunction(() => {
      const el = document.querySelector('details-panel');
      return !!(el && el.open);
    }, { timeout: 2000 });
    isOpen = await page.$eval('details-panel', el => !!el.open);
    expect(isOpen).toBeTruthy();
    
    const icon = await page.$('.azure-relation-item .relation-icon');
    const title = await page.$('.azure-relation-item .relation-title');
    const iconBox = await icon.boundingBox();
    const titleBox = await title.boundingBox();
    if (!iconBox || !titleBox) throw new Error('Could not find relation icon or title bounding box');
    const iconCenter = iconBox.y + iconBox.height / 2;
    const titleCenter = titleBox.y + titleBox.height / 2;
    const diff = Math.abs(iconCenter - titleCenter);
    console.log('ICON CENTER', iconCenter, 'TITLE CENTER', titleCenter, 'DIFF', diff);
    // expect centers to be within 2px
    expect(diff).toBeLessThanOrEqual(2);
  });
});
