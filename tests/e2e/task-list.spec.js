import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/task-list-fixture', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body></body></html>',
  }));
  await page.goto('/task-list-fixture');
  await page.setContent('<style>html,body{height:100%;margin:0}timeline-board{height:calc(100vh - 40px);margin-top:40px}body{font-family:"Segoe UI",sans-serif;--color-sidebar-bg:#23344d;--color-sidebar-text:white;--details-width:340px;--z-details:200}</style>');
  await page.evaluate(async () => {
    const { bus } = await import('/js/core/EventBus.js');
    const { AppEvents } = await import('/js/core/EventRegistry.js');
    window.startTaskBoard = () => bus.emit(AppEvents.READY);
    const { store } = await import('/js/application/store.js');
    const { createInitialAppState } = await import('/js/application/createInitialAppState.js');
    await import('/js/components/FeatureCard.lit.js');
    await import('/js/components/TimelineBoard.lit.js');
    await import('/js/components/TopMenu.lit.js');
    await import('/js/components/DetailsPanel.lit.js');
    const state = createInitialAppState();
    const types = ['Epic', 'Feature', 'User Story', 'Task', 'Subtask', 'Detail', 'Leaf'];
    const project = { id: 'plan', name: 'Release plan', type: 'project', color: '#347ab3',
      container_order: 0, container_types: ['project', 'team'],
      allocation_defaults: { project: [], team: [] },
      work_item_display: [{ process_id: 'process', process_name: 'Process',
        tiers: types.map((name) => [{ name, states: [{ name: 'Active', category: 'InProgress' }] }]) }] };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [project];
    state.baseline.features = Array.from({ length: 70 }, (_, index) => ({
      id: `task-${index}`, title: index === 6 ? 'Deeply nested delivery withaverylongunbrokentaskname' : `Delivery ${index}`,
      process_id: 'process', type: index < types.length ? types[index] : 'Feature', project: 'plan',
      state: 'Active', parentId: index > 0 && index < types.length ? `task-${index - 1}` : null,
      start: '2026-10-01', end: '2026-11-20', capacity: [], relations: [],
    }));
    state.selection.projectIds = ['plan'];
    state.selection.featureStateNames = ['Active'];
    store.setState(state, true);
    document.body.append(document.createElement('top-menu-bar'), document.createElement('timeline-board'),
      document.createElement('details-panel'));
  });
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('timeline-board')._onFeatureContextMenu !== undefined)).toBe(true);
  await page.evaluate(() => window.startTaskBoard());
  await expect(page.locator('task-list [data-task-id="task-0"]')).toBeVisible();
});

async function alignment(page, id = 'task-0') {
  return page.evaluate((id) => {
    const shell = document.querySelector('timeline-board').shadowRoot;
    const list = shell.querySelector('task-list');
    const row = list.shadowRoot.querySelector(`[data-task-id="${id}"]`);
    const card = shell.querySelector('feature-board').shadowRoot.querySelector(`[data-feature-id="${id}"]`);
    return { left: list.getBoundingClientRect().left, top: row.getBoundingClientRect().top,
      delta: row.getBoundingClientRect().top - card.getBoundingClientRect().top,
      width: list.getBoundingClientRect().width, title: card.shadowRoot.querySelector('.feature-title') !== null };
  }, id);
}

test('frozen task rows align through scrolling, zooming, resizing, collapse and packed transitions', async ({ page }, testInfo) => {
  const before = await alignment(page);
  expect(Math.abs(before.delta)).toBeLessThan(1);
  expect(before.title).toBe(false);
  await page.locator('timeline-board #scroll-container').evaluate((scroll) => {
    scroll.scrollLeft += 160;
    scroll.scrollTop = 90;
  });
  const after = await alignment(page);
  expect(after.left).toBe(before.left);
  expect(after.top).toBeLessThan(before.top);
  expect(Math.abs(after.delta)).toBeLessThan(1);
  await page.evaluate(() => document.querySelector('timeline-board').adjustBoardZoom(-1));
  await expect.poll(async () => Math.abs((await alignment(page)).delta)).toBeLessThan(1);
  const separator = page.getByRole('separator', { name: 'Task column width' });
  await separator.press('ArrowRight');
  await expect.poll(async () => (await alignment(page)).width).toBe(320);
  const handle = await separator.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 82, handle.y + handle.height / 2);
  await page.mouse.up();
  await expect.poll(async () => (await alignment(page)).width).toBeGreaterThan(390);
  const committedWidth = (await alignment(page)).width;
  const cancelHandle = await separator.boundingBox();
  await page.mouse.move(cancelHandle.x + cancelHandle.width / 2, cancelHandle.y + cancelHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(cancelHandle.x + 60, cancelHandle.y + cancelHandle.height / 2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => (await alignment(page)).width).toBe(committedWidth);
  await page.evaluate(async () => {
    const { cmd } = await import('/js/application/imports.js');
    cmd.view.setTimelineScale('threeMonths');
  });
  await separator.press('ArrowRight');
  await expect.poll(async () => page.evaluate(async () => {
    const { TIMELINE_CONFIG } = await import('/js/components/Timeline.lit.js');
    const shell = document.querySelector('timeline-board').shadowRoot;
    const width = shell.querySelector('#scroll-container').clientWidth -
      shell.querySelector('.task-toolbar').getBoundingClientRect().width;
    return TIMELINE_CONFIG.monthWidth === Math.max(30, Math.floor(width / 3));
  })).toBe(true);
  await page.getByRole('button', { name: 'Collapse task list', exact: true }).click();
  await expect(page.locator('task-list')).toBeHidden();
  await expect(page.locator('feature-card-lit .feature-title')).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore task list', exact: true }).click();
  await expect(page.locator('task-list')).toBeVisible();
  for (const mode of ['packed', 'normal']) {
    await page.evaluate(async (mode) => {
      const { cmd } = await import('/js/application/imports.js');
      cmd.view.setDisplayMode(mode);
    }, mode);
    if (mode === 'packed') await expect(page.locator('task-list')).toBeHidden();
    else {
      await expect(page.locator('task-list')).toBeVisible();
      await expect.poll(async () => (await alignment(page)).title).toBe(false);
    }
  }
  await page.screenshot({ path: testInfo.outputPath('task-list-desktop.png') });
});

test('card fields disappear right to left, restore on widening, and retain project progress', async ({ page }, testInfo) => {
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      projects: state.baseline.projects.map((project) => ({ ...project,
        work_item_display: project.work_item_display.map((process) => ({ ...process,
          tiers: process.tiers.map((tier) => tier.map((type) => ({ ...type,
            states: [...type.states, { name: 'Closed', category: 'Completed' }],
          }))),
        })),
      })),
      features: state.baseline.features.map((feature, index) =>
        index > 0 && index < 4 ? { ...feature, state: 'Closed' } : feature),
    } }));
    const card = document.createElement('feature-card-lit');
    card.id = 'sizing-card';
    card.feature = { ...store.getState().baseline.features[0],
      capacity: [{ team: 'team', capacity: 50 }] };
    card.teams = [{ id: 'team', name: 'Team', color: '#298864', selected: true }];
    card.project = store.getState().baseline.projects[0];
    card.style.cssText = 'position:fixed;left:400px;top:50px;width:460px;z-index:500';
    document.body.append(card);
    await card.updateComplete;
  });
  const card = page.locator('#sizing-card');
  await expect(card.locator('.completion-count')).toHaveText('3/6');
  await expect(card.locator('.feature-title')).toHaveCount(0);
  const sizes = await card.evaluate((element) => {
    const root = element.shadowRoot.querySelector('.feature-card');
    const content = element.shadowRoot.querySelector('.card-content');
    const fill = element.shadowRoot.querySelector('.completion-fill');
    const counter = element.shadowRoot.querySelector('.completion-count');
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(fill).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const widths = [...content.children].map((field) => field.getBoundingClientRect().width);
    return { widths, overhead: element.clientWidth - content.clientWidth,
      gap: parseFloat(getComputedStyle(content).columnGap),
      progress: fill.getBoundingClientRect().width / root.clientWidth,
      fillColor: [...context.getImageData(0, 0, 1, 1).data],
      counterInset: content.getBoundingClientRect().right - counter.getBoundingClientRect().right,
      firstField: content.firstElementChild.className,
      height: root.getBoundingClientRect().height };
  });
  expect(sizes.progress).toBeCloseTo(0.5, 2);
  expect(sizes.fillColor[0]).toBeGreaterThan(200);
  expect(sizes.fillColor[1]).toBeGreaterThan(220);
  expect(sizes.fillColor[2]).toBeGreaterThan(235);
  expect(sizes.counterInset).toBeCloseTo(0, 0);
  expect(sizes.firstField).toContain('feature-card-icon');
  expect(sizes.height).toBe(28);
  expect(sizes.widths.every((width) => width > 0)).toBe(true);
  for (const count of [4, 3, 2, 1, 0, 4]) {
    const width = Math.ceil(sizes.overhead + sizes.widths.slice(0, count)
      .reduce((sum, fieldWidth) => sum + fieldWidth, 0) + Math.max(0, count - 1) * sizes.gap + 1);
    await card.evaluate((element, width) => element.applyVisuals({ width }), width);
    await expect.poll(() => card.evaluate((element) => {
      const content = element.shadowRoot.querySelector('.card-content');
      return [...content.children].map((field) => getComputedStyle(field).visibility !== 'hidden');
    })).toEqual([0, 1, 2, 3].map((index) => index < count));
    const clipped = await card.evaluate((element) => {
      const content = element.shadowRoot.querySelector('.card-content');
      const right = content.getBoundingClientRect().right;
      return [...content.children].some((field) => getComputedStyle(field).visibility !== 'hidden'
        && field.getBoundingClientRect().right > right + 1);
    });
    expect(clipped).toBe(false);
  }
  await page.screenshot({ path: testInfo.outputPath('compact-feature-card-desktop.png') });
});

test('search navigates without filtering and task selection opens read-only details', async ({ page }) => {
  const count = await page.locator('task-list [data-task-id]').count();
  const search = page.getByRole('searchbox', { name: 'Search tasks' });
  await search.fill('task-6');
  await search.press('Enter');
  await expect(page.locator('feature-card-lit[data-feature-id="task-6"]')).toHaveClass(/search-highlight/);
  await expect(page.locator('task-list [data-task-id]')).toHaveCount(count);
  const row = page.locator('task-list [data-task-id="task-6"]');
  await expect(row.locator('.level')).toHaveText('6');
  await expect(row.locator('.task-title')).toHaveAttribute('title', /Delivery 0.*Deeply nested/);
  await row.locator('.task-title').click();
  await expect(page.locator('details-panel .panel')).toBeVisible();
  await expect(row).toHaveClass(/selected/);
  await expect(page.locator('feature-card-lit[data-feature-id="task-6"] .drag-handle')).toHaveCount(0);
});

test('folding is shared by rows, cards and the header hierarchy menu', async ({ page }) => {
  const row = page.locator('task-list [data-task-id="task-0"]');
  await row.locator('.fold').click();
  await expect(page.locator('task-list [data-task-id="task-6"]')).toHaveCount(0);
  await expect(page.locator('feature-card-lit[data-feature-id="task-6"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hierarchy', exact: true }).click();
  await expect(page.locator('board-controls-menu .hierarchy-fold-status')).toContainText('1 of');
  await page.locator('board-controls-menu').getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.locator('task-list [data-task-id="task-6"]')).toHaveCount(1);
  await page.locator('board-controls-menu').press('Escape');
  await expect(page.getByRole('button', { name: 'Hierarchy', exact: true })).toBeFocused();
});

test('group rows stay aligned after filtering and export retains the frozen labels', async ({ page }) => {
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    const { bus } = await import('/js/core/EventBus.js');
    const { GroupEvents } = await import('/js/core/EventRegistry.js');
    store.setState((state) => ({ ...state, groups: {
      byPlanId: { plan: [{ id: 'release-group', plan_id: 'plan', name: 'Release group',
        members: ['task-7', 'task-8'], rank: -1024, parent_id: null, color: '#347ab3' }] },
      loadedPlanIds: ['plan'],
    } }));
    bus.emit(GroupEvents.LOADED);
  });
  await expect(page.locator('task-list .group')).toContainText('Release group');
  const groupDelta = await page.evaluate(() => {
    const shell = document.querySelector('timeline-board').shadowRoot;
    const label = shell.querySelector('task-list').shadowRoot.querySelector('.group');
    const group = shell.querySelector('feature-board').shadowRoot.querySelector('feature-group');
    return label.getBoundingClientRect().top - group.getBoundingClientRect().top;
  });
  expect(Math.abs(groupDelta)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Task Filters', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Planned', exact: true })).toBeFocused();
  const type = page.locator('board-controls-menu .filter-option[data-type-key]').filter({ hasText: 'Epic' });
  await type.press('Space');
  await page.keyboard.press('Escape');
  await expect(page.locator('task-list [data-task-id="task-0"]')).toHaveCount(0);
  await expect(page.locator('feature-card-lit[data-feature-id="task-0"]')).toHaveCount(0);
  const exported = await page.evaluate(async () => {
    const { TimelineExportRenderer } = await import('/js/plugins/export/TimelineExportRenderer.js');
    const svg = await new TimelineExportRenderer().getExportSvg({ includeAnnotations: false,
      includeDependencies: true });
    return { labels: [...svg.querySelectorAll('.task-label')].map((label) => label.textContent),
      offset: svg.querySelector('svg').getAttribute('x'), ghosts: svg.querySelectorAll('.ghost-title').length };
  });
  expect(exported.labels).toContain('Release groupRelease group');
  expect(exported.offset).toBe('300');
  expect(exported.ghosts).toBe(0);
});

test('virtualized labels retain board geometry even for horizontally offscreen bars', async ({ page }) => {
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: Array.from({ length: 450 }, (_, index) => ({ ...state.baseline.features[10],
        id: `large-${index}`, title: `Large task ${index}`, parentId: null })),
    } }));
    await document.querySelector('timeline-board').shadowRoot.querySelector('feature-board').renderFeatures();
  });
  await page.locator('timeline-board #scroll-container').evaluate((scroll) => {
    scroll.scrollTop = 7000;
    scroll.scrollLeft = 0;
  });
  await expect.poll(() => page.locator('task-list [data-task-id]').count()).toBeLessThan(100);
  await expect.poll(() => page.locator('task-list [data-task-id]').first().getAttribute('data-task-id'))
    .not.toBe('large-0');
  const positions = await page.evaluate(() => {
    const shell = document.querySelector('timeline-board').shadowRoot;
    const board = shell.querySelector('feature-board');
    const layout = board.getTaskLayout();
    return [...shell.querySelector('task-list').shadowRoot.querySelectorAll('[data-task-id]')].map((row) => ({
      actual: parseFloat(row.style.top), expected: layout.rows.find((item) => item.id === row.dataset.taskId).top,
    }));
  });
  expect(positions.length).toBeGreaterThan(0);
  for (const position of positions) expect(position.actual).toBe(position.expected);
  const exportedLabels = await page.evaluate(async () => {
    const { TimelineExportRenderer } = await import('/js/plugins/export/TimelineExportRenderer.js');
    const svg = await new TimelineExportRenderer().getExportSvg({ includeAnnotations: false,
      includeDependencies: false });
    return svg.querySelectorAll('.task-label').length;
  });
  expect(exportedLabels).toBe(450);
});

test('existing card move and resize gestures retain scenario-only edits beside the task list', async ({ page }) => {
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    const { bus } = await import('/js/core/EventBus.js');
    const { ScenarioEvents } = await import('/js/core/EventRegistry.js');
    store.setState((state) => ({ ...state, scenarios: { ...state.scenarios,
      activeId: 'draft', items: [...state.scenarios.items,
        { ...state.scenarios.items[0], id: 'draft', name: 'Draft', readonly: false }],
    } }));
    bus.emit(ScenarioEvents.ACTIVATED);
    document.querySelector('timeline-board').shadowRoot.querySelector('feature-board').centerFeatureById('task-7');
  });
  const card = page.locator('feature-card-lit[data-feature-id="task-7"]');
  await expect(card.locator('.drag-handle').first()).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 12, { steps: 12 });
  await page.mouse.up();
  const dates = () => page.evaluate(async () => {
    const { sel } = await import('/js/application/imports.js');
    const feature = sel.feature.getEffectiveFeatureById('task-7');
    return { start: feature.start, end: feature.end };
  });
  await expect.poll(async () => Date.parse((await dates()).start)).toBeGreaterThan(Date.parse('2026-10-01'));
  const moved = await dates();
  expect(Date.parse(moved.end) - Date.parse(moved.start)).toBe(Date.parse('2026-11-20') - Date.parse('2026-10-01'));
  const handle = card.locator('.drag-handle');
  const resizeBox = await handle.boundingBox();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 40, resizeBox.y + resizeBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => Date.parse((await dates()).end)).toBeGreaterThan(Date.parse(moved.end));
  const baseline = await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    return store.getState().baseline.features.find((feature) => feature.id === 'task-7');
  });
  expect(baseline).toMatchObject({ start: '2026-10-01', end: '2026-11-20' });
});

test('dependency overlays retain board coordinates and fullscreen tools restore the task column', async ({ page }) => {
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    const { PluginDependencies } = await import('/js/plugins/PluginDependencies.js');
    const { PluginPortfolio } = await import('/js/plugins/PluginPortfolio.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: state.baseline.features.map((feature) => feature.id === 'task-7'
        ? { ...feature, relations: ['task-8'] } : feature),
    } }));
    const board = document.querySelector('timeline-board').shadowRoot.querySelector('feature-board');
    await board.renderFeatures();
    window.taskDependencies = new PluginDependencies();
    await window.taskDependencies.activate();
    window.taskPortfolio = new PluginPortfolio();
  });
  const path = page.locator('timeline-board #board-area .dependencies-overlay svg path');
  await expect(path).toHaveCount(1);
  const curve = await path.getAttribute('d');
  await page.getByRole('separator', { name: 'Task column width' }).press('ArrowRight');
  await expect.poll(async () => (await alignment(page)).width).toBe(320);
  await expect(path).toHaveAttribute('d', curve);
  const overlayDelta = await page.evaluate(() => {
    const shell = document.querySelector('timeline-board').shadowRoot;
    return shell.querySelector('.dependencies-overlay').getBoundingClientRect().left -
      shell.querySelector('feature-board').getBoundingClientRect().left;
  });
  expect(Math.abs(overlayDelta)).toBeLessThan(1);
  await page.evaluate(() => window.taskPortfolio.activate());
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toBeHidden();
  await expect(page.locator('plugin-portfolio-board')).toBeVisible();
  await page.evaluate(() => window.taskPortfolio.deactivate());
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toBeVisible();
  const restored = await alignment(page);
  expect(restored.width).toBe(320);
  expect(Math.abs(restored.delta)).toBeLessThan(1);
  await expect(path).toHaveAttribute('d', curve);
});