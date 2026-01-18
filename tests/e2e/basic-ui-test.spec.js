import { test, expect } from '@playwright/test';
import { clearOverlays } from './helpers.js';

test('Basic UI Test - Verify Homepage', async ({ page }) => {
  // Navigate to the homepage using baseURL from config
  await page.goto('/');

  // Remove blocking overlays then verify the title of the page
  await clearOverlays(page);
  // Accept either branded 'AZ Planner' or generic 'PlannerTool'
  await expect(page).toHaveTitle(/PlannerTool|AZ Planner/);

  // The app doesn't render an <h1> by default; check for app container and title instead
  await expect(page).toHaveTitle(/PlannerTool|AZ Planner/);
  await page.waitForSelector('#app', { timeout: 5000 });
  const appContainer = page.locator('#app');
  await expect(appContainer).toBeVisible();
});