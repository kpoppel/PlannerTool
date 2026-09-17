import { test, expect } from '@playwright/test';
import { clearOverlays, selectAllPlans } from './helpers.js';

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
    await selectAllPlans(page);
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

  test('Scope menu toggles canonical Context', async ({ page }) => {
    await page.getByRole('button', { name: 'Scope' }).click();
    const ancestors = page.locator('scope-menu').getByRole('button', { name: /Ancestors/ });
    await expect(ancestors).toBeVisible();
    const before = await ancestors.getAttribute('aria-pressed');

    await ancestors.click();

    await expect(ancestors).toHaveAttribute(
      'aria-pressed',
      before === 'true' ? 'false' : 'true'
    );
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
