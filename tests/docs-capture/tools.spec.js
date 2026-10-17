import { test, expect } from '@playwright/test';
import { openPlanner, shot } from './helpers.js';

test.describe.configure({ mode: 'serial' });

async function activateTool(page, label) {
  await page.locator('#toolsMenuBtn').click();
  await page.locator('tools-menu .sidebar-chip', { hasText: label }).click();
  await page.waitForTimeout(300);
  if (await page.locator('tools-menu').count() > 0) await page.locator('#toolsMenuBtn').click();
  await expect(page.locator('tools-menu')).toHaveCount(0);
  await page.waitForTimeout(1500);
}

test('full-screen tools', async ({ page }) => {
  await openPlanner(page);
  await activateTool(page, 'Portfolio Board');
  await expect(page.locator('plugin-portfolio-board')).toBeVisible();
  await shot(page, 'tool_portfolio');

  await openPlanner(page);
  await activateTool(page, 'XY Board');
  await expect(page.locator('plugin-xy-board')).toBeVisible();
  await shot(page, 'tool_xyboard');

  await openPlanner(page);
  await activateTool(page, 'Graph Viewer');
  await expect(page.locator('plugin-graph')).toBeVisible();
  await shot(page, 'tool_graph_viewer');

  await openPlanner(page);
  await activateTool(page, 'Cost Analysis');
  const cost = page.locator('plugin-cost');
  await expect(cost).toBeVisible();
  await shot(page, 'tool_cost_plan');
  for (const [tab, name] of [['Task View', 'tool_cost_task'], ['Team View', 'tool_cost_team'],
    ['Workforce', 'tool_cost_workforce']]) {
    await cost.locator('.tab-buttons button', { hasText: tab }).click();
    await page.waitForTimeout(800);
    if (tab === 'Workforce') await cost.locator('.team-summary').first().click();
    await shot(page, name);
  }
});

test('overlay tools', async ({ page }) => {
  await openPlanner(page);
  await activateTool(page, 'Task History');
  await expect(page.locator('plugin-history')).toBeVisible();
  await page.waitForTimeout(3000);
  await shot(page, 'tool_history');

  await openPlanner(page);
  await activateTool(page, 'Plan Markers');
  await shot(page, 'tool_markers');

  await openPlanner(page);
  await activateTool(page, 'Plan Events');
  const events = page.locator('plugin-events');
  await expect(events.locator('.floating-toolbar')).toBeVisible();
  await events.locator('.add-toggle-btn').first().click();
  const add = events.locator('.add-row').filter({ has: page.getByTitle('Event title') });
  await add.locator('input[type="date"]').first().fill('2026-08-24');
  await add.locator('input[type="date"]').first().dispatchEvent('input');
  await add.getByTitle('Event title').fill('Release readiness review');
  await add.getByTitle('Event title').dispatchEvent('input');
  await add.locator('.add-btn').click();
  await page.waitForTimeout(800);
  await shot(page, 'tool_events');

  await openPlanner(page);
  await activateTool(page, 'Export Timeline');
  await shot(page, 'tool_export');

  await openPlanner(page);
  // Annotation tools are only offered in an editable scenario.
  await page.locator('#scenarioMenuBtn').click();
  await page.locator('scenario-menu .copy-scenario-btn').click();
  await page.locator('scenario-clone-modal #cloneInput').fill('Annotated review');
  await page.locator('scenario-clone-modal #cloneBtn').click();
  await expect(page.locator('#scenarioMenuBtn')).toContainText('Annotated review');
  await activateTool(page, 'Annotations');
  const annotations = page.locator('plugin-annotations');
  await annotations.locator('.tool-btn[title^="Rectangle"]').click();
  await page.mouse.move(700, 330);
  await page.mouse.down();
  await page.mouse.move(1000, 480, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await shot(page, 'tool_annotations');
});
