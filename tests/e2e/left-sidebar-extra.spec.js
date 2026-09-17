import { test, expect } from '@playwright/test';
import { clearOverlays, selectAllPlans } from './helpers.js';

async function waitForSidebar(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector('app-sidebar');
    return !!(host && host.shadowRoot && host.shadowRoot.querySelector('aside.sidebar'));
  });
}

test.describe('Left Sidebar - Extra coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSidebar(page);
    await clearOverlays(page);
    await selectAllPlans(page);
  });

  test('data funnel renders numeric counters', async ({ page }) => {
    const funnel = page.getByRole('status', {
      name: 'Current planning scope and displayed task counts',
    });
    const texts = await funnel.locator('.status-metric > span:last-child').allTextContents();
    expect(texts.length).toBe(3);
    for (const t of texts) {
      expect(/^[-+]?\d+$/.test(String(t).trim())).toBe(true);
    }
  });

  test('Team Drill-down explains when the selected plan has no assigned teams', async ({ page }) => {
    await expect(
      page.locator('app-sidebar').getByText('This plan has no teams assigned.')
    ).toBeVisible();
  });

  test('task filter option toggles active class when enabled', async ({ page }) => {
    const stateBefore = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const option = root?.querySelector('.filter-dimensions .filter-option');
      return {
        exists: !!option,
        disabled: !!option && option.classList.contains('disabled'),
        active: !!option && option.classList.contains('active'),
      };
    });

    expect(stateBefore.exists).toBe(true);
    test.skip(stateBefore.disabled, 'First filter option is currently disabled by context');

    await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const option = root?.querySelector('.filter-dimensions .filter-option');
      option?.click();
    });

    await page.waitForFunction((before) => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const option = root?.querySelector('.filter-dimensions .filter-option');
      return !!option && option.classList.contains('active') !== before;
    }, stateBefore.active);
  });
});
