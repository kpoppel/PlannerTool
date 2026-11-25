import { expect, test } from '@playwright/test';
import { activateScenario, createScenario } from './helpers.js';

test('resolves a Local field conflict and publishes the reviewed relation to both tasks', async ({ page }) => {
  page.on('pageerror', (error) => console.error(error));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  const enroll = await page.request.post('/api/auth/enroll', { data: {
    email: 'local-publication@example.com', name: 'Local publication',
  }, headers: { Accept: 'application/json' } });
  expect(enroll.ok()).toBe(true);
  const { releaseId } = await (await page.request.get('/api/auth/release-notes')).json();
  const acknowledged = await page.request.post('/api/auth/release-notes', { data: { releaseId } });
  expect(acknowledged.ok()).toBe(true);
  await page.addInitScript(() => localStorage.setItem('az_planner:onboarding_seen', '1'));
  const catalogue = await page.request.post('/admin/v1/local/catalogue/starter', { data: { content: { revision: 0 } } });
  expect(catalogue.ok()).toBe(true);
  const types = (await catalogue.json()).content.processes[0].types;
  const planId = '11111111-1111-4111-8111-111111111111';
  const plans = await page.request.put('/admin/v1/local/plans', { data: { content: { revision: 0, plans: [{
    id: planId, name: 'Local plan', type: 'project', archived: false,
    task_types: types.slice(0, 2).map((type) => type.id),
    closed_history_days: 0, iteration_uuid: null, markers: [],
  }] } } });
  expect(plans.ok()).toBe(true);
  const create = async (typeId, title) => {
    const response = await page.request.post('/api/tasks/create', { data: {
      project: planId, typeId, title, start: '2026-12-01', end: '2026-12-08',
    } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const parent = await create(types[0].id, 'Local parent');
  const child = await create(types[1].id, 'Local child');
  const scenario = await createScenario(page, { [child.id]: {
    relations: [{ type: 'Parent', id: parent.id }], tags: 'Proposed',
  } });
  await activateScenario(page, scenario);
  await page.getByRole('navigation', { name: 'Top menu' }).getByRole('button', { name: /^Scenario(?:\s|$)/ }).click();
  await page.locator('scenario-menu .scenario-item').filter({ has: page.getByTitle(scenario.name, { exact: true }) })
    .getByTitle('Publish scenario', { exact: true }).click();
  const publication = page.locator('publish-scenario-modal');
  await expect(publication.getByRole('columnheader', { name: 'Relations' })).toBeVisible();
  const concurrent = await page.request.post('/api/tasks', { data: [{
    id: child.id, tags: 'Concurrent', base: { revision: 1, fields: { tags: null } },
  }] });
  expect(concurrent.ok()).toBe(true);
  await publication.getByRole('checkbox').check();
  const submit = () => Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/tasks') && response.request().method() === 'POST'),
    publication.getByRole('button', { name: 'Publish selected changes' }).click(),
  ]);
  const [conflict] = await submit();
  expect(conflict.status()).toBe(409);
  expect(conflict.request().postDataJSON()[0].base).toEqual({ revision: 1, fields: { relations: [], tags: null } });
  const review = publication.getByRole('alert', { name: 'Task conflicts' });
  await expect(review).toContainText('current Concurrent');
  await expect(review).toContainText('proposed Proposed');
  await expect(publication.getByRole('checkbox')).not.toBeChecked();
  const afterConflict = await (await page.request.get('/api/tasks')).json();
  expect(afterConflict.find((task) => task.id === parent.id)).toMatchObject({ revision: 1, relations: [] });
  await publication.getByRole('checkbox').check();
  const [write] = await submit();
  expect(write.ok()).toBe(true);
  expect(write.request().postDataJSON()).toEqual([{
    id: child.id, relations: [{ type: 'Parent', id: parent.id }], tags: 'Proposed',
    base: { revision: 2, fields: { relations: [], tags: 'Concurrent' } },
  }]);
  const tasks = await (await page.request.get('/api/tasks')).json();
  expect(tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: parent.id, revision: 2, relations: [{ type: 'Child', id: child.id }] }),
    expect.objectContaining({ id: child.id, revision: 3, parentId: parent.id, tags: 'Proposed' }),
  ]));

  await page.getByRole('navigation', { name: 'Top menu' }).getByRole('button', { name: /^Plan(?:\s|$)/ }).click();
  await page.locator('plan-menu').getByRole('button', { name: 'Create task' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create Local Task' });
  await createDialog.getByLabel('Task type').selectOption(types[1].id);
  await createDialog.getByLabel('Title').fill('Browser task');
  const createdResponse = page.waitForResponse((response) => response.url().endsWith('/api/tasks/create'));
  await createDialog.getByRole('button', { name: 'Create task' }).click();
  const createdTask = await (await createdResponse).json();
  await expect(createDialog).not.toBeVisible();

  await page.goto(`/${createdTask.url}`);
  const panel = page.locator('details-panel');
  await panel.getByRole('button', { name: 'Edit source task' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Local Task' });
  await editDialog.getByLabel('State').selectOption('Refine');
  await editDialog.getByLabel('Description').fill('Edited in Chromium');
  await editDialog.getByRole('button', { name: 'Save task' }).click();
  await expect(editDialog).not.toBeVisible();
  await expect.poll(async () => (await (await page.request.get('/api/tasks')).json())
    .find((task) => task.id === createdTask.id)).toMatchObject({ state: 'Refine', description: 'Edited in Chromium' });

  await panel.getByRole('button', { name: 'Edit source task' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await editDialog.getByRole('button', { name: 'Delete task' }).click();
  await expect(editDialog).not.toBeVisible();
  await expect.poll(async () => (await (await page.request.get('/api/tasks')).json())
    .some((task) => task.id === createdTask.id)).toBe(false);

  const adoRequests = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/api/azure/') || path.startsWith('/admin/v1/ado')) adoRequests.push(path);
  });
  await page.goto('/admin/#ado-processes');
  const sidebar = page.locator('admin-app .admin-sidebar');
  await expect(sidebar.getByRole('button', { name: 'Local', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Azure DevOps', exact: true })).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Local', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Local Projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Local plan' })).toBeVisible();
  await page.getByRole('button', { name: 'Catalogue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Local Catalogue' })).toBeVisible();
  expect(adoRequests).toEqual([]);
});