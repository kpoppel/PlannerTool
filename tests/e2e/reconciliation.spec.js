import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/health', (route) => route.fulfill({ json: {
    server_name: 'Reconciliation fixture', version: 'test', status: 'ok', uptime_seconds: 0,
  } }));
  await page.goto('/js/modules.config.json');
  await page.setContent(`<style>
    body { font-family: 'Segoe UI', sans-serif; margin: 0; background: #f6f8f7;
      --color-sidebar-bg: #23344d; --color-sidebar-text: white; --sidebar-width: 320px;
      --z-sidebar: 20; --z-details: 140; --details-width: 340px; }
    main { position: relative; margin: 90px 20px 0 350px; height: 650px; overflow: auto; }
    .board-space { height: 1400px; }
  </style><main></main>`);
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    const { createInitialAppState } = await import('/js/application/createInitialAppState.js');
    const { sel } = await import('/js/application/imports.js');
    const { reconciliation } = await import('/js/plugins/reconciliation/runtime.js');
    const { pluginManager } = await import('/js/core/PluginManager.js');
    const { PluginReconciliation } = await import('/js/plugins/PluginReconciliation.js');
    await import('/js/components/TopMenu.lit.js');
    await import('/js/components/FeatureCard.lit.js');
    await import('/js/components/Sidebar.lit.js');
    await import('/js/components/sidebar/SidebarFooter.lit.js');
    await import('/js/components/DetailsPanel.lit.js');
    const state = createInitialAppState();
    const parent = { id: 'programme', process_id: 'process', title: 'Programme delivery', type: 'Epic',
      project: 'programme', state: 'Active', start: '2026-10-01', end: '2026-10-10',
      parentId: null, capacity: [], relations: [] };
    const child = { ...parent, id: 'delivery', title: 'Integration and customer acceptance',
      type: 'Feature', project: 'delivery', parentId: 'programme' };
    const project = { id: 'programme', name: 'Programme', type: 'project', container_order: 0,
      container_types: ['project', 'team'], work_item_display: [{ process_id: 'process',
        process_name: 'Delivery process', tiers: ['Epic', 'Feature'].map((name) => [{ name,
          states: [{ name: 'Active', category: 'InProgress' }] }]) }],
      allocation_defaults: { project: [], team: [] },
      color: '#167d69' };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [project, { ...project, id: 'delivery', name: 'Delivery team',
      type: 'team', container_order: 1, color: '#d99030' }];
    state.baseline.features = [parent, child];
    state.selection.projectIds = ['programme', 'delivery'];
    state.selection.featureStateNames = ['Active'];
    state.selection.taskTypeNames = ['["process","feature"]'];
    store.setState(state, true);
    reconciliation.clock = () => new Date('2026-10-03T12:00:00');
    await pluginManager.register(new PluginReconciliation('plugin-reconciliation', {
      id: 'plugin-reconciliation', type: 'menu', name: 'Reconciliation', enabled: true,
      exclusive: false, dependencies: [], menuPosition: 'before-tools', description: 'Live plan issues',
    }));
    document.body.prepend(document.createElement('top-menu-bar'));
    document.body.append(document.createElement('app-sidebar'), document.createElement('app-footer'),
      document.createElement('details-panel'));
    const card = document.createElement('feature-card-lit');
    card.feature = sel.feature.getEffectiveFeatureById('delivery');
    card.project = state.baseline.projects[1];
    card.style.cssText = 'left:0;top:50px;width:300px';
    document.querySelector('main').appendChild(card);
    const space = document.createElement('div');
    space.className = 'board-space';
    document.querySelector('main').appendChild(space);
    await card.updateComplete;
    await document.querySelector('top-menu-bar').updateComplete;
    await document.querySelector('app-sidebar').updateComplete;
    await document.querySelector('app-footer').updateComplete;
    await document.querySelector('details-panel').updateComplete;
  });
  expect(errors).toEqual([]);
});

test('task cache freshness is logged and background refresh preserves the working board', async ({ page }, testInfo) => {
  let refreshed = false;
  let taskReads = 0;
  const refreshes = [];
  await page.route('**/api/tasks', (route) => {
    taskReads += 1;
    return route.fulfill({ json: [{ id: 'delivery', title: refreshed ? 'Updated delivery' : 'Cached delivery',
      process_id: 'process', type: 'Feature', state: 'Active', project: 'delivery', relations: [], capacity: [] }],
    headers: { 'X-Backend-Diagnostics': JSON.stringify([{
      code: 'task_cache_freshness', severity: 'info',
      message: refreshed ? 'Task cache updated just now: fresh.' : 'Task cache updated 12 minutes ago: fresh.',
    }]) } });
  });
  await page.route('**/api/tasks/refresh', (route) => {
    refreshes.push(route.request().method());
    refreshed = true;
    return route.fulfill({ status: 202, json: { status: 'queued' }, headers: {
      'X-Backend-Diagnostics': JSON.stringify([{
        code: 'task_refresh_requested', severity: 'info',
        message: 'Task cache refresh queued in background. Reload later to load updated data.',
      }]),
    } });
  });
  await editDates(page, 'cache-refresh-draft');
  await page.evaluate(async () => {
    const { dataService } = await import('/js/services/dataService.js');
    const { store } = await import('/js/application/store.js');
    const result = await dataService.getFeatures();
    if (!result.ok) throw new Error(result.error.message);
    window.cacheRefreshBefore = JSON.stringify({ baseline: store.getState().baseline,
      scenarios: store.getState().scenarios, selection: store.getState().selection });
    await import('/js/components/ScenarioMenu.lit.js');
    const menu = document.createElement('scenario-menu');
    menu.style.cssText = 'position:fixed;top:100px;left:360px;z-index:3000';
    document.body.appendChild(menu);
    await menu.updateComplete;
  });
  await page.locator('scenario-menu [title="Refresh baseline data"]').click();
  expect(refreshes).toEqual(['POST']);
  expect(taskReads).toBe(1);
  expect(await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    return JSON.stringify({ baseline: store.getState().baseline,
      scenarios: store.getState().scenarios, selection: store.getState().selection }) === window.cacheRefreshBefore;
  })).toBe(true);
  await page.locator('scenario-menu').evaluate((menu) => menu.remove());
  await page.locator('#notificationsBtn').click();
  const log = page.getByRole('dialog', { name: 'Notification log' });
  await expect(log).toContainText('Task cache updated 12 minutes ago');
  await expect(log).toContainText('refresh queued in background');
  await testInfo.attach('cache-freshness-notifications', {
    body: await page.screenshot({ path: testInfo.outputPath('cache-freshness.png') }), contentType: 'image/png',
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const { dataService } = await import('/js/services/dataService.js');
    return dataService.getFeatures();
  });
  expect(result.ok).toBe(true);
  expect(result.data[0].title).toBe('Updated delivery');
  expect(taskReads).toBe(2);
});

async function editDates(page, scenarioId = 'baseline') {
  await page.evaluate(async (id) => {
    const { store } = await import('/js/application/store.js');
    const { sel } = await import('/js/application/imports.js');
    store.setState((state) => ({ ...state, scenarios: { ...state.scenarios, activeId: id,
      items: id === 'baseline'
        ? state.scenarios.items.map((scenario) => ({ ...scenario, overrides: { delivery: { end: '2026-10-22' } } }))
        : [...state.scenarios.items, { id, name: 'Delivery alternative', overrides: { delivery: { end: '2026-10-22' } },
          groupOverrides: {}, scenarioGroups: [], pluginData: {} }],
    } }));
    document.querySelector('feature-card-lit').feature = sel.feature.getEffectiveFeatureById('delivery');
  }, scenarioId);
}

async function selectReviewTask(page, title, issueType = 'containment') {
  const issueClass = page.locator(`reconciliation-review .issue-class[data-issue-type="${issueType}"]`);
  if (!await issueClass.evaluate((element) => element.open)) {
    await issueClass.locator(':scope > summary').click();
  }
  await issueClass.locator('.item').filter({ hasText: title }).click();
}

for (const width of [1366, 1024]) {
  test(`publication separates selected writes from cross-plan impact at desktop width ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = [];
    await page.route('**/api/tasks', (route) => {
      if (route.request().method() === 'POST') writes.push(route.request().postDataJSON());
      return route.fulfill({ json: [] });
    });
    await editDates(page, 'publication-review');
    await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
    await selectReviewTask(page, 'Integration');
    await page.locator('reconciliation-review [data-action="publish-scenario"]').click();
    const publication = page.locator('publish-scenario-modal');
    await publication.getByRole('checkbox').check();
    const impact = publication.locator('[aria-label="Cross-plan impact"]');
    await expect(impact).toContainText('Programme');
    await expect(impact).toContainText('Delivery team');
    await expect(impact).toContainText('Affected only; no task write');
    await expect(impact).toContainText('Selected task write');
    await expect(publication.locator('[aria-label="Unresolved findings"]')).toContainText('Integration');
    await testInfo.attach('selected-write-cross-plan-impact', {
      body: await page.screenshot({ path: testInfo.outputPath('publication-impact.png') }),
      contentType: 'image/png',
    });
    await publication.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(writes).toEqual([]);
    await expect(page.locator('reconciliation-review .item[aria-pressed="true"]')).toContainText('Integration');
  });

  test(`scenario acceptance saves separately from live findings at desktop width ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const saves = [];
    await page.route('**/api/scenario', async (route) => {
      saves.push(route.request().postDataJSON());
      await route.fulfill({ json: { id: 'review', name: 'Review' } });
    });
    await page.evaluate(async () => {
      const { store } = await import('/js/application/store.js');
      const { sel } = await import('/js/application/imports.js');
      const { dataService } = await import('/js/services/dataService.js');
      await dataService.setLocalPref('user.email', 'editor@example.test');
      store.setState((state) => ({ ...state,
        baseline: { ...state.baseline,
          projects: state.baseline.projects.map((project) => ({ ...project,
            work_item_display: project.work_item_display.map((process) => ({ ...process,
              tiers: process.tiers.map((tier) => tier.map((type) => ({ ...type, states: [
                { name: 'Active', category: 'InProgress' }, { name: 'Done', category: 'Completed' },
              ] }))) })) })),
          features: state.baseline.features.map((feature) => feature.id === 'delivery'
            ? { ...feature, end: '2026-10-02' } : { ...feature, state: 'Done' }),
        },
        scenarios: { ...state.scenarios, activeId: 'review', items: [...state.scenarios.items,
          { id: 'review', name: 'Review', readonly: false, overrides: {}, groupOverrides: {},
            scenarioGroups: [], pluginData: {} }] },
      }));
      document.querySelector('feature-card-lit').feature = sel.feature.getEffectiveFeatureById('delivery');
    });
    await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
    await selectReviewTask(page, 'Integration', 'past-unfinished');
    const review = page.locator('reconciliation-review');
    await expect(review.locator('[data-action="accept-exception"]')).toBeDisabled();
    await review.locator('[data-exception-reason]').fill('Agreed delivery window');
    await review.locator('[data-action="accept-exception"]').click();
    await expect(review.locator('.accepted-status')).toContainText('Acceptance not saved');
    await expect(page.locator('reconciliation-task-marker [data-marker="exception"]')).toHaveCount(1);
    await expect(page.locator('reconciliation-task-marker [data-marker="warning"]')).toHaveCount(1);
    await review.locator('[data-review-view="accepted"]').click();
    await expect(review.locator('.exception-list')).toContainText('Agreed delivery window');
    await testInfo.attach('accepted-exception-pending', {
      body: await page.screenshot({ path: testInfo.outputPath('exception-pending.png') }), contentType: 'image/png',
    });
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      const result = await cmd.scenario.saveScenario('review');
      if (!result.ok) throw new Error(result.error.message);
    });
    expect(saves).toHaveLength(1);
    expect(saves[0].op).toBe('save');
    expect(saves[0].data.overrides).toEqual({});
    expect(saves[0].data.pluginData['plugin-reconciliation'].decisions[0].reason).toBe('Agreed delivery window');
    await expect(review.locator('.exception-list')).toContainText('Saved in this scenario');
    const retained = await review.evaluate((element) => ({ selectedId: element.selectedId,
      selectedIssueId: element.selectedIssueId, reviewView: element.reviewView }));
    await review.locator('[data-action="publish-scenario"]').click();
    const publication = page.locator('publish-scenario-modal');
    await expect(publication.locator('[aria-label="Scenario exception decisions"]'))
      .toContainText('Saved in this scenario');
    await expect(publication.locator('[aria-label="Scenario exception decisions"]'))
      .toContainText('Agreed delivery window');
    await testInfo.attach('scenario-publication-summary', {
      body: await page.screenshot({ path: testInfo.outputPath('publication-summary.png') }),
      contentType: 'image/png',
    });
    await publication.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(publication).toHaveCount(0);
    expect(await review.evaluate((element) => ({ selectedId: element.selectedId,
      selectedIssueId: element.selectedIssueId, reviewView: element.reviewView }))).toEqual(retained);
    expect(saves).toHaveLength(1);
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      cmd.scenario.activateScenario('baseline');
    });
    await expect(page.locator('reconciliation-task-marker [data-marker="exception"]')).toHaveCount(0);
    await expect(page.locator('reconciliation-task-marker [data-marker="warning"]')).toHaveCount(1);
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      cmd.scenario.activateScenario('review');
    });
    await expect(review.locator('.exception-list')).toContainText('Saved in this scenario');
    await review.locator('[data-action="undo-acceptance"]').click();
    await expect(review.locator('.exception-list')).toContainText('Acceptance undone');
    await expect(page.locator('reconciliation-task-marker [data-marker="exception"]')).toHaveCount(0);
    expect(await review.evaluate((element) => element.selectedId)).toBe('past-unfinished:delivery');
    const bounds = await review.locator('[data-review-view="accepted"]').evaluate((element) => ({
      width: element.clientWidth, content: element.scrollWidth,
    }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.width);
  });

  test(`configured state correction and undo retain review at desktop width ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async () => {
      const { store } = await import('/js/application/store.js');
      const { sel } = await import('/js/application/imports.js');
      store.setState((state) => ({ ...state,
        baseline: { ...state.baseline,
          projects: state.baseline.projects.map((project) => ({ ...project,
            work_item_display: project.work_item_display.map((process) => ({ ...process,
              tiers: process.tiers.map((tier) => tier.map((type) => ({ ...type, states: [
                { name: 'Active', category: 'InProgress' }, { name: 'Delivered', category: 'Completed' },
                { name: 'Cancelled', category: 'Completed' },
              ] }))) })) })),
          features: state.baseline.features.map((feature) => feature.id === 'delivery'
            ? { ...feature, end: '2026-10-02' } : feature),
        },
        scenarios: { ...state.scenarios, activeId: 'review', items: [...state.scenarios.items,
          { id: 'review', name: 'Review', readonly: false, overrides: {}, groupOverrides: {},
            scenarioGroups: [], pluginData: {} }] },
      }));
      document.querySelector('feature-card-lit').feature = sel.feature.getEffectiveFeatureById('delivery');
      const { initTimeline } = await import('/js/components/Timeline.lit.js');
      await import('/js/components/FeatureBoard.lit.js');
      const root = document.createElement('timeline-board');
      root.innerHTML = '<div id="scroll-container" style="position:relative;overflow:auto;height:600px;width:100%"><timeline-lit></timeline-lit><div id="board-area" style="position:relative;min-width:1800px"><feature-board></feature-board></div></div>';
      document.querySelector('main').replaceChildren(root);
      await initTimeline();
      await root.querySelector('feature-board').renderFeatures();
    });
    await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
    await selectReviewTask(page, 'Integration', 'past-unfinished');
    const review = page.locator('reconciliation-review');
    const states = review.locator('[data-state-choice]');
    await expect(states.locator('option')).toHaveText(['Choose state', 'Delivered', 'Cancelled']);
    await expect(review.locator('[data-action="apply-state"]')).toBeDisabled();
    await states.selectOption('Delivered');
    await expect(review.locator('.action-preview')).toContainText('Active \u2192 Delivered');
    await review.locator('[data-action="apply-state"]').click();
    await expect(review.locator('.impact-review')).toContainText('Programme');
    await testInfo.attach('state-impact-review', {
      body: await page.screenshot({ path: testInfo.outputPath('state-impact.png') }), contentType: 'image/png',
    });
    await review.locator('[data-action="continue-edit"]').click();
    await expect(review.locator('.resolved-task')).toContainText('No remaining findings');
    await expect(page.locator('reconciliation-task-marker button')).toHaveCount(0);
    await expect(page.locator('feature-card-lit .feature-card[data-id="delivery"]')).toHaveClass(/dirty/);
    const result = await page.evaluate(async () => {
      const { store } = await import('/js/application/store.js');
      const { sel } = await import('/js/application/imports.js');
      return { effective: sel.feature.getEffectiveFeatureById('delivery').state,
        source: store.getState().baseline.features[1].state,
        baselineOverrides: store.getState().scenarios.items[0].overrides,
        changed: store.getState().scenarios.changedIds,
        selected: document.querySelector('reconciliation-review').selectedId };
    });
    expect(result).toEqual({ effective: 'Delivered', source: 'Active', baselineOverrides: {},
      changed: ['review'], selected: 'past-unfinished:delivery' });
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      cmd.feature.revertFeature('delivery');
    });
    await expect(review.locator('.item[aria-pressed="true"]')).toContainText('Integration');
    await expect(page.locator('reconciliation-task-marker button')).toHaveCount(1);
  });
}

test('date correction opens Scheduling after impact review and leaves parent bounds unchanged', async ({ page }) => {
  await editDates(page, 'alternative');
  await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
  await selectReviewTask(page, 'Integration');
  const review = page.locator('reconciliation-review');
  await review.locator('[data-action="edit-dates"]').click();
  await expect(review.locator('.impact-review')).toContainText('extend direct parent bounds');
  await expect(page.locator('details-panel .panel:not(.closed)')).toHaveCount(0);
  await review.locator('[data-action="continue-edit"]').click();
  const inputs = page.locator('details-panel .date-input');
  await expect(inputs.first()).toBeFocused();
  await inputs.last().fill('2026-10-09');
  await expect(review.locator('.resolved-task')).toContainText('No remaining findings');
  await expect(page.locator('feature-card-lit .feature-card')).toHaveClass(/dirty/);
  const dates = await page.evaluate(async () => {
    const { sel } = await import('/js/application/imports.js');
    return [sel.feature.getEffectiveFeatureById('delivery').end,
      sel.feature.getEffectiveFeatureById('programme').end];
  });
  expect(dates).toEqual(['2026-10-09', '2026-10-10']);
});

test('recorded dependency correction keeps containment warning and selected issue outcome', async ({ page }) => {
  await editDates(page, 'alternative');
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: state.baseline.features.map((feature) => feature.id === 'programme'
        ? { ...feature, start: '2026-10-02', relations: [
          { type: 'Successor', id: 'delivery' }, { type: 'Related', id: 'delivery' }] } : feature),
    } }));
  });
  await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
  await selectReviewTask(page, 'Integration', 'dependency-order');
  const review = page.locator('reconciliation-review');
  await review.locator('[data-action="edit-dependency"]').click();
  await expect(review.locator('[data-action="remove-dependency"]')).toBeDisabled();
  await review.locator('[data-link-choice]').selectOption('0');
  await expect(review.locator('.link-preview')).toContainText('Programme delivery in Programme');
  await review.locator('[data-action="remove-dependency"]').click();
  await expect(review.locator('.resolved-task')).toContainText('1 other finding remains');
  await expect(review.locator('.issue-class[data-issue-type="containment"]')).toBeVisible();
  await expect(page.locator('reconciliation-task-marker button')).toHaveCount(1);
  const changes = await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    return store.getState().scenarios.items.find((scenario) => scenario.id === 'alternative').overrides;
  });
  expect(changes).toEqual({ delivery: { end: '2026-10-22' },
    programme: { relations: [{ type: 'Related', id: 'delivery' }] } });
});

test('toggles the toolbox directly from its active top-bar button without a dropdown or close button', async ({ page }) => {
  const trigger = page.locator('[data-plugin-id="plugin-reconciliation"]');
  await trigger.click();
  await expect(page.locator('reconciliation-review [role="region"]')).toBeVisible();
  await expect(page.locator('plugin-reconciliation-content')).toHaveCount(0);
  await expect(trigger).toHaveClass(/active/);
  await expect(trigger).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Close review', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide reconciliation toolbox' }).click();
  await expect(trigger).toHaveAttribute('aria-pressed', 'true');
  await trigger.click();
  await expect(page.locator('reconciliation-review')).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-pressed', 'false');
  await expect(trigger).toBeFocused();
  await editDates(page);
  await page.locator('reconciliation-task-marker button').click();
  await expect(trigger).toHaveAttribute('aria-pressed', 'true');
  await trigger.click();
  await expect(page.locator('reconciliation-review')).toHaveCount(0);
});

test('keeps the independent footer visible and clear of the toolbox', async ({ page }) => {
  const footer = page.locator('app-footer');
  await expect(footer.locator('[role="contentinfo"]')).toBeVisible();
  await expect(page.locator('app-sidebar .sidebar-config')).toHaveCount(0);
  await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
  await expect(footer).toContainText('Loaded dataset: 2 tasks');
  const footerBounds = await footer.boundingBox();
  const toolboxBounds = await page.locator('reconciliation-review [role="region"]').boundingBox();
  expect(toolboxBounds.y + toolboxBounds.height).toBeLessThanOrEqual(footerBounds.y);
  await page.getByRole('button', { name: 'Hide reconciliation toolbox' }).click();
  await expect(footer.locator('[role="contentinfo"]')).toBeVisible();
});

for (const width of [1366, 1024]) {
  test(`nonblocking hidden-parent detection and review at desktop width ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.locator('[data-plugin-id="plugin-reconciliation"]');
    await expect(trigger.locator('.menu-attention')).toHaveCount(0);
    await editDates(page, 'alternative');
    await expect(trigger.locator('.menu-attention')).toHaveAttribute('aria-label', /Across plans & dependencies: 1 affected tasks/);
    await expect(page.locator('feature-card-lit .feature-card')).toHaveClass(/dirty/);
    const warning = page.locator('reconciliation-task-marker button');
    await expect(warning).toHaveAttribute('title', /New:.*12 days late/);
    await trigger.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await trigger.click();
    await expect(page.locator('plugin-reconciliation-content')).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-pressed', 'true');
    const dialog = page.locator('reconciliation-review [role="region"]');
    await expect(dialog).toBeVisible();
    await selectReviewTask(page, 'Integration');
    await expect(dialog).toContainText('12 days late');
    await expect(dialog).toContainText('Programme');
    await expect(dialog).toContainText('2026-10-22');
    await expect(dialog.getByRole('button', { name: 'Locate related task', exact: true })).toBeEnabled();
    const search = dialog.getByRole('searchbox');
    await search.fill('no match');
    await expect(dialog).toContainText('No matching issues');
    await search.fill('');
    await selectReviewTask(page, 'Integration');
    await dialog.getByRole('button', { name: 'Open task', exact: true }).click();
    await expect(page.locator('details-panel .panel:not(.closed)')).toBeVisible();
    await expect(dialog).toBeVisible();
    await search.focus();
    await page.getByRole('button', { name: 'Hide reconciliation toolbox', exact: true }).click();
    await expect(dialog).toBeHidden();
    const restore = page.getByRole('button', { name: 'Show reconciliation toolbox', exact: true });
    await expect(restore).toBeFocused();
    await expect(page.locator('app-sidebar .sidebar')).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(element.getRootNode().activeElement))).toBe(false);
    await restore.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-category="schedule"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.locator('select')).toHaveCount(0);
    await expect(dialog.locator('.item[aria-pressed="true"]')).toContainText('Integration');
    await testInfo.attach('reconciliation-review', {
      body: await page.screenshot({ path: testInfo.outputPath('review.png') }), contentType: 'image/png',
    });
    await page.locator('details-panel input[type="date"]').last().fill('2026-10-09');
    await expect(dialog).toContainText('No issues found in the current scope');
    await expect(dialog.locator('.resolved-task h3')).toHaveText('Integration and customer acceptance');
    await expect(dialog.locator('.task-detail')).toContainText('No remaining findings');
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-pressed', 'true');
    await trigger.click();
    await expect(page.locator('reconciliation-review')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(warning).toHaveCount(0);
    const end = await page.evaluate(async () => {
      const { sel } = await import('/js/application/imports.js');
      return sel.feature.getEffectiveFeatureById('delivery').end;
    });
    expect(end).toBe('2026-10-09');
    const parentEnd = await page.evaluate(async () => {
      const { sel } = await import('/js/application/imports.js');
      return sel.feature.getEffectiveFeatureById('programme').end;
    });
    expect(parentEnd).toBe('2026-10-10');
  });
}

test('scenario switching uses effective dates and restores the baseline assessment', async ({ page }) => {
  await editDates(page, 'alternative');
  const trigger = page.locator('[data-plugin-id="plugin-reconciliation"]');
  await expect(trigger.locator('.menu-attention')).toHaveAttribute('aria-label', /Across plans & dependencies: 1/);
  await trigger.click();
  await expect(page.locator('reconciliation-review [role="region"]')).toContainText('Delivery alternative');
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, scenarios: { ...state.scenarios, activeId: 'baseline' } }));
  });
  await expect(trigger.locator('.menu-attention')).toHaveCount(0);
  await expect(page.locator('reconciliation-task-marker button')).toHaveCount(0);
  await expect(page.locator('reconciliation-review [role="region"]')).toContainText('Baseline');
  await expect(page.locator('reconciliation-review .list [role="status"]')).toContainText('No issues found');
});

test('expands issue classes and selected tasks inline with collapsible findings', async ({ page }, testInfo) => {
  await editDates(page);
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: [...state.baseline.features, { ...state.baseline.features[1],
        id: 'second-delivery', title: 'Second customer delivery', end: '2026-10-24' }],
    } }));
  });
  await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
  const dialog = page.locator('reconciliation-review [role="region"]');
  const group = dialog.locator('.issue-class[data-issue-type="containment"]');
  await expect(group.locator(':scope > summary')).toContainText('Task dates outside ancestor bounds');
  await expect(dialog.locator('.item')).toHaveCount(2);
  await expect(dialog.locator('.detail')).toHaveCount(0);
  await expect(group.locator('.item').first()).toBeHidden();
  await selectReviewTask(page, 'Second customer delivery');
  const selected = group.locator('.task:has(> .item[aria-pressed="true"])');
  await expect(selected.locator('.task-detail')).toContainText('14 days late');
  await expect(dialog.locator('.task-detail')).toHaveCount(1);
  const finding = selected.locator('.relationship');
  await finding.locator('summary').click();
  await expect(finding.locator('p').first()).toBeHidden();
  await finding.locator('summary').click();
  const markerToggle = dialog.locator('.filters [data-action="toggle-markers"]');
  await expect(markerToggle).toHaveAttribute('aria-pressed', 'true');
  await markerToggle.click();
  await expect(markerToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('reconciliation-task-marker button')).toHaveCount(0);
  for (const section of ['.workspace', '.task-detail']) {
    const fits = await dialog.locator(section).evaluate((element) =>
      element.scrollWidth <= element.clientWidth);
    expect(fits).toBe(true);
  }
  await testInfo.attach('grouped-reconciliation-review', {
    body: await page.screenshot({ path: testInfo.outputPath('grouped-review.png') }),
    contentType: 'image/png',
  });
});

test('marker selection scrolls the toolbox to expanded task actions even when reopened or reselected', async ({ page }) => {
  await editDates(page);
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: [...state.baseline.features, ...Array.from({ length: 24 }, (_, index) => ({
        ...state.baseline.features[1], id: `aaa-earlier-${String(index).padStart(2, '0')}`,
        title: `Earlier delivery ${index}`, end: '2026-10-24',
      }))],
    } }));
  });
  const marker = page.locator('reconciliation-task-marker button');
  const review = page.locator('reconciliation-review');
  const selected = review.locator('.item[aria-pressed="true"]');
  const actions = review.locator('.task-detail > .actions');
  const expectTaskRevealed = async () => {
    await expect(selected).toContainText('Integration and customer acceptance');
    await expect(selected).toBeInViewport({ ratio: 1 });
    await expect(actions).toBeInViewport({ ratio: 1 });
    await expect.poll(() => review.locator('.workspace').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  };
  await marker.click();
  await expectTaskRevealed();
  await review.locator('.workspace').evaluate((element) => { element.scrollTop = 0; });
  await marker.click();
  await expectTaskRevealed();
  await review.getByRole('searchbox').fill('no matching issue');
  await review.getByRole('button', { name: 'Hide reconciliation toolbox' }).click();
  await marker.click();
  await expect(review.getByRole('searchbox')).toHaveValue('');
  await expectTaskRevealed();
  await expect(page.locator('app-footer [role="contentinfo"]')).toBeVisible();
});

test('auto-locates rendered context, reveals hidden ancestors and restores the board scope on close', async ({ page }) => {
  await editDates(page);
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    const { initTimeline } = await import('/js/components/Timeline.lit.js');
    await import('/js/components/FeatureBoard.lit.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: [...state.baseline.features, { ...state.baseline.features[1], id: 'other',
        title: 'Unrelated delivery', end: '2026-10-10' }],
    } }));
    window.reviewViewBefore = store.getState().view;
    const root = document.createElement('timeline-board');
    root.innerHTML = '<div id="scroll-container" style="position:relative;overflow:auto;height:600px;width:100%"><timeline-lit></timeline-lit><div id="board-area" style="position:relative;min-width:1800px"><feature-board></feature-board></div></div>';
    document.querySelector('main').replaceChildren(root);
    await initTimeline();
    const board = root.querySelector('feature-board');
    await board.renderFeatures();
    await board.updateComplete;
  });
  const boardIds = () => page.evaluate(() => document.querySelector('feature-board')._fullRenderList
    .filter((item) => !item.isGroup).map((item) => item.feature.id));
  await expect.poll(boardIds).toEqual(['delivery', 'other']);
  const trigger = page.locator('[data-plugin-id="plugin-reconciliation"]');
  await trigger.click();
  await selectReviewTask(page, 'Integration');
  await expect.poll(boardIds).toEqual(['programme', 'delivery']);
  await expect(page.locator('feature-board feature-card-lit[data-feature-id="delivery"]'))
    .toHaveClass(/search-highlight/);
  const selected = page.locator('reconciliation-review .item[aria-pressed="true"]');
  await expect(selected).toBeFocused();
  const highlighted = page.locator('feature-board feature-card-lit[data-feature-id="delivery"]');
  await expect(highlighted).not.toHaveClass(/search-highlight/);
  await selected.click();
  await expect(highlighted).toHaveClass(/search-highlight/);
  await expect(selected).toBeFocused();
  await expect(page.locator('reconciliation-review .filters header')).toContainText('Reconciliation');
  await expect(page.locator('reconciliation-review .filters [data-context="all"]')).toBeVisible();
  await expect(page.locator('reconciliation-review .task-detail [data-context]')).toHaveCount(0);
  await expect(trigger.locator('.menu-attention')).toHaveAttribute('aria-label', /1 affected tasks/);
  await page.locator('reconciliation-review [data-context="all"]').click();
  await expect.poll(boardIds).toEqual(['programme', 'delivery', 'other']);
  await expect(trigger.locator('.menu-attention')).toHaveAttribute('aria-label', /1 affected tasks/);
  await page.getByRole('button', { name: 'Hide reconciliation toolbox' }).click();
  await expect.poll(boardIds).toEqual(['programme', 'delivery', 'other']);
  await page.getByRole('button', { name: 'Show reconciliation toolbox' }).click();
  await page.locator('reconciliation-review [data-context="relevant"]').click();
  await expect.poll(boardIds).toEqual(['programme', 'delivery']);
  expect(await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    return store.getState().view === window.reviewViewBefore;
  })).toBe(true);
  await trigger.click();
  await expect.poll(boardIds).toEqual(['delivery', 'other']);
});

test('reveals filtered cross-plan dependency context without saving it or reverting hidden-toolbox edits', async ({ page }) => {
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    const { initTimeline } = await import('/js/components/Timeline.lit.js');
    await import('/js/components/FeatureBoard.lit.js');
    store.setState((state) => ({ ...state,
      baseline: { ...state.baseline, features: state.baseline.features.map((feature) =>
        feature.id === 'delivery' ? { ...feature, relations: [{ id: 'programme', type: 'Predecessor' }] }
          : { ...feature, start: '2026-10-05' }) },
      selection: { ...state.selection, projectIds: ['delivery'] },
      view: { ...state.view, context: { parent: false, child: false, dependency: false,
        otherAllocations: false } },
    }));
    const root = document.createElement('timeline-board');
    root.innerHTML = '<div id="scroll-container" style="position:relative;overflow:auto;height:600px;width:100%"><timeline-lit></timeline-lit><div id="board-area" style="position:relative;min-width:1800px"><feature-board></feature-board></div></div>';
    document.querySelector('main').replaceChildren(root);
    await initTimeline();
    await root.querySelector('feature-board').renderFeatures();
  });
  const boardIds = () => page.evaluate(() => document.querySelector('feature-board')._fullRenderList
    .filter((item) => !item.isGroup).map((item) => item.feature.id).sort());
  await expect.poll(boardIds).toEqual(['delivery']);
  const trigger = page.locator('[data-plugin-id="plugin-reconciliation"]');
  await trigger.click();
  await selectReviewTask(page, 'Integration', 'dependency-order');
  await expect.poll(boardIds).toEqual(['delivery', 'programme']);
  const finding = page.locator('reconciliation-review [data-issue-type="dependency-order"] .relationship');
  await expect(finding).toContainText('must not start before its predecessor starts');
  await expect(finding).toContainText('Cross-plan impact');
  await expect(finding).toContainText('4 days early');
  await expect(page.locator('feature-board [data-feature-id="delivery"]')).toHaveClass(/search-highlight/);
  await page.getByRole('button', { name: 'Hide reconciliation toolbox', exact: true }).click();
  await page.evaluate(async () => {
    const { cmd, sel } = await import('/js/application/imports.js');
    const { store } = await import('/js/application/store.js');
    cmd.filter.setAllStatesSelected(false);
    store.setState((state) => ({ ...state, scenarios: { ...state.scenarios,
      items: state.scenarios.items.map((scenario) => ({ ...scenario,
        overrides: { delivery: { end: '2026-10-09' } } })),
    } }));
    window.reviewSavedView = cmd.viewRestore.captureCurrentView();
    window.reviewResolvedTasks = sel.scope.getResolvedFeatures();
    await document.querySelector('feature-board').renderFeatures();
  });
  await expect.poll(boardIds).toEqual(['delivery', 'programme']);
  await page.getByRole('button', { name: 'Show reconciliation toolbox', exact: true }).click();
  await page.locator('reconciliation-review [data-context="all"]').click();
  await expect.poll(boardIds).toEqual(['delivery', 'programme']);
  await trigger.click();
  await expect.poll(boardIds).toEqual([]);
  const outcome = await page.evaluate(async () => {
    const { cmd, sel } = await import('/js/application/imports.js');
    const { store } = await import('/js/application/store.js');
    return { savedViewUnchanged: JSON.stringify(cmd.viewRestore.captureCurrentView())
        === JSON.stringify(window.reviewSavedView),
      resolvedUnchanged: sel.scope.getResolvedFeatures() === window.reviewResolvedTasks,
      projectIds: store.getState().selection.projectIds,
      effectiveEnd: sel.feature.getEffectiveFeatureById('delivery').end,
      sourceEnd: store.getState().baseline.features[1].end };
  });
  expect(outcome).toEqual({ savedViewUnchanged: true, resolvedUnchanged: true,
    projectIds: ['delivery'], effectiveEnd: '2026-10-09', sourceEnd: '2026-10-10' });
});

test('shows incomplete relationship assessment without drift or unloaded-task editor actions', async ({ page }) => {
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: state.baseline.features.map((feature) => feature.id === 'delivery'
        ? { ...feature, relations: [{ id: 'missing-task', type: 'Predecessor' }] } : feature),
    } }));
  });
  await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
  await selectReviewTask(page, 'Integration', 'unavailable-dependency');
  const finding = page.locator('reconciliation-review .relationship');
  await expect(finding).toContainText('Cannot assess');
  await expect(finding).toContainText('Task missing-task (not loaded)');
  await expect(finding).toContainText('Affected plan unavailable');
  await expect(finding).not.toContainText('days early');
  await expect(finding.getByRole('button', { name: 'Open related task', exact: true })).toHaveCount(0);
  await expect(finding.locator('[data-action="edit-dependency"]')).toBeDisabled();
  await expect(page.locator('reconciliation-review')).not.toContainText('No issues found');
});

test('keeps board and Sidebar interactive and removes hidden toolbox on plugin disable', async ({ page }) => {
  await editDates(page);
  await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
  const review = page.locator('reconciliation-review');
  await page.locator('feature-card-lit .feature-card').click();
  await expect(review.locator('[role="region"]')).toBeVisible();
  const main = page.locator('main');
  await main.hover();
  await page.mouse.wheel(0, 250);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await review.getByRole('searchbox').fill('Integration');
  await review.getByRole('button', { name: 'Hide reconciliation toolbox' }).click();
  const sidebarControl = page.locator('app-sidebar .filter-option').first();
  await sidebarControl.click();
  await review.getByRole('button', { name: 'Show reconciliation toolbox' }).click();
  await expect(review.getByRole('searchbox')).toHaveValue('Integration');
  await review.getByRole('button', { name: 'Hide reconciliation toolbox' }).click();
  await page.evaluate(async () => {
    const { pluginManager } = await import('/js/core/PluginManager.js');
    await pluginManager.unregister('plugin-reconciliation');
  });
  await expect(review).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show reconciliation toolbox' })).toHaveCount(0);
  await expect(page.locator('app-sidebar .sidebar')).toBeVisible();
});

test('shows ordered category pairs, counts tasks rather than findings and hides zero pairs', async ({ page }) => {
  await editDates(page);
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: [...state.baseline.features.map((feature) => feature.id === 'delivery'
        ? { ...feature, relations: [{ type: 'Predecessor', id: 'programme' }] } : feature),
        { ...state.baseline.features[1],
        id: 'overdue', title: 'Overdue delivery', parentId: null, end: '2026-10-02' }],
    } }));
  });
  const trigger = page.locator('[data-plugin-id="plugin-reconciliation"]');
  await expect(trigger.locator('.menu-attention')).toHaveCount(2);
  expect(await trigger.locator('.menu-attention').evaluateAll((elements) =>
    elements.map((element) => element.dataset.category))).toEqual(['quality', 'schedule']);
  await expect(trigger.locator('[data-category="quality"]')).toHaveAttribute('aria-label', /1 affected tasks/);
  await expect(trigger.locator('[data-category="schedule"]')).toHaveAttribute('aria-label', /1 affected tasks/);
  expect(await trigger.locator('.menu-attention').evaluateAll((elements) =>
    elements.every((element) => element.scrollHeight <= element.clientHeight))).toBe(true);
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: state.baseline.features.filter((feature) => feature.id !== 'overdue')
        .map((feature) => ({ ...feature, relations: [] })),
    }, scenarios: { ...state.scenarios, items: state.scenarios.items.map((scenario) =>
      ({ ...scenario, overrides: {} })) } }));
  });
  await expect(trigger.locator('.menu-attention')).toHaveCount(0);
  await expect(trigger).toContainText('Reconciliation');
  await expect(trigger).toHaveAttribute('title', 'No issues found in the current scope.');
});