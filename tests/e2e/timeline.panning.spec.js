import { test, expect } from '@playwright/test';

test.describe('Timeline panning', () => {
  test('pans timeline section via mouse drag', async ({ page }) => {
    await page.goto('/');
    // wait for timeline section to be present
    await page.waitForSelector('#timelineSection', { timeout: 5000 });

    const section = await page.$('#timelineSection');
    expect(section).not.toBeNull();
    const box = await section.boundingBox();
    // record initial scrollLeft
    const before = await page.evaluate(el => el.scrollLeft, section);

    // perform pan drag on the section area (not on a feature-card)
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 10, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(200);
    const after = await page.evaluate(el => el.scrollLeft, section);
    expect(after).not.toBe(before);
  });
});
