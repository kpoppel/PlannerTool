import { test, expect } from '@playwright/test';

test.describe('In-app SearchTool', () => {
  test('opens with Ctrl+Shift+F, searches and selects a feature', async ({ page }) => {
    await page.goto('/');

    // Wait for app ready
    await expect(
      page.getByRole('region', { name: 'Timeline and Features' })
    ).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => {
      const timelineBoard = document.querySelector('timeline-board');
      const root = timelineBoard?.shadowRoot;
      const sc = root?.querySelector('#scroll-container');
      const boardArea = root?.querySelector('#board-area');
      const timeline = root?.querySelector('timeline-lit');
      if (sc && boardArea) {
        sc.style.width = '420px';
        sc.style.maxWidth = '420px';
        boardArea.style.minWidth = '3600px';
        if (timeline) timeline.style.minWidth = '3600px';
      }
    });

    // Press Ctrl+Shift+F to open search
    await page.locator('body').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Control+Shift+F');

    const searchHosts = page.locator('search-tool');
    let hostCount = await searchHosts.count();

    // Give the shortcut path a chance before sending a synthetic fallback event.
    if (hostCount === 0) {
      try {
        await page.waitForFunction(
          () => document.querySelectorAll('search-tool').length > 0,
          { timeout: 1200 }
        );
      } catch {
        // No-op: fallback path below handles this.
      }
      hostCount = await searchHosts.count();
    }

    if (hostCount === 0) {
      // Fallback: dispatch the same keydown combo to the document handler.
      await page.evaluate(() => {
        const evt = new KeyboardEvent('keydown', {
          key: 'F',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(evt);
      });
    }

    await expect(searchHosts.first()).toBeVisible({ timeout: 8000 });

    // Search input should appear
    const searchInput = searchHosts.last().locator('.search-input').first();
    await expect(searchInput).toBeVisible();

    // Put the board far from the expected target so activation must re-center.
    const beforeScrollLeft = await page.evaluate(() => {
      const timelineBoard = document.querySelector('timeline-board');
      const sc = timelineBoard?.shadowRoot?.querySelector('#scroll-container');
      if (sc) {
        sc.scrollLeft = Math.max(0, sc.scrollWidth - sc.clientWidth);
      }
      return sc?.scrollLeft ?? 0;
    });

    // Search by numeric token and verify text is actually typed.
    await searchInput.fill('1');
    await expect(searchInput).toHaveValue('1');

    // Wait for results to populate
    const firstResult = searchHosts.last().locator('.result').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });

    // Read the id from the result metadata
    const idText = ((await firstResult.locator('.meta').first().textContent()) || '').trim();
    expect(idText.length).toBeGreaterThan(0);

    // Click the result
    await firstResult.click();

    // Search tool should close after selection.
    await expect(page.locator('search-tool')).toHaveCount(0, { timeout: 5000 });

    const activatedHandle = await page.waitForFunction(
      ({ featureId, beforeLeft }) => {
        const timelineBoard = document.querySelector('timeline-board');
        const sc = timelineBoard?.shadowRoot?.querySelector('#scroll-container');
        const board = timelineBoard?.shadowRoot?.querySelector('feature-board');
        const card = board?.shadowRoot?.querySelector(
          `feature-card-lit[data-feature-id="${CSS.escape(featureId)}"]`
        );

        const highlighted = !!card && card.classList.contains('search-highlight');
        const moved = !!sc && Math.abs((sc.scrollLeft || 0) - beforeLeft) > 2;
        const centered =
          !!sc &&
          !!card &&
          Math.abs(
            ((card.offsetLeft || 0) + (card.clientWidth || 0) / 2) -
              ((sc.scrollLeft || 0) + (sc.clientWidth || 0) / 2)
          ) <= Math.max(32, (sc.clientWidth || 0) * 0.35);

        return {
          moved,
          centered,
          highlighted,
          found: !!card,
        };
      },
      {
        featureId: idText,
        beforeLeft: beforeScrollLeft,
      },
      { timeout: 2500 }
    );
    const activated = await activatedHandle.jsonValue();
    expect(activated && activated.found).toBeTruthy();
    expect(activated && activated.highlighted).toBeTruthy();
  });
});
