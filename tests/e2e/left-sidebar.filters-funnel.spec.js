import { test, expect } from '@playwright/test';
import { clearOverlays, selectAllPlans } from './helpers.js';

async function waitForSidebar(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector('app-sidebar');
    return !!(host && host.shadowRoot && host.shadowRoot.querySelector('aside.sidebar'));
  });
}

test.describe('Left Sidebar - filters and data funnel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSidebar(page);
    await clearOverlays(page);
    await selectAllPlans(page);
  });

  test('board information reconciles the task pool to the on-board count', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /^\d+ on board$/ });
    await expect(trigger).toBeVisible();
    await page.locator('top-menu-bar #planMenuBtn').click();
    const planCounts = await page.locator('plan-menu .chip.active .chip-badge').allTextContents();
    const planTotal = planCounts.reduce((sum, count) => sum + Number(count.trim()), 0);
    await trigger.click();
    const information = page.getByRole('dialog', { name: 'Board information' });
    await expect(information).toBeVisible();
    const entries = await information.locator('.count-row').evaluateAll((rows) => rows.map((row) => [
      row.getAttribute('data-count'),
      Number(row.querySelector('.count-value').textContent.trim().replace('=', '')),
    ]));
    const counts = new Map(entries);
    const sharedTasks = counts.has('Shared tasks counted once') ? counts.get('Shared tasks counted once') : 0;
    expect(counts.get('Selected plans (Plan menu total)')).toBe(planTotal);
    expect(planTotal + sharedTasks + counts.get('Added by Scope')
      + counts.get('Excluded from current scope')).toBe(counts.get('Displayable task pool'));
    let remainingTasks = counts.get('Displayable task pool');
    for (const label of ['Schedule', 'Allocation', 'Hierarchy', 'Relations', 'State', 'Task Types', 'Team selection / focus']) {
      expect(counts.has(label)).toBe(true);
      remainingTasks += counts.get(label);
    }
    expect(remainingTasks).toBe(counts.get('On board'));
    await expect(trigger).toHaveText(`ⓘ ${remainingTasks} on board`);
    await trigger.press('Escape');
    await expect(information).not.toBeVisible();
    await expect(trigger).toBeFocused();
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
