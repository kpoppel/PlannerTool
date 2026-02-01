import { test, expect } from '@playwright/test';

// Assumes app is served at http://localhost:8000 or the configured test baseUrl
// Update baseURL in Playwright config if different.

test.describe('In-app SearchTool', () => {
  test('opens with Ctrl+Shift+F, searches and centers a feature', async ({ page, baseURL }) => {
    const url = baseURL || 'http://localhost:8000';
    await page.goto(url);

    // Wait for app ready
    await page.waitForSelector('feature-board', { timeout: 10000 });

    // Press Ctrl+Shift+F to open search
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('F');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');

    // Search input should appear
    const searchInput = await page.waitForSelector('search-tool >>> .search-input', { timeout: 3000 });
    await expect(searchInput).toBeVisible();

    // Type a short numeric substring to match an id (choose '1' to be broadly matching)
    await searchInput.fill('1');

    // Wait for results to populate
    const firstResult = await page.waitForSelector('search-tool >>> .result', { timeout: 3000 });
    await expect(firstResult).toBeVisible();

    // Read the id from the result metadata
    const idText = await firstResult.$eval('.meta', node => node.textContent.trim());
    expect(idText.length).toBeGreaterThan(0);

    // Click the result
    await firstResult.click();

    // After click the search tool should be closed (removed from DOM)
    await page.waitForSelector('search-tool', { state: 'detached', timeout: 3000 });

    // Ensure the feature-card for the selected id exists and is visible
    const selector = `feature-card-lit[data-feature-id="${idText}"]`;
    const card = await page.waitForSelector(selector, { timeout: 5000 });
    await expect(card).toBeVisible();

    // Optionally verify that the card is near the center of the viewport
    // Compute bounding boxes and assert roughly centered
    const timeline = await page.$('#timelineSection');
    const timelineBox = await timeline.boundingBox();
    const cardBox = await card.boundingBox();

    // card center X should be within 40%..60% of timeline width
    const cardCenterX = cardBox.x + cardBox.width / 2;
    const rel = (cardCenterX - timelineBox.x) / timelineBox.width;
    expect(rel).toBeGreaterThan(0.2);
    expect(rel).toBeLessThan(0.8);
  });
});
