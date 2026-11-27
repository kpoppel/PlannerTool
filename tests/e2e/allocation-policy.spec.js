import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const test = base.extend({
  workforceFixture: async ({ page }, use) => {
    const response = await page.request.get('/admin/v1/workforce');
    expect(response.ok()).toBe(true);
    const original = (await response.json()).content;
    const createdTeams = [];
    try {
      await use({ original, createdTeams });
    } finally {
      for (const id of createdTeams.reverse()) {
        const path = `/admin/v1/workforce/teams/${encodeURIComponent(id)}/deletion`;
        const reviewResponse = await page.request.get(path);
        expect(reviewResponse.ok(), await reviewResponse.text()).toBe(true);
        const review = (await reviewResponse.json()).content;
        const deletion = await page.request.post(path, { data: {
          revision: review.revision,
          confirmation: { acknowledged: true, review_revision: review.review_revision },
        } });
        expect(deletion.ok(), await deletion.text()).toBe(true);
      }
      const currentResponse = await page.request.get('/admin/v1/workforce');
      expect(currentResponse.ok()).toBe(true);
      const current = (await currentResponse.json()).content;
      const originalTeam = original.teams.teams[0];
      const team = current.teams.teams.find((entry) => entry.id === originalTeam.id);
      team.name = originalTeam.name;
      team.short_name = originalTeam.short_name;
      for (const staffing of current.workforce.staffing) {
        const previous = original.workforce.staffing.find((entry) => entry.id === staffing.id);
        staffing.fte = previous.fte;
      }
      const restore = await page.request.post('/admin/v1/workforce', { data: {
        revision: current.revision, teams: current.teams, workforce: current.workforce,
      } });
      expect(restore.ok(), await restore.text()).toBe(true);
      const reload = await page.request.post('/admin/v1/reload-config', { data: {} });
      expect(reload.ok()).toBe(true);
    }
  },
});

const cases = JSON.parse(readFileSync(
  new URL('../fixtures/allocation_rule/cases.json', import.meta.url), 'utf8',
));

test('desktop capacity graph and real cost response share monthly allocation winners', async ({ page, workforceFixture }, testInfo) => {
  const fixture = cases.find((entry) => entry.monthlyLoad !== undefined);
  let workforce = structuredClone(workforceFixture.original);
  const saveWorkforce = async () => {
    const response = await page.request.post('/admin/v1/workforce', { data: {
      revision: workforce.revision, teams: workforce.teams, workforce: workforce.workforce,
    } });
    expect(response.ok(), await response.text()).toBe(true);
    workforce = (await response.json()).content;
  };
  const createDefinition = async (kind, fields) => {
    const response = await page.request.post(`/admin/v1/workforce/definitions/${kind}`, { data: {
      revision: workforce.revision, fields,
    } });
    expect(response.ok(), await response.text()).toBe(true);
    workforce = (await response.json()).content;
  };
  const names = ['Alpha', 'Beta', 'Gamma'];
  workforce.teams.teams[0].name = names[0];
  workforce.teams.teams[0].short_name = names[0].slice(0, 2).toUpperCase();
  workforce.workforce.staffing.forEach((staffing) => { staffing.fte = 1; });
  await saveWorkforce();
  const supplier = workforce.workforce.suppliers.find((entry) => !entry.external);
  const profile = supplier.profiles.find((entry) => entry.name === 'Standard');
  for (const name of names.slice(1)) {
    await createDefinition('team', { name, short_name: name.slice(0, 2).toUpperCase(), group_id: null });
    const team = workforce.teams.teams.find((entry) => entry.name === name);
    workforceFixture.createdTeams.push(team.id);
    await createDefinition('staffing', {
      team_id: team.id, supplier_id: supplier.id, profile_id: profile.id, fte: 1,
    });
  }
  const reload = await page.request.post('/admin/v1/reload-config', { data: {} });
  expect(reload.ok()).toBe(true);
  const projectsResponse = await page.request.get('/api/projects');
  expect(projectsResponse.ok()).toBe(true);
  const projects = await projectsResponse.json();
  const teams = names.map((name) => {
    const team = workforce.teams.teams.find((entry) => entry.name === name);
    return { ...team, selected: true };
  });
  expect(teams.map((team) => team.name)).toEqual(names);
  const fixtureTeamIds = ['team-alpha', 'team-beta', 'team-gamma'];
  const teamIdByFixtureId = new Map(fixtureTeamIds.map((id, index) => [id, teams[index].id]));
  const mapCapacity = (capacity) => capacity.map((allocation) => {
    const team = teamIdByFixtureId.get(allocation.team);
    expect(team).toBeDefined();
    return { ...allocation, team };
  });
  const features = fixture.features.map((feature) => ({
    ...feature, project: projects[0].id, sourcePlanIds: [projects[0].id],
    process_id: projects[0].work_item_display[0].process_id,
    title: feature.id, type: feature.id === 'epic' ? 'Epic' : 'Feature',
    state: 'Active', stateCategory: 'InProgress', tags: '', relations: [],
    presentationPlanIds: feature.id === 'jan' ? [] : [projects[0].id],
    capacity: mapCapacity(feature.capacity),
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
    const { taskTypeKey } = await import('/static/js/application/shared/workItemDisplay.js');
    await import('/static/js/components/MainGraph.lit.js');
    await import('/static/js/plugins/PluginCostComponent.js');
    await dataService.init();
    const state = createInitialAppState();
    state.lifecycle.status = 'ready';
    state.baseline = { ...state.baseline, projects, teams, features };
    state.selection.projectIds = projects.map((project) => project.id);
    state.selection.teamIds = teams.map((team) => team.id);
    state.selection.featureStateNames = ['Active'];
    state.selection.taskTypeNames = ['Epic', 'Feature']
      .map((type) => taskTypeKey(projects[0].work_item_display[0].process_id, type));
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
  const expectedMonthlyLoad = new Map();
  for (const [fixtureTeam, expected] of Object.entries(fixture.monthlyLoad)) {
    const team = teamIdByFixtureId.get(fixtureTeam);
    expect(team).toBeDefined();
    expectedMonthlyLoad.set(team, expected);
  }
  for (const [team, expected] of expectedMonthlyLoad) {
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
    const { cmd, sel } = await import('/static/js/application/imports.js');
    const { taskTypeKey } = await import('/static/js/application/shared/workItemDisplay.js');
    cmd.filter.setSelectedTaskTypes([taskTypeKey(sel.feature.getWorkItemDisplay()[0].process_id, 'Epic')]);
    const cost = document.querySelector('plugin-cost');
    await cost.loadData();
    await cost.updateComplete;
  });
  await expect(page.locator('plugin-cost')).not.toContainText('Selected empty Feature');
  await expect(page.getByRole('row').filter({ hasText: 'feb' })).toContainText('Context');
  await expect(parentRow.getByRole('cell').nth(5)).toHaveText('923');
  const expectedTotals = result.cost.projects[projects[0].id].totals;
  expect(Object.keys(expectedTotals.internal.cost)).toEqual(['2025-01', '2025-02']);
  const reloadWithFilters = async (changes) => page.evaluate(async (changes) => {
    const { cmd, sel } = await import('/static/js/application/imports.js');
    const { taskTypeKey } = await import('/static/js/application/shared/workItemDisplay.js');
    const processId = sel.feature.getWorkItemDisplay()[0].process_id;
    cmd.filter.setSelectedTaskTypes(['Epic', 'Feature'].map((type) => taskTypeKey(processId, type)));
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