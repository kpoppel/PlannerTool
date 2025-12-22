import { test, expect } from '@playwright/test';

test.describe('FeatureBoard drag & resize (e2e)', () => {
  test('drags a feature card and triggers update', async ({ page }) => {
    await page.goto('/');

    // Wait for feature-card-lit to appear
    await page.waitForSelector('feature-card-lit', { timeout: 5000 });

    const card = await page.$('feature-card-lit');
    expect(card).not.toBeNull();

    const initialLeft = await page.evaluate(el => getComputedStyle(el).left, card);

    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);

    const finalLeft = await page.evaluate(el => getComputedStyle(el).left, card);
    expect(finalLeft).not.toBe(initialLeft);
  });
});
