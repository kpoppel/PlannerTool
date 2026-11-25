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
});