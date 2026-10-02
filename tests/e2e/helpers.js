import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const test = base.extend({
  activeScenario: async ({ page }, use) => {
    const response = await page.request.get('/api/tasks');
    expect(response.ok()).toBe(true);
    const tasks = await response.json();
    const feature = tasks.find((task) =>
      task.relations.every((relation) => relation.type !== 'Child'));
    expect(feature, 'Expected a generated leaf task').toBeDefined();
    const start = '2026-10-15';
    const end = '2026-11-20';
    const scenario = await createScenario(page, {
      [feature.id]: { start, end, iterationPath: '' },
    });
    try {
      await activateScenario(page, scenario);
      await use({ ...scenario, feature, start, end });
    } finally {
      await deleteScenario(page, scenario);
    }
  },
});

export async function createScenario(page, overrides) {
  const id = randomUUID();
  const name = `Desktop ${id.slice(0, 8)}`;
  const response = await page.request.post('/api/scenario', {
    data: { op: 'save', data: { id, name, overrides } },
  });
  expect(response.ok()).toBe(true);
  const metadata = await response.json();
  expect(metadata.id).toBe(id);
  return { id, name };
}

export async function deleteScenario(page, scenario) {
  const response = await page.request.post('/api/scenario', {
    data: { op: 'delete', data: { id: scenario.id } },
  });
  expect(response.ok()).toBe(true);
}

export async function activateScenario(page, scenario) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await clearOverlays(page);
  const button = page.getByRole('navigation', { name: 'Top menu' })
    .getByRole('button', { name: /^Scenario(?:\s|$)/ });
  await button.click();
  await page.locator('scenario-menu').getByTitle(scenario.name, { exact: true }).click();
  await expect(button).toContainText(scenario.name);
  await waitForFeatureCards(page);
}

export async function saveScenarioChanges(page, scenario) {
  await page.getByRole('navigation', { name: 'Top menu' })
    .getByRole('button', { name: /^Scenario(?:\s|$)/ }).click();
  const item = page.locator('scenario-menu .scenario-item').filter({
    has: page.getByTitle(scenario.name, { exact: true }),
  });
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/scenario') &&
      response.request().method() === 'POST'),
    item.getByTitle('Save scenario changes', { exact: true }).click(),
  ]);
  expect(response.ok()).toBe(true);
  const saved = await page.request.get(`/api/scenario?id=${encodeURIComponent(scenario.id)}`);
  expect(saved.ok()).toBe(true);
  return saved.json();
}

export async function clearOverlays(page) {
  await page.evaluate(() => {
    const overlaySelectors = [
      'onboarding-modal',
      '.onboarding-modal',
      '#onboardingModal',
      '.modal-backdrop',
      '#appSpinner',
      '.modal-spinner',
      '.overlay',
      '.onboarding-overlay',
    ];
    overlaySelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    });
  });
  // Allow any UI to settle
  await page.waitForTimeout(100);
}

export async function selectAllPlans(page) {
  await page.waitForLoadState('networkidle');
  const planButton = page.getByRole('navigation', { name: 'Top menu' })
    .getByRole('button', { name: /^Plan(?:\s|$)/ });
  await expect(planButton).toBeVisible();
  await planButton.click();

  const toggle = page.locator('plan-menu').getByTitle('Select or clear all plans', {
    exact: true,
  });
  await expect(toggle).toBeVisible();
  if ((await toggle.textContent()).trim() === 'All') {
    await toggle.click();
  } else {
    await planButton.click();
  }
}

export async function waitForFeatureCards(page, timeout = 30000) {
  await selectAllPlans(page);
  const timelineRegion = page.getByRole('region', { name: 'Timeline and Features' });
  await expect(timelineRegion).toBeVisible({ timeout });
  await expect(page.locator('feature-card-lit').first()).toBeVisible({ timeout });
}
