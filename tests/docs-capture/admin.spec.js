import { test, expect } from '@playwright/test';
import { prepareDocsPage, shot } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const SECTIONS = [
  ['server', 'System Configuration', 'admin_server'],
  ['data-sources', 'Data Sources', 'admin_data_sources'],
  ['users', 'User Management', 'admin_users'],
  ['plugins', 'Plugins', 'admin_plugins'],
  ['projects', 'Plans', 'admin_plans'],
  ['ado-processes', 'Azure DevOps Processes', 'admin_ado_processes'],
  ['global-project-settings', 'Global Project Settings', 'admin_global_settings'],
  ['area-mappings', 'Area Mappings', 'admin_area_mappings'],
  ['iterations', 'Iteration sets', 'admin_iterations'],
  ['utilities', 'Utilities', 'admin_utilities'],
];

async function openSection(page, hash, heading) {
  await page.goto(`/admin/#${hash}`);
  await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1000);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await prepareDocsPage(page);
});

test('admin sections', async ({ page }) => {
  for (const [hash, heading, name] of SECTIONS) {
    await openSection(page, hash, heading);
    await shot(page, name);
  }
});

test('plans tabs and drawer', async ({ page }) => {
  await openSection(page, 'projects', 'Plans');
  await page.getByRole('tab', { name: 'Plan levels' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'admin_plan_levels');
  await page.getByRole('tab', { name: 'Default workforce' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'admin_default_workforce');
  await page.getByRole('tab', { name: 'Plans' }).click();

  // The synthetic backend has no Azure project/area browsing; serve a matching listing.
  await page.route('**/api/azure/projects*', (route) => route.fulfill({ json: { projects: ['Contoso'] } }));
  await page.route('**/api/azure/area-paths*', (route) => route.fulfill({ json: {
    area_paths: ['Contoso', 'Contoso\\Apollo', 'Contoso\\Hermes', 'Contoso\\Teams',
      'Contoso\\Teams\\Atlas', 'Contoso\\Teams\\Borealis', 'Contoso\\Teams\\Comet'],
  } }));
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  const drawer = page.locator('plan-drawer').getByRole('dialog');
  await expect(drawer).toBeVisible();
  await page.locator('plan-drawer').getByLabel('Azure DevOps project', { exact: true }).selectOption('Contoso');
  await expect(page.locator('plan-area-path-picker button.path').first()).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, 'admin_plan_drawer');
  await page.keyboard.press('Escape');
});

test('workforce tabs', async ({ page }) => {
  await openSection(page, 'workforce', 'Workforce');
  await page.locator('admin-workforce [aria-expanded="false"]').first().click();
  await page.waitForTimeout(400);
  await shot(page, 'admin_workforce_team');
  await page.getByRole('tab', { name: 'Suppliers & Profiles' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'admin_workforce_suppliers');
});
