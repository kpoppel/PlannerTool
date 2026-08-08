import { test, expect } from '@playwright/test';
import { clearOverlays } from './helpers.js';

async function ensureHorizontalOverflow(page) {
  return page.evaluate(() => {
    const timelineBoard = document.querySelector('timeline-board');
    const root = timelineBoard?.shadowRoot;
    const sc = root?.querySelector('#scroll-container');
    const boardArea = root?.querySelector('#board-area');
    const timeline = root?.querySelector('timeline-lit');
    if (!sc || !boardArea) {
      return null;
    }

    // Force a deterministic narrow viewport plus wide content area.
    sc.style.width = '420px';
    sc.style.maxWidth = '420px';
    boardArea.style.minWidth = '3600px';
    if (timeline) {
      timeline.style.minWidth = '3600px';
    }

    return {
      scrollLeft: sc.scrollLeft,
      scrollWidth: sc.scrollWidth,
      clientWidth: sc.clientWidth,
    };
  });
}

test.describe('Timeline panning', () => {
  test('pans timeline section via mouse drag or wheel interaction', async ({ page }) => {
    await page.goto('/');
    await clearOverlays(page);
    const seededMetrics = await ensureHorizontalOverflow(page);
    expect(seededMetrics).not.toBeNull();

    // The redesigned timeline uses TimelineBoard's shadow-hosted scroll container.
    const section = page.locator('timeline-board #scroll-container').first();
    await expect(section).toBeVisible({ timeout: 10000 });

    const box = await section.boundingBox();
    expect(box).not.toBeNull();

    const metrics = await section.evaluate((el) => {
      return {
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });

    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

    // record initial scrollLeft
    const before = metrics.scrollLeft;

    // perform pan drag on the section area (not on a feature-card)
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 600, box.y + 10, { steps: 20 });
    await page.mouse.up();

    await page.waitForTimeout(200);
    let after = await section.evaluate((el) => el.scrollLeft);
    if (after === before) {
      // Some builds hook panning to wheel/trackpad semantics; try wheel event.
      await page.mouse.move(box.x + 40, box.y + 20);
      await page.mouse.wheel(500, 0);
      await page.waitForTimeout(150);
      after = await section.evaluate((el) => el.scrollLeft);
    }
    expect(after).not.toBe(before);
  });

  test('scroll container supports programmatic horizontal scrolling', async ({ page }) => {
    await page.goto('/');
    await clearOverlays(page);
    const seededMetrics = await ensureHorizontalOverflow(page);
    expect(seededMetrics).not.toBeNull();

    const section = page.locator('timeline-board #scroll-container').first();
    await expect(section).toBeVisible({ timeout: 10000 });

    const metrics = await section.evaluate((el) => ({
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));

    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

    const before = metrics.scrollLeft;
    await section.evaluate((el) => {
      el.scrollLeft += 500;
    });
    await page.waitForTimeout(100);
    const after = await section.evaluate((el) => el.scrollLeft);
    expect(after).not.toBe(before);
  });
});
