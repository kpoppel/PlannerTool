import { test, expect } from '@playwright/test';

const EVENTS = [
  { id: 'global', title: 'Global launch', date: '2027-03-01', plan_id: '', category: '' },
  { id: 'release', title: 'Selected release', date: '2027-03-01', end_date: '2027-04-01', plan_id: 'plan', category: 'Milestone' },
  { id: 'cluster', title: 'A very long event title that needs truncating without covering adjacent labels', date: '2027-03-01', plan_id: 'plan', category: '' },
  { id: 'left', title: 'Overlapping past', date: '2020-01-01', end_date: '2027-02-01', plan_id: '', category: '' },
  { id: 'right', title: 'Overlapping future', date: '2030-12-01', end_date: '2040-01-01', plan_id: 'plan', category: '' },
  { id: 'other', title: 'Other plan event', date: '2027-04-01', plan_id: 'other', category: '' },
  { id: 'outside', title: 'Outside axis', date: '2045-01-01', plan_id: '', category: '' },
];

async function openForecast(page) {
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    const { createInitialAppState } = await import('/js/application/createInitialAppState.js');
    const { default: PluginConeOfUncertainty } = await import('/js/plugins/PluginConeOfUncertainty.js');
    const state = createInitialAppState();
    state.baseline.projects = [
      { id: 'plan', name: 'Four-year forecast', color: '#137f52' },
      { id: 'other', name: 'Other plan', color: '#a63544' },
    ].map((project) => ({ ...project, work_item_display: [{
      process_id: 'process', tiers: [[{ name: 'Epic',
        states: [{ name: 'Active', category: 'InProgress', color: '#137f52' }],
      }]],
    }] }));
    state.baseline.features = [
      { id: 'INIT-204', title: 'Multi-Product Self-Serve Expansion Hub',
        start: '2027-03-01', end: '2027-07-01' },
      { id: 'INIT-205', title: 'Product roadmap',
        start: '2027-10-01', end: '2028-07-01' },
      { id: 'INIT-206', title: 'Strategic platform evolution',
        start: '2029-01-01', end: '2030-07-01' },
      { id: 'child', title: 'Implementation detail', parentId: 'INIT-204',
        start: '2027-04-01', end: '2027-05-01' },
    ].map((feature) => ({ project: 'plan', parentId: null, capacity: [], relations: [],
      tags: '', state: 'Active', process_id: 'process', type: 'Epic', ...feature }));
    state.selection.projectIds = ['plan'];
    state.selection.taskTypeNames = ['["process","epic"]'];
    state.selection.featureStateNames = ['Active'];
    store.setState(state, true);
    document.body.innerHTML = '<div id="app"></div><timeline-board></timeline-board>';
    const plugin = new PluginConeOfUncertainty();
    await plugin.init();
    await plugin.activate();
    const el = document.querySelector('plugin-cone-of-uncertainty');
    el.origin = '2027-01-01';
    await el.ready;
    await el.updateComplete;
    window.forecastPlugin = plugin;
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/events', (route) => route.fulfill({ json: EVENTS }));
  await page.route('**/api/event-categories', (route) => route.fulfill({ json: [
    { id: 'milestone', name: 'Milestone', is_special: true },
  ] }));
  await page.route('**/uncertainty-fixture', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><style>html,body,#app{height:100%;margin:0}</style></head><body></body></html>',
  }));
  await page.goto('/uncertainty-fixture');
  await openForecast(page);
});

test('desktop forecast communicates ranges and persists configurable scope preferences', async ({ page }) => {
  const plugin = page.locator('plugin-cone-of-uncertainty');
  await expect(plugin.locator('.task-row')).toHaveCount(3);
  await expect(plugin.getByText('Forecast, not a commitment.', { exact: true })).toBeVisible();
  await expect(plugin.locator('.period-label')).toHaveCount(3);
  await expect(plugin.locator('.uncertainty')).toHaveCount(3);
  const geometry = await plugin.evaluate((el) => {
    const root = el.shadowRoot;
    const chart = root.querySelector('.chart');
    return {
      scrollable: chart.clientHeight > 100,
      insideViewport: chart.getBoundingClientRect().bottom <= innerHeight,
      bands: [...root.querySelectorAll('.uncertainty')].map((band) => ({
        width: band.getBoundingClientRect().width,
        trackWidth: band.parentElement.getBoundingClientRect().width,
      })),
    };
  });
  expect(geometry.scrollable).toBe(true);
  expect(geometry.insideViewport).toBe(true);
  expect(geometry.bands.every((band) => band.width > 0 && band.width <= band.trackWidth)).toBe(true);
  await plugin.getByText('Uncertainty settings', { exact: true }).click();
  await plugin.locator('[name="endMonth-0"]').fill('9');
  await plugin.locator('[name="lower-1"]').fill('-35');
  await plugin.getByRole('button', { name: 'Save preferences' }).click();
  await expect(plugin.getByRole('status').filter({ hasText: 'preferences saved' })).toBeVisible();
  await expect(plugin.locator('.period-label').first()).toContainText('0-9m');

  await page.reload();
  await openForecast(page);
  await expect(plugin.locator('.period-label').first()).toContainText('0-9m');
  await expect(plugin.locator('.period-label').nth(1)).toContainText('-35%');
  await expect(plugin.locator('.period-label').nth(1)).toContainText('+75%');
  await plugin.getByRole('combobox', { name: 'Task hierarchy' }).selectOption('all');
  await expect(plugin.locator('.task-row')).toHaveCount(4);
  await plugin.getByRole('searchbox', { name: 'Search' }).fill('INIT-205');
  await expect(plugin.locator('.task-row')).toHaveCount(1);
  await page.evaluate(async () => window.forecastPlugin.deactivate());
  await expect(page.locator('timeline-board')).not.toHaveCSS('display', 'none');
});

test('reacts to plan selection and effective scenario dates without editing the plan', async ({ page }) => {
  const rows = page.locator('plugin-cone-of-uncertainty .task-row');
  const before = await rows.first().innerText();
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({
      ...state,
      scenarios: { ...state.scenarios, activeId: 'forecast-draft', items: [
        ...state.scenarios.items,
        { id: 'forecast-draft', name: 'Forecast draft', readonly: false,
          overrides: { 'INIT-204': { end: '2027-12-01' } },
          groupOverrides: {}, scenarioGroups: [], pluginData: {} },
      ] },
    }));
  });

  await expect(rows.first()).not.toHaveText(before);
  await expect(rows.first().locator('.finish-range small')).toHaveText('Planned: Dec 2027');
  expect(await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    return store.getState().baseline.features[0].end;
  })).toBe('2027-07-01');
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state,
      selection: { ...state.selection, projectIds: [] },
    }));
  });
  await expect(rows).toHaveCount(0);
  await expect(page.getByText('No scheduled tasks match.', { exact: false })).toBeVisible();
});

test('follows the board sort setting using rank and latest uncertainty finish', async ({ page }) => {
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({
      ...state,
      baseline: { ...state.baseline, features: [
        { id: 'long', title: 'Alpha', start: '2027-01-01', end: '2027-01-19', originalRank: 30 },
        { id: 'short', title: 'Zulu', start: '2027-01-16', end: '2027-01-20', originalRank: 10 },
        { id: 'ongoing', title: 'Middle', start: '2026-12-01', end: '2027-01-15', originalRank: 20 },
      ].map((feature) => ({ project: 'plan', parentId: null, capacity: [], relations: [],
        tags: '', state: 'Active', process_id: 'process', type: 'Epic', ...feature })) },
      view: { ...state.view, options: { ...state.view.options, featureSortMode: 'rank' } },
    }));
  });
  const titles = page.locator('plugin-cone-of-uncertainty .task-copy strong');
  await expect(titles).toHaveText(['Zulu', 'Middle', 'Alpha']);
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state,
      view: { ...state.view, options: { ...state.view.options, featureSortMode: 'date' } },
    }));
  });
  await expect(titles).toHaveText(['Middle', 'Zulu', 'Alpha']);
});

test('uses compact aligned rows and board type icons without clipping text or ranges', async ({ page }) => {
  const plugin = page.locator('plugin-cone-of-uncertainty');
  await expect(plugin.getByRole('img', { name: 'Epic', exact: true })).toHaveCount(3);
  const rows = await plugin.locator('.task-row').evaluateAll((elements) =>
    elements.map((row) => {
      const bounds = row.getBoundingClientRect();
      const icon = row.querySelector('.task-type svg').getBoundingClientRect();
      const track = row.querySelector('.track').getBoundingClientRect();
      const marker = row.querySelector('.planned-finish').getBoundingClientRect();
      const band = row.querySelector('.uncertainty').getBoundingClientRect();
      return {
        height: bounds.height,
        iconWidth: icon.width, iconHeight: icon.height,
        contentsFit: [...row.querySelectorAll('.task-copy, .finish-range')].every((el) =>
          el.scrollHeight <= el.clientHeight),
        aligned: Math.abs((track.top + track.bottom) / 2 - (band.top + band.bottom) / 2) < 1,
        markerFits: marker.top >= bounds.top && marker.bottom <= bounds.bottom,
      };
    }));
  expect(rows.every((row) => row.height <= 40)).toBe(true);
  expect(rows.every((row) => row.iconWidth === 16 && row.iconHeight === 16)).toBe(true);
  expect(rows.every((row) => row.contentsFit && row.aligned && row.markerFits)).toBe(true);
});

test('aligns clipped events and collision-free labels through desktop resizing and scrolling', async ({ page }, testInfo) => {
  const plugin = page.locator('plugin-cone-of-uncertainty');
  await expect(plugin.locator('.event-label')).toHaveCount(5);
  await expect(plugin.locator('.event-label[data-event-id="release"]')).toHaveClass(/special/);
  await expect(plugin.locator('.event-label[data-event-id="release"]')).toHaveAttribute('title', /Four-year forecast/);
  await expect(plugin.locator('.event-label[data-event-id="release"]')).toHaveCSS('background-color', 'rgb(19, 127, 82)');
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: [...state.baseline.features, ...Array.from({ length: 28 }, (_, index) => ({
        ...state.baseline.features[0], id: `extra-${index}`, title: `Extra task ${index}`,
      }))],
    } }));
  });
  await expect(plugin.locator('.task-row')).toHaveCount(31);
  const checkGeometry = async () => {
    const geometry = await plugin.evaluate((el) => {
      const root = el.shadowRoot;
      const axis = root.querySelector('.axis').getBoundingClientRect();
      const labels = [...root.querySelectorAll('.event-label')].map((node) => node.getBoundingClientRect());
      const headerMarker = root.querySelector('.axis [data-event-id="release"]').getBoundingClientRect();
      const trackMarker = root.querySelector('.track [data-event-id="release"]').getBoundingClientRect();
      const left = root.querySelector('.axis [data-event-id="left"]').getBoundingClientRect();
      const right = root.querySelector('.axis [data-event-id="right"]').getBoundingClientRect();
      return {
        labelsFit: labels.every((box) => box.left >= axis.left - 1 && box.right <= axis.right + 1
          && box.top >= axis.top + 28 && box.bottom <= axis.bottom - 24),
        noCollisions: labels.every((box, index) => labels.slice(index + 1).every((other) =>
          box.right <= other.left || other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top)),
        aligned: Math.abs(headerMarker.left - trackMarker.left) < 1
          && Math.abs(headerMarker.width - trackMarker.width) < 1,
        clipped: Math.abs(left.left - axis.left) < 1 && Math.abs(right.right - axis.right) < 1,
      };
    });
    expect(geometry).toEqual({ labelsFit: true, noCollisions: true, aligned: true, clipped: true });
  };
  await checkGeometry();
  await page.setViewportSize({ width: 1100, height: 900 });
  await plugin.locator('.chart').evaluate((chart) => { chart.scrollLeft = 130; chart.scrollTop = 160; });
  await expect.poll(() => plugin.locator('.chart').evaluate((chart) => chart.scrollLeft)).toBe(130);
  await checkGeometry();
  await page.setViewportSize({ width: 1700, height: 1000 });
  await expect.poll(() => plugin.locator('.axis').evaluate((axis) => axis.clientWidth)).toBeGreaterThan(1000);
  await checkGeometry();
  await plugin.locator('.chart').evaluate((chart) => { chart.scrollLeft = 0; chart.scrollTop = 0; });
  await plugin.locator('.task-label').first().click();
  expect(await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    return store.getState().featureDisplay.selectedId;
  })).not.toBeNull();
  const screenshot = testInfo.outputPath('cone-events-desktop.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('Cone events desktop', { path: screenshot, contentType: 'image/png' });
});

test('filters events by live plan selection and refreshes without modifying tasks', async ({ page }) => {
  const plugin = page.locator('plugin-cone-of-uncertainty');
  const taskText = async () => (await plugin.locator('.task-row').allTextContents())
    .map((text) => text.replace(/\s+/g, ' ').trim());
  const before = await taskText();
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, selection: { ...state.selection, projectIds: ['plan', 'other'] } }));
  });
  await expect(plugin.locator('.event-label')).toHaveCount(6);
  await expect(plugin.locator('.event-label[data-event-id="other"]')).toBeVisible();
  await page.route('**/api/events', (route) => route.fulfill({ json: [
    ...EVENTS, { id: 'fresh', title: 'Fresh event', date: '2027-05-01', plan_id: '', category: '' },
  ] }));
  await page.evaluate(async () => {
    const { bus } = await import('/js/core/EventBus.js');
    const { DataEvents } = await import('/js/core/EventRegistry.js');
    bus.emit(DataEvents.PLAN_EVENTS_CHANGED);
  });
  await expect(plugin.locator('.event-label')).toHaveCount(7);
  expect(await taskText()).toEqual(before);
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, selection: { ...state.selection, projectIds: [] } }));
  });
  await expect(plugin.locator('.event-label')).toHaveCount(3);
  await expect(plugin.locator('.task-row')).toHaveCount(0);
  await expect(plugin.locator('.event-label[data-event-id="global"]')).toBeVisible();
});
