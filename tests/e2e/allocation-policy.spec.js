import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const cases = JSON.parse(readFileSync(
  new URL('../fixtures/allocation_rule/cases.json', import.meta.url), 'utf8',
));

test('desktop capacity graph and real cost response share monthly allocation winners', async ({ page }, testInfo) => {
  const fixture = cases.find((entry) => entry.monthlyLoad !== undefined);
  const save = async (path, content) => {
    const response = await page.request.post(`/admin/v1/${path}`, { data: { content } });
    expect(response.ok(), await response.text()).toBe(true);
  };
  const names = ['Alpha', 'Beta', 'Gamma'];
  await save('teams', { schema_version: 2, teams: names.map((name) => ({ name, short_name: name })) });
  await save('people', { schema_version: 1, database_file: '', database: {
    people: names.map((name) => ({ name, team: name, site: 'HQ', external: false })),
  } });
  await save('cost', {
    working_hours: { HQ: { internal: 160, external: 0 } },
    internal_cost: { default_hourly_rate: 50 },
    external_cost: { default_hourly_rate: 0, external: {} },
  });
  const reload = await page.request.post('/admin/v1/reload-config', { data: {} });
  expect(reload.ok()).toBe(true);
  const projectsResponse = await page.request.get('/api/projects');
  const teamsResponse = await page.request.get('/api/teams');
  expect(projectsResponse.ok()).toBe(true);
  expect(teamsResponse.ok()).toBe(true);
  const projects = await projectsResponse.json();
  const teams = await teamsResponse.json();
  const features = fixture.features.map((feature) => ({
    ...feature, project: projects[0].id, sourcePlanIds: [projects[0].id],
    title: feature.id, type: feature.id === 'epic' ? 'Epic' : 'Feature',
    state: 'Active', stateCategory: 'InProgress', tags: '', relations: [],
    presentationPlanIds: feature.id === 'jan' ? [] : [projects[0].id],
  }));
  features.push({ ...features[1], id: 'selected-empty', title: 'Selected empty Feature',
    capacity: [], presentationPlanIds: [projects[0].id] });
  features.push({ ...features[1], id: 'hidden-empty', title: 'Hidden empty task', capacity: [] });
  features.push({ ...features[1], id: 'outside-period',
    title: 'BT for F1R1 - CR, defects and maturing 21.19',
    start: '2025-08-20', end: '2025-11-11', capacity: [],
    presentationPlanIds: [projects[0].id] });
  features.push({ ...features[1], id: '416311', parentId: null,
    title: 'Legacy closed parent', state: 'Closed', stateCategory: 'Completed',
    start: null, end: null, capacity: [], presentationPlanIds: [projects[0].id] });
  features.push({ ...features[1], id: '416312', parentId: '416311',
    title: 'Legacy closed child', state: 'Closed', stateCategory: 'Completed',
    start: null, end: null, capacity: [], presentationPlanIds: [projects[0].id] });

  await page.goto('/static/js/modules.config.json');
  await page.setContent('<main style="max-width:1100px;margin:24px auto;height:720px"></main>');
  const result = await page.evaluate(async ({ projects, teams, features }) => {
    const { store } = await import('/static/js/application/store.js');
    const { createInitialAppState } = await import('/static/js/application/createInitialAppState.js');
    const { cmd, sel } = await import('/static/js/application/imports.js');
    const { dataService } = await import('/static/js/services/dataService.js');
    await import('/static/js/components/MainGraph.lit.js');
    await import('/static/js/plugins/PluginCostComponent.js');
    await dataService.init();
    const state = createInitialAppState();
    state.lifecycle.status = 'ready';
    state.baseline = { ...state.baseline, projects, teams, features };
    state.selection.projectIds = projects.map((project) => project.id);
    state.selection.teamIds = teams.map((team) => team.id);
    state.selection.featureStateNames = ['Active'];
    state.selection.taskTypeNames = ['Epic', 'Feature'];
    store.setState(state, true);
    cmd.data.recomputeCapacity();

    const graph = document.createElement('maingraph-lit');
    graph.style.height = '120px';
    document.querySelector('main').appendChild(graph);
    await graph.updateComplete;
    const graphData = {
      months: [new Date('2025-01-01'), new Date('2025-02-01')], teams, projects,
      capacityDates: sel.capacity.getCapacityDates(),
      teamDailyCapacity: sel.capacity.getTeamDailyCapacity(),
      teamDailyCapacityMap: sel.capacity.getTeamDailyCapacityMap(),
      projectDailyCapacity: sel.capacity.getProjectDailyCapacity(),
      projectDailyCapacityMap: sel.capacity.getProjectDailyCapacityMap(),
      planDailyCapacityMap: sel.capacity.getPlanDailyCapacityMap(),
      planTeamDailyCapacityMap: sel.capacity.getPlanTeamDailyCapacityMap(),
      totalOrgDailyPerTeamAvg: sel.capacity.getTotalOrgDailyPerTeamAvg(),
      capacityViewMode: projects[0].type, selectedTeamIds: teams.map((team) => team.id),
      selectedProjectIds: projects.map((project) => project.id),
    };
    const cost = document.createElement('plugin-cost');
    cost.setAttribute('visible', '');
    cost.style.cssText = 'position:relative;display:block;height:580px';
    document.querySelector('main').appendChild(cost);
    cost.startDate = '2025-01-01';
    cost.endDate = '2025-02-28';
    cost.activeView = 'task';
    await cost.loadData();
    await cost.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await graph.renderGraph(graphData);
    const canvas = graph.getCanvas();
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
    }
    const sidebar = {
      unplanned: sel.filter.getTaskFilters().schedule.unplanned,
      unplannedDisabled: sel.filter.isSidebarControlDisabled('taskFilter', 'schedule', 'unplanned'),
      plannedDisabled: sel.filter.isSidebarControlDisabled('taskFilter', 'schedule', 'planned'),
      allocatedDisabled: sel.filter.isSidebarControlDisabled('taskFilter', 'allocation', 'allocated'),
      unallocatedDisabled: sel.filter.isSidebarControlDisabled('taskFilter', 'allocation', 'unallocated'),
      stateDisabled: sel.filter.isSidebarControlDisabled('state', 'Active'),
      typeDisabled: sel.filter.isSidebarControlDisabled('taskType', 'Feature'),
    };
    return { sidebar, dates: sel.capacity.getCapacityDates(), loads: sel.capacity.getTeamDailyCapacityMap(),
      cost: cost.data, error: cost.error, colors: colors.size };
  }, { projects, teams, features });
  expect(result.error).toBeNull();
  expect(result.cost.projects[projects[0].id].features
    .find((feature) => feature.id === 'epic').stateCategory).toBe('InProgress');
  expect(result.sidebar).toEqual({ unplanned: false, unplannedDisabled: false,
    plannedDisabled: false, allocatedDisabled: false, unallocatedDisabled: false,
    stateDisabled: false, typeDisabled: false });
  expect(result.colors).toBeGreaterThan(5);
  await expect(page.locator('maingraph-lit canvas')).toBeVisible();
  await expect(page.locator('plugin-cost')).toContainText('Cost Analysis');
  await expect(page.locator('plugin-cost input[type="date"]').nth(0)).toHaveValue('2025-01-01');
  await expect(page.locator('plugin-cost input[type="date"]').nth(1)).toHaveValue('2025-02-28');
  const parentRow = page.getByRole('row').filter({ hasText: 'epic' });
  await expect(parentRow.getByRole('cell').nth(5)).toHaveText('923');
  await expect(parentRow.getByRole('cell').nth(6)).toHaveText('18');
  await expect(parentRow).toContainText('Underrun');
  await expect(page.getByRole('row').filter({ hasText: 'jan' })).toContainText('Context');
  await expect(page.getByRole('row').filter({ hasText: 'Selected empty Feature' }))
    .toContainText('No own allocation');
  await expect(page.locator('plugin-cost')).not.toContainText('Hidden empty task');
  await expect(page.locator('plugin-cost')).not.toContainText('BT for F1R1');
  await expect(page.locator('plugin-cost')).not.toContainText('Legacy closed parent');
  for (const [team, expected] of Object.entries(fixture.monthlyLoad)) {
    const monthlyLoad = {};
    result.dates.forEach((date, index) => {
      const weekday = new Date(date).getUTCDay();
      if (weekday === 0 || weekday === 6 || result.loads[index][team] === undefined) return;
      const month = date.slice(0, 7);
      if (monthlyLoad[month] === undefined) monthlyLoad[month] = 0;
      monthlyLoad[month] += result.loads[index][team] / 100;
    });
    const monthlyHours = {};
    for (const feature of result.cost.projects[projects[0].id].features) {
      const allocation = feature.metrics.teams[team];
      if (allocation === undefined) continue;
      for (const [month, hours] of Object.entries(allocation.hours.internal)) {
        if (monthlyHours[month] === undefined) monthlyHours[month] = 0;
        monthlyHours[month] += hours;
      }
    }
    expect(Object.keys(monthlyLoad)).toEqual(Object.keys(expected));
    expect(Object.keys(monthlyHours)).toEqual(Object.keys(expected));
    for (const [month, load] of Object.entries(expected)) {
      expect(monthlyLoad[month]).toBeCloseTo(load, 6);
      expect(Math.abs(monthlyHours[month] - monthlyLoad[month] * 160 / (260 / 12)))
        .toBeLessThan(0.02);
    }
  }
  await testInfo.attach('allocation-policy-desktop', {
    body: await page.screenshot({ path: testInfo.outputPath('allocation-policy.png') }),
    contentType: 'image/png',
  });
  await page.evaluate(async () => {
    const { cmd } = await import('/static/js/application/imports.js');
    cmd.filter.setSelectedTaskTypes(['Epic']);
    const cost = document.querySelector('plugin-cost');
    await cost.loadData();
    await cost.updateComplete;
  });
  await expect(page.locator('plugin-cost')).not.toContainText('Selected empty Feature');
  await expect(page.getByRole('row').filter({ hasText: 'feb' })).toContainText('Context');
  await expect(parentRow.getByRole('cell').nth(5)).toHaveText('923');
  const expectedTotals = result.cost.projects[projects[0].id].totals;
  expect(Object.keys(expectedTotals.sites)).toContain('HQ');
  const reloadWithFilters = async (changes) => page.evaluate(async (changes) => {
    const { cmd } = await import('/static/js/application/imports.js');
    cmd.filter.setSelectedTaskTypes(['Epic', 'Feature']);
    cmd.filter.setSelectedStates(changes.states);
    cmd.filter.setTaskFilter('schedule', 'unplanned', changes.unplanned);
    cmd.filter.setTaskFilter('allocation', 'allocated', changes.allocated);
    cmd.filter.setTaskFilter('allocation', 'unallocated', changes.unallocated);
    const cost = document.querySelector('plugin-cost');
    await cost.loadData();
    await cost.updateComplete;
    return cost.data.projects[changes.projectId].totals;
  }, { ...changes, projectId: projects[0].id });
  const allRows = { states: ['Active', 'Closed'], unplanned: true,
    allocated: true, unallocated: true };
  expect(await reloadWithFilters(allRows)).toEqual(expectedTotals);
  await expect(page.locator('plugin-cost')).toContainText('Legacy closed parent');
  await expect(page.locator('plugin-cost')).toContainText('Legacy closed child');
  expect(await reloadWithFilters({ ...allRows, states: ['Active'] })).toEqual(expectedTotals);
  await expect(page.locator('plugin-cost')).not.toContainText('Legacy closed parent');
  expect(await reloadWithFilters({ ...allRows, unplanned: false })).toEqual(expectedTotals);
  await expect(page.locator('plugin-cost')).not.toContainText('Legacy closed child');
  expect(await reloadWithFilters({ ...allRows, unallocated: false })).toEqual(expectedTotals);
  await expect(page.locator('plugin-cost')).not.toContainText('Selected empty Feature');
  await expect(page.locator('plugin-cost')).not.toContainText('Legacy closed parent');
  expect(await reloadWithFilters({ ...allRows, allocated: false })).toEqual(expectedTotals);
  await expect(page.locator('plugin-cost')).toContainText('Selected empty Feature');
  await expect(page.locator('plugin-cost')).toContainText('Legacy closed child');
  await expect(page.getByRole('row').filter({ hasText: 'jan' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'feb' })).toHaveCount(0);
});