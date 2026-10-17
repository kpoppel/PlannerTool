import { test, expect } from '@playwright/test';
import { fulfillAccountApi } from './helpers.js';

async function setup(page) {
  const state = {
    config: { schema_version: 4, container_types: ['Team', 'Program'],
      project_map: [], allocation_defaults: { Team: [], Program: [] } },
    catalogue: { schema_version: 1, processes: [] },
    saves: [], refreshes: [], resolves: [], metadataLoads: 0, rejectSave: false, failLoad: false,
    errors: [], holdLoad: null,
  };
  const process = { id: 'agile', name: 'Planner Agile', projects: ['Platform', 'Second'],
    parent_name: 'Agile', loaded_at: '2026-10-17T09:00:00Z', types: [
      ['Feature', 'portfolio'], ['Epic', 'portfolio'], ['Task', 'task'],
    ].map(([name, level]) => ({ name, reference_name: name, imported: false, missing: false,
      backlog_level: level, backlog: name, states: [{ name: 'New', category: 'Proposed', order: 1 }] })) };
  page.on('pageerror', (error) => state.errors.push(error.message));
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/release-notes')) return fulfillAccountApi(route, {});
    if (url.pathname.endsWith('/azure/projects')) return route.fulfill({ json: {
      projects: ['Platform', 'Second'],
    } });
    if (url.pathname.endsWith('/azure/area-paths')) {
      const project = url.searchParams.get('project');
      return route.fulfill({ json: { area_paths: [project, `${project}\\Alpha`, `${project}\\Beta`, `${project}\\Cancel`] } });
    }
    return route.fulfill({ json: { email: 'delegate@example.test', permissions: ['manage_projects'] } });
  });
  await page.route('**/admin/check', (route) => route.fulfill({ json: {
    ok: true, permissions: ['manage_projects'],
  } }));
  await page.route('**/admin/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/projects')) {
      if (request.method() === 'POST') {
        const command = request.postDataJSON();
        state.saves.push(command);
        if (state.rejectSave) return route.fulfill({ status: 400, json: { detail: {
          error: 'invalid_plan', message: 'Plan save denied',
        } } });
        state.config = command.content;
        for (const entry of state.catalogue.processes) {
          const refs = Object.hasOwn(command.process_imports, entry.id) ? command.process_imports[entry.id] : [];
          for (const type of entry.types) if (refs.includes(type.reference_name)) type.imported = true;
        }
      }
      return route.fulfill({ json: { ok: true, content: state.config } });
    }
    if (/\/projects\/[^/]+\/refresh$/.test(path)) {
      state.refreshes.push(path);
      if (state.holdLoad !== null) await state.holdLoad;
      if (state.failLoad) return route.fulfill({ status: 403, json: { detail: {
        error: 'area_not_readable', message: 'Cannot read this area',
      } } });
      return route.fulfill({ json: { plan_id: path.split('/').at(-2), item_count: 7, completed_at: 'now' } });
    }
    if (path.endsWith('/ado-processes/resolve')) {
      state.resolves.push(request.postDataJSON().project);
      if (state.catalogue.processes.length === 0) {
        state.metadataLoads += 1;
        state.catalogue.processes.push(structuredClone(process));
      }
      return route.fulfill({ json: { content: state.catalogue.processes[0] } });
    }
    if (path.endsWith('/ado-processes/refresh')) {
      return route.fulfill({ json: { ok: true, content: state.catalogue } });
    }
    if (path.endsWith('/ado-processes')) return route.fulfill({ json: { content: state.catalogue } });
    if (path.endsWith('/workforce')) return route.fulfill({ json: { content: {
      teams: { schema_version: 3, groups: [{ id: 'group', name: 'Delivery', archived: false }],
        teams: [{ id: 'team', name: 'Engine', group_id: 'group', archived: false }] },
    } } });
    if (path.endsWith('/iterations')) return route.fulfill({ json: { content: {
      iteration_sets: [{ id: 'calendar', name: 'Delivery calendar' }],
    } } });
    if (path.endsWith('/browse-config')) return route.fulfill({ json: { content: { organization_url: 'Fixture' } } });
    return route.fulfill({ status: 404, json: { detail: `Unexpected endpoint ${path}` } });
  });
  await page.goto('/admin/#projects');
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
  return state;
}

async function startPlan(page, project, area) {
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  const drawer = page.locator('plan-drawer');
  await drawer.getByLabel('Azure DevOps project', { exact: true }).selectOption(project);
  const picker = drawer.locator('plan-area-path-picker');
  const pathList = picker.locator('.paths');
  await expect(pathList).toBeVisible();
  const bottomGap = await drawer.evaluate((element) => {
    const body = element.shadowRoot.querySelector('.body');
    const paths = element.shadowRoot.querySelector('plan-area-path-picker').shadowRoot.querySelector('.paths');
    const bodyBottom = body.getBoundingClientRect().bottom;
    const pathsBottom = paths.getBoundingClientRect().bottom;
    return bodyBottom - parseFloat(getComputedStyle(body).paddingBottom) - pathsBottom;
  });
  expect(bottomGap).toBeLessThanOrEqual(1);
  await drawer.locator('plan-area-path-picker').getByRole('button', { name: area, exact: true }).click();
  await drawer.getByRole('button', { name: 'Next', exact: true }).click();
  return drawer;
}

async function finishPlan(drawer) {
  await drawer.getByRole('button', { name: 'Next', exact: true }).click();
  await drawer.getByRole('button', { name: 'Next', exact: true }).click();
  await drawer.getByRole('button', { name: 'Create plan', exact: true }).click();
}

test('Delegate creates from an empty catalogue, reuses metadata and cancels without imports', async ({ page }, testInfo) => {
  const state = await setup(page);
  await expect(page.getByRole('button', { name: 'Raw JSON', exact: true })).toHaveCount(0);
  let drawer = await startPlan(page, 'Platform', 'Alpha');
  await expect(drawer.getByLabel('Plan name', { exact: true })).toHaveValue('Alpha');
  await expect(drawer.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await expect(drawer.getByRole('checkbox', { name: 'Task', exact: false })).toBeDisabled();
  await drawer.getByRole('checkbox', { name: 'Feature', exact: false }).check();
  await drawer.getByLabel('Closed work history', { exact: true }).selectOption('90');
  await drawer.getByLabel('Iteration set', { exact: true }).selectOption('calendar');
  await page.screenshot({ path: testInfo.outputPath('plans-drawer-desktop.png') });
  let completeLoad;
  state.holdLoad = new Promise((resolve) => { completeLoad = resolve; });
  await finishPlan(drawer);
  await expect(drawer.getByRole('status')).toHaveText('Loading work items...');
  await expect(drawer.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  completeLoad();
  state.holdLoad = null;
  await expect(drawer.getByRole('status')).toHaveText('Loaded 7 work items');
  expect(state.saves[0].process_imports).toEqual({ agile: ['Feature'] });
  expect(state.config.project_map[0].closed_history_days).toBe(90);
  await drawer.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('plans-list')).toContainText('Alpha');

  drawer = await startPlan(page, 'Second', 'Beta');
  await expect(drawer.getByRole('checkbox', { name: 'Feature', exact: false })).toBeChecked();
  await finishPlan(drawer);
  await expect(drawer.getByRole('status')).toHaveText('Loaded 7 work items');
  await drawer.getByRole('button', { name: 'Done', exact: true }).click();
  expect(state.metadataLoads).toBe(1);
  expect(state.resolves).toEqual(['Platform', 'Second']);

  drawer = await startPlan(page, 'Platform', 'Cancel');
  await drawer.getByRole('checkbox', { name: 'Epic', exact: false }).check();
  await drawer.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.saves).toHaveLength(2);
  expect(state.catalogue.processes[0].types.find((type) => type.name === 'Epic').imported).toBe(false);
  await page.getByRole('button', { name: 'Azure DevOps Processes', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Import Feature from Planner Agile', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Reload from Azure DevOps', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Process definitions reloaded');
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('plans-catalogue-desktop.png') });
});

test('Delegate edits, reorders, archives, restores and changes default workforce', async ({ page }, testInfo) => {
  const state = await setup(page);
  let drawer = await startPlan(page, 'Platform', 'Alpha');
  await drawer.getByRole('checkbox', { name: 'Feature', exact: false }).check();
  await finishPlan(drawer);
  await expect(drawer.getByRole('status')).toContainText('Loaded 7');
  await drawer.getByRole('button', { name: 'Done', exact: true }).click();
  drawer = await startPlan(page, 'Platform', 'Beta');
  await finishPlan(drawer);
  await expect(drawer.getByRole('status')).toContainText('Loaded 7');
  await drawer.getByRole('button', { name: 'Done', exact: true }).click();
  const list = page.locator('plans-list');
  await list.getByRole('button', { name: 'Alpha', exact: true }).click();
  drawer = page.locator('plan-drawer');
  await expect(drawer.getByLabel('Closed work history', { exact: true })).toHaveValue('0');
  await expect(drawer.getByLabel('Plan level', { exact: true })).toHaveValue('Team');
  await drawer.getByLabel('Plan name', { exact: true }).fill('Renamed');
  await drawer.getByLabel('Closed work history', { exact: true }).selectOption('30');
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer.getByRole('status')).toContainText('Loaded 7');
  await drawer.getByRole('button', { name: 'Done', exact: true }).click();
  await list.getByLabel('Actions for Beta', { exact: true }).click();
  await list.getByRole('button', { name: 'Move up', exact: true }).last().click();
  await expect(list.locator('.name')).toHaveText(['Beta', 'Renamed']);
  expect(state.config.project_map.map((plan) => plan.name)).toEqual(['Beta', 'Renamed']);
  const source = list.locator('.plan-row').first();
  const target = list.locator('.plan-row').last();
  const handleBounds = await source.locator('.handle').boundingBox();
  const targetBounds = await target.boundingBox();
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBounds.x + handleBounds.width / 2 + 10, handleBounds.y + handleBounds.height / 2, { steps: 5 });
  await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + 8, { steps: 10 });
  await expect(source).toHaveClass('plan-row dragging');
  await expect(target).toHaveAttribute('data-drop-position', 'before');
  await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + targetBounds.height - 8, { steps: 5 });
  await expect(target).toHaveAttribute('data-drop-position', 'after');
  const marker = await target.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return { height: style.height, color: style.backgroundColor, bottom: style.bottom };
  });
  expect(marker).toEqual({ height: '3px', color: 'rgb(37, 99, 235)', bottom: '-2px' });
  expect(await target.boundingBox()).toEqual(targetBounds);
  await page.screenshot({ path: testInfo.outputPath('plans-drag-insertion-desktop.png') });
  await page.mouse.up();
  await expect(list.locator('.name')).toHaveText(['Renamed', 'Beta']);
  await expect(list.locator('.dragging')).toHaveCount(0);
  await expect(list.locator('[data-drop-position="after"]')).toHaveCount(0);
  expect(state.config.project_map.map((plan) => plan.name)).toEqual(['Renamed', 'Beta']);
  await list.getByLabel('Actions for Renamed', { exact: true }).click();
  await list.locator('.plan-row').filter({ hasText: 'Renamed' }).getByRole('button', { name: 'Archive', exact: true }).click();
  await list.getByLabel('Filter by level', { exact: true }).selectOption('archived');
  await expect(list.locator('.name')).toHaveText(['Renamed']);
  await list.getByLabel('Actions for Renamed', { exact: true }).click();
  await list.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(list.getByLabel('Filter by level', { exact: true })).toHaveValue('');
  await expect(list.locator('.name')).toHaveText(['Renamed', 'Beta']);
  await page.getByRole('tab', { name: 'Default workforce', exact: true }).click();
  const defaults = page.locator('plan-default-workforce');
  await defaults.getByRole('checkbox', { name: 'Delivery', exact: true }).check();
  await expect(defaults.locator('.summary')).toContainText('Delivery');
  await expect(defaults.getByRole('checkbox', { name: 'Engine', exact: true })).not.toBeChecked();
  expect(state.config.allocation_defaults.Team).toEqual(['group']);
  expect(state.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('plans-workforce-desktop.png') });
});

test('Rejected create retains the draft; failed data load keeps the plan and offers Retry', async ({ page }, testInfo) => {
  const state = await setup(page);
  const drawer = await startPlan(page, 'Platform', 'Alpha');
  await drawer.getByRole('checkbox', { name: 'Feature', exact: false }).check();
  state.rejectSave = true;
  await finishPlan(drawer);
  await expect(drawer.getByRole('alert')).toHaveText('Plan save denied');
  expect(state.config.project_map).toEqual([]);
  expect(state.catalogue.processes[0].types[0].imported).toBe(false);
  state.rejectSave = false;
  state.failLoad = true;
  await drawer.getByRole('button', { name: 'Create plan', exact: true }).click();
  await expect(drawer.getByRole('status')).toContainText('Data not loaded');
  expect(state.config.project_map).toHaveLength(1);
  await drawer.getByRole('button', { name: 'Done', exact: true }).click();
  const list = page.locator('plans-list');
  await expect(list).toContainText('Data not loaded');
  state.failLoad = false;
  await list.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(list).toContainText('Loaded 7 work items');
  expect(state.refreshes).toHaveLength(2);
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('plans-list-desktop.png') });
});