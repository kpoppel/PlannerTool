import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/js/modules.config.json');
  await page.setContent(`<style>
    body { font-family: 'Segoe UI', sans-serif; margin: 0; background: #f6f8f7;
      --color-sidebar-bg: #294a43; --color-sidebar-text: white; --sidebar-width: 240px; }
    main { position: relative; margin: 90px 80px; height: 300px; }
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
    const state = createInitialAppState();
    const parent = { id: 'programme', title: 'Programme delivery', type: 'Epic',
      project: 'programme', state: 'Active', start: '2026-10-01', end: '2026-10-10',
      parentId: null, capacity: [], relations: [] };
    const child = { ...parent, id: 'delivery', title: 'Integration and customer acceptance',
      type: 'Feature', project: 'delivery', parentId: 'programme' };
    const project = { id: 'programme', name: 'Programme', type: 'project', container_order: 0,
      container_types: ['project', 'team'], task_type_hierarchy: [{ types: ['Epic'] }, { types: ['Feature'] }],
      state_categories: { Active: 'InProgress' }, color: '#167d69' };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [project, { ...project, id: 'delivery', name: 'Delivery team',
      type: 'team', container_order: 1, color: '#d99030' }];
    state.baseline.features = [parent, child];
    state.selection.projectIds = ['programme', 'delivery'];
    state.selection.featureStateNames = ['Active'];
    state.selection.taskTypeNames = ['Feature'];
    store.setState(state, true);
    reconciliation.clock = () => new Date('2026-10-03T12:00:00');
    await pluginManager.register(new PluginReconciliation('plugin-reconciliation', {
      id: 'plugin-reconciliation', type: 'menu', name: 'Reconciliation', enabled: true,
      exclusive: false, dependencies: [], menuPosition: 'before-tools', description: 'Live plan issues',
    }));
    document.body.prepend(document.createElement('top-menu-bar'));
    const card = document.createElement('feature-card-lit');
    card.feature = sel.feature.getEffectiveFeatureById('delivery');
    card.project = state.baseline.projects[1];
    card.style.cssText = 'left:240px;top:50px;width:360px';
    document.querySelector('main').appendChild(card);
    await card.updateComplete;
    await document.querySelector('top-menu-bar').updateComplete;
  });
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

for (const width of [1366, 1024]) {
  test(`nonblocking hidden-parent detection and review at desktop width ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.locator('[data-plugin-id="plugin-reconciliation"]');
    await expect(trigger.locator('.menu-attention')).toHaveCount(0);
    await editDates(page);
    await expect(trigger.locator('.menu-attention')).toHaveText('1');
    await expect(page.locator('feature-card-lit .feature-card')).toHaveClass(/dirty/);
    const warning = page.locator('reconciliation-task-marker button');
    await expect(warning).toHaveAttribute('title', /New:.*12 days late/);
    await trigger.click();
    const menu = page.locator('plugin-reconciliation-content');
    await expect(menu).toContainText('Schedule conflicts');
    await expect(menu).toContainText('Plan quality');
    const fit = await menu.evaluate((element) => ({ width: element.getBoundingClientRect().width,
      parentWidth: element.parentElement.clientWidth, scrollWidth: element.scrollWidth }));
    expect(fit.width).toBeLessThanOrEqual(fit.parentWidth);
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.parentWidth);
    await menu.locator('[data-category="schedule"]').click();
    const dialog = page.locator('reconciliation-review dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('12 days late');
    await expect(dialog).toContainText('Programme');
    await expect(dialog).toContainText('2026-10-22');
    await expect(dialog.getByRole('button', { name: 'Locate related task', exact: true })).toBeDisabled();
    const search = dialog.getByRole('searchbox');
    await search.fill('no match');
    await expect(dialog).toContainText('No matching issues');
    await search.fill('');
    await testInfo.attach('reconciliation-review', {
      body: await page.screenshot({ path: testInfo.outputPath('review.png') }), contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('reconciliation-review')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(warning).toBeVisible();
    const end = await page.evaluate(async () => {
      const { sel } = await import('/js/application/imports.js');
      return sel.feature.getEffectiveFeatureById('delivery').end;
    });
    expect(end).toBe('2026-10-22');
  });
}

test('scenario switching uses effective dates and restores the baseline assessment', async ({ page }) => {
  await editDates(page, 'alternative');
  const trigger = page.locator('[data-plugin-id="plugin-reconciliation"]');
  await expect(trigger.locator('.menu-attention')).toHaveText('1');
  await trigger.click();
  await page.locator('plugin-reconciliation-content [data-category="schedule"]').click();
  await expect(page.locator('reconciliation-review dialog')).toContainText('Delivery alternative');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, scenarios: { ...state.scenarios, activeId: 'baseline' } }));
  });
  await expect(trigger.locator('.menu-attention')).toHaveCount(0);
  await expect(page.locator('reconciliation-task-marker button')).toHaveCount(0);
});

test('reviews multiple tasks together in a collapsible issue-type group', async ({ page }, testInfo) => {
  await editDates(page);
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: [...state.baseline.features, { ...state.baseline.features[1],
        id: 'second-delivery', title: 'Second customer delivery', end: '2026-10-24' }],
    } }));
  });
  await page.locator('[data-plugin-id="plugin-reconciliation"]').click();
  await page.locator('plugin-reconciliation-content [data-category="schedule"]').click();
  const dialog = page.locator('reconciliation-review dialog');
  const group = dialog.locator('[data-issue-type="containment"]');
  await expect(group.locator('summary')).toContainText('Task dates outside ancestor bounds');
  await expect(group.locator('.count')).toHaveText('2');
  await expect(group.locator('.item')).toHaveCount(2);
  await group.locator('summary').click();
  await expect(group.locator('.item').first()).toBeHidden();
  await group.locator('summary').click();
  await group.getByRole('button', { name: /Second customer delivery/ }).click();
  await expect(dialog.locator('.detail h3')).toHaveText('Second customer delivery');
  await expect(dialog.locator('.detail')).toContainText('14 days late');
  for (const section of ['.list', '.detail']) {
    const fits = await dialog.locator(section).evaluate((element) =>
      element.scrollWidth <= element.clientWidth);
    expect(fits).toBe(true);
  }
  await testInfo.attach('grouped-reconciliation-review', {
    body: await page.screenshot({ path: testInfo.outputPath('grouped-review.png') }),
    contentType: 'image/png',
  });
});