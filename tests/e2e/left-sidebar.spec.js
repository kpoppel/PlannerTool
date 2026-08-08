import { test, expect } from '@playwright/test';
import { clearOverlays } from './helpers.js';

async function waitForSidebar(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector('app-sidebar');
    return !!(host && host.shadowRoot && host.shadowRoot.querySelector('aside.sidebar'));
  });
}

test.describe('Left Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSidebar(page);
    await clearOverlays(page);
  });

  test('renders sidebar and server status', async ({ page }) => {
    const statusText = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const sidebar = root?.querySelector('aside.sidebar');
      const status = root?.querySelector('.footer-line.status');
      return {
        hasSidebar: !!sidebar,
        text: (status?.textContent || '').trim(),
      };
    });
    expect(statusText.hasSidebar).toBe(true);
    expect(statusText.text.length).toBeGreaterThan(0);
  });

  test('timeline scale segmented controls switch active mode', async ({ page }) => {
    const clickedWeeks = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const btn = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Weeks'
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    expect(clickedWeeks).toBe(true);

    await page.waitForFunction(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const btn = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Weeks'
      );
      return !!btn && btn.classList.contains('active');
    });

    const clickedMonths = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const btn = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Months'
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    expect(clickedMonths).toBe(true);

    await page.waitForFunction(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const btn = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Months'
      );
      return !!btn && btn.classList.contains('active');
    });
  });

  test('expand dataset option toggles active state', async ({ page }) => {
    const stateBefore = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const row = Array.from(root?.querySelectorAll('.option-row') || []).find((el) =>
        (el.textContent || '').includes('Parent/Child Links')
      );
      return {
        exists: !!row,
        disabled: row?.getAttribute('aria-disabled') === 'true',
        active: !!row && row.classList.contains('active'),
      };
    });

    expect(stateBefore.exists).toBe(true);
    test.skip(stateBefore.disabled, 'Expansion row disabled by current plugin context');

    await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const row = Array.from(root?.querySelectorAll('.option-row') || []).find((el) =>
        (el.textContent || '').includes('Parent/Child Links')
      );
      row?.click();
    });

    await page.waitForFunction((before) => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const row = Array.from(root?.querySelectorAll('.option-row') || []).find((el) =>
        (el.textContent || '').includes('Parent/Child Links')
      );
      return !!row && row.classList.contains('active') !== before;
    }, stateBefore.active);
  });

  test('task filters section renders options', async ({ page }) => {
    const info = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const hasTitle = Array.from(root?.querySelectorAll('.section-title') || []).some(
        (el) => (el.textContent || '').includes('Task Filters')
      );
      const optionCount = root?.querySelectorAll('.filter-dimensions .filter-option')
        ?.length || 0;
      return { hasTitle, optionCount };
    });

    expect(info.hasTitle).toBe(true);
    expect(info.optionCount).toBeGreaterThan(2);
  });
});
