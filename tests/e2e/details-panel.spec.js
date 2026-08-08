import { test, expect } from '@playwright/test';
import { clearOverlays } from './helpers.js';

test.describe('Details panel (Lit)', () => {
  test('clicking a feature card shows the details panel', async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG>', msg.type(), msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR>', err.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await clearOverlays(page);

    // The redesigned board exposes cards as listitems inside the timeline region.
    const timelineRegion = page.getByRole('region', { name: 'Timeline and Features' });
    await expect(timelineRegion).toBeVisible({ timeout: 10000 });

    const firstCard = timelineRegion.getByRole('listitem').first();
    await expect(firstCard).toBeVisible({ timeout: 10000 });
    await firstCard.click();

    // The Lit panel is `details-panel` becoming visible.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('details-panel');
        return !!(el && el.open);
      },
      { timeout: 5000 }
    );
    let isOpen = await page.$eval('details-panel', (el) => !!el.open);
    expect(isOpen).toBeTruthy();

    // Best-effort close to keep test deterministic across UI event-handling variants.
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);

    // Test relations link alignment
    await firstCard.click();

    await page.waitForFunction(
      () => {
        const el = document.querySelector('details-panel');
        return !!(el && el.open);
      },
      { timeout: 5000 }
    );
    isOpen = await page.$eval('details-panel', (el) => !!el.open);
    expect(isOpen).toBeTruthy();

    const relationAlignment = await page.evaluate(() => {
      const panel = document.querySelector('details-panel');
      const root = panel?.shadowRoot;
      if (!root) return null;
      const first = root.querySelector('.azure-relation-item');
      if (!first) return null;
      const icon = first.querySelector('.relation-icon');
      const title = first.querySelector('.relation-title');
      if (!icon || !title) return null;

      const iconRect = icon.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const iconCenter = iconRect.y + iconRect.height / 2;
      const titleCenter = titleRect.y + titleRect.height / 2;
      return Math.abs(iconCenter - titleCenter);
    });

    if (typeof relationAlignment === 'number') {
      expect(relationAlignment).toBeLessThanOrEqual(4);
    }
  });
});
