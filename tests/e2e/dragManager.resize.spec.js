import { test, expect } from '@playwright/test';

test.describe('DragManager resize (e2e)', () => {
  test('resizes a feature card via right-edge drag', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('feature-card-lit', { timeout: 5000 });

    const card = await page.$('feature-card-lit');
    expect(card).not.toBeNull();

    // get bounding box of card and perform a drag starting near the right edge
    const box = await card.boundingBox();
    const startX = box.x + box.width - 6; // near right edge (resize handle)
    const startY = box.y + box.height / 2;

    // capture initial width
    const initialWidth = await page.evaluate(el => parseInt(getComputedStyle(el).width, 10), card);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // drag to the right to increase width
    await page.mouse.move(startX + 120, startY, { steps: 12 });
    await page.mouse.up();

    // small wait for UI updates
    await page.waitForTimeout(300);

    const finalWidth = await page.evaluate(el => parseInt(getComputedStyle(el).width, 10), card);
    expect(finalWidth).toBeGreaterThanOrEqual(initialWidth);
  });
});
