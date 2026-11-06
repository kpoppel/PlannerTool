import { test, expect } from '@playwright/test';
import { clearOverlays, selectAllPlans } from './helpers.js';

async function waitForSidebar(page) {
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toBeVisible();
}

test.describe('Task list and board menus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSidebar(page);
    await clearOverlays(page);
    await selectAllPlans(page);
  });

  test('renders one task list, the existing board, and server status without a sidebar', async ({ page }) => {
    await expect(page.locator('app-sidebar')).toHaveCount(0);
    await expect(page.locator('task-list')).toHaveCount(1);
    await expect(page.locator('feature-board')).toHaveCount(1);
    await expect(page.locator('app-footer .footer-line.status')).not.toBeEmpty();
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
    await page.getByRole('button', { name: 'Task Filters', exact: true }).click();
    const controls = page.locator('board-controls-menu');
    expect(await controls.locator('.filter-dimensions .filter-option').count()).toBeGreaterThan(2);
    await controls.press('Escape');
    await expect(page.getByRole('button', { name: 'Task Filters', exact: true })).toBeFocused();
  });

  test('aligns frozen labels with board rows while scrolling and restores titles when collapsed', async ({ page }) => {
    await expect(page.locator('task-list [data-task-id]').first()).toBeVisible();
    const geometry = () => page.evaluate(() => {
      const shell = document.querySelector('timeline-board').shadowRoot;
      const list = shell.querySelector('task-list');
      const board = shell.querySelector('feature-board');
      const row = list.shadowRoot.querySelector('[data-task-id]');
      const card = board.shadowRoot.querySelector(`feature-card-lit[data-feature-id="${row.dataset.taskId}"]`);
      return { left: list.getBoundingClientRect().left, top: row.getBoundingClientRect().top,
        cardTop: card.getBoundingClientRect().top,
        hiddenTitle: card.shadowRoot.querySelector('.feature-title') === null };
    });
    const before = await geometry();
    expect(Math.abs(before.top - before.cardTop)).toBeLessThan(1);
    expect(before.hiddenTitle).toBe(true);
    await page.locator('timeline-board #scroll-container').evaluate((scroll) => {
      scroll.scrollLeft += 160;
      scroll.scrollTop = 90;
    });
    const after = await geometry();
    expect(after.left).toBe(before.left);
    expect(Math.abs(after.top - after.cardTop)).toBeLessThan(1);
    expect(after.top).toBeLessThan(before.top);
    await page.getByRole('button', { name: 'Collapse task list', exact: true }).click();
    await expect(page.locator('task-list')).toBeHidden();
    await expect(page.locator('feature-card-lit .feature-title').first()).toBeAttached();
    await page.getByRole('button', { name: 'Restore task list', exact: true }).click();
    await expect(page.locator('task-list')).toBeVisible();
    await page.screenshot({ path: 'test-results/task-list-desktop.png' });
  });

  test('searches task IDs without filtering rows and opens shared details from the task list', async ({ page }) => {
    const rows = page.locator('task-list [data-task-id]');
    const count = await rows.count();
    const id = await rows.first().getAttribute('data-task-id');
    const search = page.getByRole('searchbox', { name: 'Search tasks' });
    await search.fill(id);
    await search.press('Enter');
    await expect(page.locator(`feature-card-lit[data-feature-id="${id}"]`)).toHaveClass(/search-highlight/);
    await expect(rows).toHaveCount(count);
    await rows.first().locator('.task-title').click();
    await expect(page.locator('details-panel .panel')).toBeVisible();
    await expect(rows.first()).toHaveClass(/selected/);
  });
});
