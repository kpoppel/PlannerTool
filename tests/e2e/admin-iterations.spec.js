import { test, expect } from '@playwright/test';
import { fulfillAccountApi } from './helpers.js';

async function setup(page, initialSets = [], usage = {}) {
  const state = { sets: initialSets, saves: [], errors: [], browsing: 0, rejectSave: false };
  page.on('pageerror', (error) => state.errors.push(error.message));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/release-notes')) return fulfillAccountApi(route, {});
    if (path.endsWith('/azure/projects')) return route.fulfill({ json: { projects: ['ADO'] } });
    return route.fulfill({ json: { email: 'iterations@example.test', permissions: ['manage_iterations', 'manage_projects'] } });
  });
  await page.route('**/admin/check', (route) => route.fulfill({ json: { ok: true, permissions: ['manage_iterations', 'manage_projects'] } }));
  await page.route('**/admin/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/iterations/browse')) {
      state.browsing += 1;
      return route.fulfill({ json: { iterations: [
        { path: 'ADO\\Release', name: 'Release' },
        { path: 'ADO\\Release\\One', name: 'One', startDate: '2026-10-19', finishDate: '2026-11-01' },
        { path: 'ADO\\Release\\Two', name: 'Two', startDate: '2026-11-02', finishDate: '2026-11-15' },
      ] } });
    }
    if (path.endsWith('/iterations')) {
      if (request.method() === 'POST') {
        state.saves.push(request.postDataJSON().content);
        if (state.rejectSave) return route.fulfill({ status: 400, json: {
          error: 'invalid_payload', message: 'Iteration save denied',
        } });
        state.sets = request.postDataJSON().content.iteration_sets;
      }
      return route.fulfill({ json: { ok: true, content: { iteration_sets: state.sets, usage } } });
    }
    if (path.endsWith('/browse-config')) return route.fulfill({ json: { content: { organization_url: 'Fixture' } } });
    if (path.endsWith('/projects')) return route.fulfill({ json: { content: { schema_version: 4,
      container_types: ['project'], project_map: [], allocation_defaults: { project: [] } } } });
    if (path.endsWith('/ado-processes')) return route.fulfill({ json: { content: { schema_version: 1, processes: [] } } });
    if (path.endsWith('/workforce')) return route.fulfill({ json: { content: { teams: { schema_version: 3, groups: [], teams: [] } } } });
    return route.fulfill({ status: 404, json: { detail: `Unexpected endpoint ${path}` } });
  });
  await page.goto('/admin/#iterations');
  await expect(page.getByRole('heading', { name: 'Iteration sets', exact: true })).toBeVisible();
  return state;
}

async function create(page, name, source) {
  await page.getByRole('button', { name: '+ New set', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New iteration set', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Source', exact: true })).toHaveValue('generated');
  await dialog.getByLabel('Set name', { exact: true }).fill(name);
  await dialog.getByRole('combobox', { name: 'Source', exact: true }).selectOption(source);
  if (source === 'ado') await dialog.getByRole('combobox', { name: 'Azure DevOps project', exact: true }).selectOption('ADO');
  await dialog.getByRole('button', { name: 'Create draft', exact: true }).click();
}

test('Date generator previews clipped ranges, blocks stale saves, and restores saved recipes', async ({ page }, testInfo) => {
  const state = await setup(page);
  await create(page, 'Delivery cycles', 'generated');
  await expect(page.getByRole('combobox', { name: 'Generate by', exact: true })).toHaveValue('count');
  await expect(page.getByRole('combobox', { name: 'Unit', exact: true })).toHaveValue('weeks');
  await page.getByLabel('Start date', { exact: true }).fill('2026-10-19');
  await page.getByRole('combobox', { name: 'Generate by', exact: true }).selectOption('until');
  await page.getByLabel('End date (inclusive)', { exact: true }).fill('2026-11-20');
  await expect(page.getByRole('button', { name: 'Save set', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate preview', exact: true }))
    .toHaveCSS('background-color', 'rgb(18, 91, 87)');
  const preview = page.getByRole('region', { name: 'Resulting set', exact: true });
  await expect(preview.locator('tbody tr')).toHaveCount(3);
  await expect(preview).toContainText('Final iteration shortened to 5 calendar days');
  await page.screenshot({ path: testInfo.outputPath('iterations-generated-desktop.png') });
  const bounds = await page.getByRole('button', { name: 'Save set', exact: true }).boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
  await page.getByRole('button', { name: 'Save set', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Set saved');
  expect(state.sets[0].values.at(-1).finishDate).toBe('2026-11-20');
  expect(state.sets[0].source_project).toBeNull();
  await page.getByLabel('Iteration length', { exact: true }).fill('1');
  await expect(preview).toContainText('Out of date');
  await expect(page.getByRole('button', { name: 'Save set', exact: true })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByLabel('Iteration length', { exact: true })).toHaveValue('2');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Generate by', exact: true })).toHaveValue('until');
  expect(state.browsing).toBe(0);
  expect(state.errors).toEqual([]);
});

test('Manual dates can be added, edited, removed, and retained after a save error', async ({ page }) => {
  const state = await setup(page);
  await create(page, 'Local calendar', 'manual');
  await page.getByRole('button', { name: '+ Add iteration', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Iteration dates' });
  await dialog.getByLabel('Iteration name', { exact: true }).fill('Planning');
  await dialog.getByLabel('Start date', { exact: true }).fill('2026-10-19');
  await dialog.getByLabel('End date (inclusive)', { exact: true }).fill('2026-10-23');
  await dialog.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Planning', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Iteration dates' });
  await dialog.getByLabel('Iteration name', { exact: true }).fill('Review');
  await dialog.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  state.rejectSave = true;
  await page.getByRole('button', { name: 'Save set', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Iteration save denied');
  await expect(page.getByRole('region', { name: 'Resulting set' })).toContainText('Review');
  state.rejectSave = false;
  await page.getByRole('button', { name: 'Save set', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Set saved');
  await page.getByRole('button', { name: 'Remove Review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save set', exact: true })).toBeDisabled();
  expect(state.browsing).toBe(0);
  expect(state.errors).toEqual([]);
});

test('ADO selection previews exact dated members, preserves filtering, and reports plan usage', async ({ page }) => {
  const state = await setup(page, [], {});
  await create(page, 'Release', 'ado');
  await page.getByRole('checkbox', { name: 'Include ADO\\Release', exact: true }).check();
  const preview = page.getByRole('region', { name: 'Resulting set' });
  await expect(preview.locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('Find an iteration', { exact: true }).fill('Two');
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(preview.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Save set', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Set saved');
  expect(state.sets[0].selected_paths).toHaveLength(3);
  expect(state.sets[0].values).toHaveLength(2);
  expect(state.errors).toEqual([]);
});

test('ADO tree drills through nested branches and preserves selected hidden descendants', async ({ page }, testInfo) => {
  const state = await setup(page);
  const paths = ['ADO\\Release', 'ADO\\Release\\2026', 'ADO\\Release\\2026\\Q4',
    'ADO\\Release\\2026\\Q4\\One', 'ADO\\Release\\2026\\Q4\\Two', 'ADO\\Release\\2027'];
  await page.route('**/admin/v1/iterations/browse', (route) => route.fulfill({ json: { iterations:
    paths.map((path) => ({ path, name: path.split('\\').at(-1),
      startDate: path.endsWith('One') || path.endsWith('Two') ? '2026-10-19' : null,
      finishDate: path.endsWith('One') || path.endsWith('Two') ? '2026-11-01' : null,
    })),
  } }));
  await create(page, 'Nested release', 'ado');
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await page.getByRole('button', { name: 'Expand ADO\\Release', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.getByRole('button', { name: 'Expand ADO\\Release\\2026', exact: true }).click();
  const quarter = page.getByRole('button', { name: 'Expand ADO\\Release\\2026\\Q4', exact: true });
  await quarter.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('checkbox', { name: 'Include ADO\\Release\\2026\\Q4\\One', exact: true }).check();
  expect(await page.getByRole('checkbox', { name: 'Include ADO\\Release', exact: true }).evaluate((checkbox) => checkbox.indeterminate)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('iterations-ado-tree-desktop.png') });
  await page.getByRole('button', { name: 'Collapse ADO\\Release', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Resulting set' }).locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Find an iteration', { exact: true }).fill('Two');
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await expect(page.getByRole('checkbox', { name: 'Include ADO\\Release\\2026\\Q4\\Two', exact: true })).toBeVisible();
  await page.getByLabel('Find an iteration', { exact: true }).fill('');
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(6);
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  expect(state.errors).toEqual([]);
});

test('Unsaved section navigation is cancellable and in-use sets cannot be deleted', async ({ page }) => {
  const row = { path: 'cycle', name: 'Cycle', startDate: '2026-10-19', finishDate: '2026-11-01' };
  await setup(page, [{ id: 'used', name: 'Used calendar', source_type: 'manual', source_project: null,
    root_path: null, generator: null, selected_paths: [], values: [row], cached_at: null }],
  { used: [{ id: 'plan', name: 'Delivery plan' }] });
  await page.getByRole('tab', { name: 'Used by (1)', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Delivery plan');
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete set', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Rename set', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Set name').fill('Renamed');
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(page).toHaveURL(/#iterations$/);
  await expect(page.getByRole('heading', { name: 'Renamed', exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.evaluate(() => { location.hash = 'projects'; });
  await expect(page).toHaveURL(/#iterations$/);
});