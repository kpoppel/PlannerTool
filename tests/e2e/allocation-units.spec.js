import { test, expect } from '@playwright/test';

async function mountEditor(page, options = {}) {
  await page.goto('/js/modules.config.json');
  await page.setContent(`<style>
    body { margin: 32px; font: 14px 'Segoe UI', sans-serif; background: #f6f8f7;
      --details-width: 340px; --z-details: 140; }
    main { position: relative; width: 700px; height: 400px; }
  </style><main></main>`);
  await page.evaluate(async (fixture) => {
    const { store } = await import('/js/application/store.js');
    const { createInitialAppState } = await import('/js/application/createInitialAppState.js');
    const { cmd, sel } = await import('/js/application/imports.js');
    const { dataService } = await import('/js/services/dataService.js');
    await import('/js/components/DetailsPanel.lit.js');
    await import('/js/components/ConfigModal.lit.js');
    await import('/js/components/FeatureCard.lit.js');
    const state = createInitialAppState();
    const project = { id: 'plan', name: 'Delivery', type: 'project', container_order: 0,
      container_types: ['project'], allocation_defaults: { project: ['alpha', 'beta'] },
      work_item_display: [{ process_id: 'process', process_name: 'Delivery process', tiers: [[{
        name: 'Feature', states: [{ name: 'Active', category: 'InProgress' }],
      }]] }], color: '#167d69', iteration_uuid: 'schedules' };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [project];
    state.baseline.teams = [
      { id: 'alpha', name: 'Alpha', kind: 'team', archived: false, group_id: null, color: '#167d69' },
      { id: 'beta', name: 'Beta', kind: 'team', archived: false, group_id: null, color: '#bf4a44' },
    ];
    const capacity = fixture.capacity === undefined ? [{ team: 'alpha', capacity: 20 }] : fixture.capacity;
    state.baseline.features = [{ id: 'task', project: 'plan', title: 'Customer acceptance',
      process_id: 'process', type: 'Feature', state: 'Active', start: '2026-10-05', end: '2026-10-16', parentId: null,
      capacity, relations: [], tags: '', description: '' }];
    if (fixture.childEnd !== undefined) {
      state.baseline.features.push({ ...state.baseline.features[0], id: 'child', parentId: 'task',
        title: 'Nested schedule', start: '2026-10-12', end: fixture.childEnd, capacity: [] });
    }
    state.baseline.iterationsByProject = { schedules: { id: 'schedules', presets: [
      { id: 'longer', label: 'Longer schedule', start: '2026-10-05', end: '2026-10-23' },
    ] } };
    state.selection.projectIds = ['plan'];
    state.selection.teamIds = ['alpha', 'beta'];
    state.selection.featureStateNames = ['Active'];
    state.scenarios.activeId = fixture.scenarioId === undefined ? 'draft' : fixture.scenarioId;
    state.scenarios.items.push({ id: 'draft', name: 'Effort draft',
      readonly: fixture.readonly === true,
      overrides: fixture.overrides === undefined ? {} : fixture.overrides,
      groupOverrides: {}, scenarioGroups: [], pluginData: {} });
    if (fixture.access !== undefined) state.scenarios.items.at(-1).access = fixture.access;
    store.setState(state, true);
    await dataService.setLocalPref('user.email', 'editor@example.test');
    await cmd.data.initializeAllocationPreferences();
    cmd.data.recomputeCapacity();
    const card = document.createElement('feature-card-lit');
    card.feature = sel.feature.getEffectiveFeatureById('task');
    card.teams = state.baseline.teams;
    card.project = project;
    card.style.cssText = 'left:0;top:80px;width:200px';
    document.querySelector('main').appendChild(card);
    const panel = document.createElement('details-panel');
    document.body.appendChild(panel);
    cmd.feature.setSelectedFeature(sel.feature.getEffectiveFeatureById('task'));
    await panel.updateComplete;
    await card.updateComplete;
  }, options);
}

async function enableManDays(page) {
  await page.evaluate(() => document.body.appendChild(document.createElement('config-modal')));
  await expect(page.locator('config-modal #allocationUnit')).toHaveValue('percent');
  await page.locator('config-modal #allocationUnit').selectOption('man-days');
  await page.locator('config-modal #saveConfigBtn').click();
  await expect(page.locator('config-modal #configStatus')).toContainText('Configuration saved');
  await page.locator('config-modal #closeConfigBtn').click();
}

async function overrides(page) {
  return page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    return store.getState().scenarios.items.find((item) => item.id === 'draft').overrides;
  });
}

test.describe('Man-day allocation desktop', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { ok: true } }));
    await page.route('**/api/cost/teams', (route) => route.fulfill({ json: {
      teams: {
        alpha: { internal: { fte: 3 }, external: { fte: 2 } },
        beta: { internal: { fte: 2.5 }, external: { fte: 0 } },
      }, groups: {},
    } }));
  });

  for (const mode of ['baseline', 'readonly', 'shared-reader']) {
    test(`${mode} is inspection-only and copying creates an editable scenario`, async ({ page }, testInfo) => {
      const options = mode === 'baseline' ? { scenarioId: 'baseline' }
        : mode === 'readonly' ? { readonly: true }
        : { access: { canEdit: false, reason: 'not-owner' } };
      await mountEditor(page, options);
      const panel = page.locator('details-panel');
      await page.evaluate(async () => {
        const { bus } = await import('/js/core/EventBus.js');
        document.querySelector('main').id = 'board-area';
        document.querySelector('feature-card-lit').bus = bus;
      });
      await panel.locator('.details-close').click();
      await page.locator('feature-card-lit').click();
      await expect(panel.locator('.panel')).toBeVisible();
      await expect(panel.locator('input, select, .state-chip, .capacity-bar-delete, .add-team-btn, .tag-chip button, .details-revert')).toHaveCount(0);
      await expect(panel.locator('.capacity-value')).toHaveText('20%');
      await expect(panel.locator('.date-row')).toContainText('2026-10-05');
      await expect(page.locator('feature-card-lit .drag-handle')).toHaveCount(0);
      await expect(panel.locator('.details-close')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${mode}-inspection-desktop.png`) });
      const source = await page.evaluate(async () => {
        const { cmd, sel } = await import('/js/application/imports.js');
        const id = sel.scenario.getActiveScenarioId();
        const copy = cmd.scenario.cloneScenario(id, 'Editable copy');
        cmd.scenario.activateScenario(copy.id);
        return id;
      });
      const input = panel.locator('.capacity-bar-input');
      await expect(input).toHaveValue('20');
      await expect(page.locator('feature-card-lit .drag-handle')).toHaveCount(1);
      await input.fill('30');
      await input.press('Tab');
      const result = await page.evaluate(async (id) => {
        const { sel } = await import('/js/application/imports.js');
        return { source: sel.scenario.getScenarios().find((scenario) => scenario.id === id).overrides,
          copy: sel.scenario.getActiveScenario().overrides };
      }, source);
      expect(result.source).toEqual({});
      expect(result.copy.task.capacity).toEqual([{ team: 'alpha', capacity: 30 }]);
    });
  }

  for (const unit of ['percent', 'man-days']) {
    for (const policy of ['keep-allocation', 'keep-effort']) {
      for (const delta of [-80, 80]) {
        test(`${unit} ${policy} handle ${delta < 0 ? 'shortens' : 'extends'} the task`, async ({ page }, testInfo) => {
          await mountEditor(page);
          if (unit === 'man-days') await enableManDays(page);
          await page.locator('details-panel .details-close').click();
          await page.evaluate(async () => {
            const { TIMELINE_CONFIG } = await import('/js/components/Timeline.lit.js');
            TIMELINE_CONFIG.monthWidth = 620;
            document.querySelector('feature-card-lit').style.width = '240px';
          });
          const card = page.locator('feature-card-lit');
          const handle = card.locator('.drag-handle');
          const zone = card.locator(`[data-resize-policy="${policy}"]`);
          await card.hover();
          const box = await zone.boundingBox();
          const startX = box.x + box.width / 2;
          const startY = box.y + box.height / 2;
          await page.mouse.move(startX, startY);
          await page.mouse.down();
          await expect(handle).toHaveAttribute('data-active-policy', policy);
          const color = policy === 'keep-effort' ? 'rgb(169, 104, 23)' : 'rgb(23, 109, 104)';
          await expect(card.locator('.resize-zone').nth(0)).toHaveCSS('background-color', color);
          await expect(card.locator('.resize-zone').nth(1)).toHaveCSS('background-color', color);
          const opposite = await card.locator('.resize-zone').nth(policy === 'keep-effort' ? 0 : 1).boundingBox();
          await page.mouse.move(startX, opposite.y + opposite.height / 2);
          await expect(handle).toHaveAttribute('data-active-policy', policy);
          await expect(card.locator('.resize-zone').nth(0)).toHaveCSS('background-color', color);
          await expect(card.locator('.resize-zone').nth(1)).toHaveCSS('background-color', color);
          await page.mouse.move(startX + delta, startY, { steps: 8 });
          await page.mouse.up();
          await expect(handle).toHaveAttribute('data-active-policy', '');
          const result = await page.evaluate(async () => {
            const { sel } = await import('/js/application/imports.js');
            const { countWorkingDays } = await import('/js/application/shared/allocationUnits.js');
            const feature = sel.feature.getEffectiveFeatureById('task');
            return { days: countWorkingDays(feature), percent: feature.capacity[0].capacity,
              end: feature.end };
          });
          expect(result.end < '2026-10-16').toBe(delta < 0);
          expect(result.percent).toBeCloseTo(policy === 'keep-effort' ? 20 * 10 / result.days : 20, 12);
          expect((await overrides(page)).task.end).toBe(result.end);
          await page.screenshot({ path: testInfo.outputPath(`${unit}-${policy}-${delta}.png`) });
        });
      }
    }
  }

  test('split zones remain usable in normal and condensed desktop cards at board zoom levels', async ({ page }, testInfo) => {
    await mountEditor(page);
    await page.locator('details-panel .details-close').click();
    const card = page.locator('feature-card-lit');
    for (const condensed of [false, true]) {
      for (const zoom of [0.75, 1, 1.5]) {
        await card.evaluate(async (element, settings) => {
          element.condensed = settings.condensed;
          element.style.setProperty('--board-zoom', String(settings.zoom));
          await element.updateComplete;
        }, { condensed, zoom });
        await card.hover();
        const zones = card.locator('.resize-zone');
        const upper = await zones.nth(0).boundingBox();
        const lower = await zones.nth(1).boundingBox();
        expect(upper.width).toBe(10);
        expect(lower.width).toBe(10);
        expect(upper.height).toBeGreaterThan(8);
        expect(lower.height).toBeGreaterThan(8);
        expect(lower.y).toBeCloseTo(upper.y + upper.height, 1);
        await zones.nth(0).click();
        expect(await overrides(page)).toEqual({});
        await expect(card.locator('.drag-handle')).toHaveAttribute('data-active-policy', '');
        await zones.nth(1).hover();
        await page.mouse.down();
        await page.mouse.move(lower.x + 50, lower.y + lower.height / 2, { steps: 4 });
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.mouse.up();
        await expect(card.locator('.drag-handle')).toHaveAttribute('data-active-policy', '');
        await expect(card).toHaveCSS('width', '200px');
        expect(await overrides(page)).toEqual({});
        await page.screenshot({ path: testInfo.outputPath(`handle-${condensed}-${zoom}.png`) });
      }
    }
  });

  test('percent effort resize can recover staffing in Configuration without changing units', async ({ page }) => {
    await page.route('**/api/cost/teams', (route) => route.fulfill({ status: 503, json: { detail: 'Offline' } }));
    await mountEditor(page);
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      cmd.feature.resizeFeatureDates([{ id: 'task', end: '2026-10-23' }], 'keep-effort');
    });
    expect(await overrides(page)).toEqual({});
    await page.evaluate(() => document.body.appendChild(document.createElement('config-modal')));
    const config = page.locator('config-modal');
    await expect(config.locator('#allocationUnit')).toHaveValue('percent');
    await expect(config.locator('#retryStaffingBtn')).toBeVisible();
    await page.route('**/api/cost/teams', (route) => route.fulfill({ json: {
      teams: { alpha: { internal: { fte: 5 }, external: { fte: 0 } } }, groups: {},
    } }));
    await config.locator('#retryStaffingBtn').click();
    await expect(config.locator('#configStatus')).toHaveText('Staffing loaded.');
    await config.locator('#closeConfigBtn').click();
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      cmd.feature.resizeFeatureDates([{ id: 'task', end: '2026-10-23' }], 'keep-effort');
    });
    expect((await overrides(page)).task.capacity[0].capacity).toBeCloseTo(200 / 15, 12);
  });

  test('split handle explains hover, supports keyboard resizing and cancels cleanly', async ({ page }) => {
    await mountEditor(page);
    await page.locator('details-panel .details-close').click();
    const card = page.locator('feature-card-lit');
    const handle = card.locator('.drag-handle');
    const zone = card.getByRole('button', { name: 'Keep effort: resize duration and allocation' });
    await card.hover();
    await zone.hover();
    await expect(card.getByRole('tooltip')).toHaveText('Keep effort: allocation changes as you resize; effort stays fixed.');
    const box = await zone.boundingBox();
    await page.mouse.down();
    await expect(card.getByRole('tooltip')).toHaveCount(0);
    await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(handle).toHaveAttribute('data-active-policy', '');
    await expect(card).toHaveCSS('width', '200px');
    expect(await overrides(page)).toEqual({});
    await zone.focus();
    await expect(handle).toHaveCSS('opacity', '1');
    await page.keyboard.press('ArrowRight');
    expect((await overrides(page)).task.end).toBe('2026-10-17');
    expect((await overrides(page)).task.capacity).toBeUndefined();
  });

  test('switching away and back cancels wheel drafts and an in-progress resize', async ({ page }) => {
    await mountEditor(page);
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      const input = document.querySelector('details-panel').shadowRoot.querySelector('.capacity-bar-input');
      input.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, cancelable: true }));
      cmd.scenario.activateScenario('baseline');
      cmd.scenario.activateScenario('draft');
    });
    const input = page.locator('details-panel .capacity-bar-input');
    await expect(input).toHaveValue('20');
    await input.focus();
    await input.press('Tab');
    expect(await overrides(page)).toEqual({});
    await page.locator('details-panel .details-close').click();
    const card = page.locator('feature-card-lit');
    const handle = await card.locator('[data-resize-policy="keep-effort"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 80, handle.y, { steps: 8 });
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      cmd.scenario.activateScenario('baseline');
      cmd.scenario.activateScenario('draft');
    });
    await page.mouse.up();
    await expect(card).toHaveCSS('width', '200px');
    expect(await overrides(page)).toEqual({});
  });

  test('whole-day entry, ceiling displays, save and reload retain fractional percentages', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mountEditor(page);
    await enableManDays(page);
    expect(await overrides(page)).toEqual({});
    const input = page.locator('details-panel .capacity-bar-input');
    await expect(input).toHaveValue('10');
    await expect(input).toHaveAttribute('max', '50');
    await expect(page.locator('feature-card-lit .team-load-box').last()).toHaveText('20');
    await input.fill('11');
    await input.press('Enter');
    await input.press('Tab');
    await expect(input).toHaveValue('11');
    await expect(page.locator('details-panel .capacity-bar-label')).toHaveText('22%');
    await page.getByRole('combobox', { name: 'Schedule preset' }).selectOption('longer');
    await expect(input).toHaveValue('11');
    await expect(page.locator('details-panel .capacity-bar-label')).toHaveText('15%');
    const result = await overrides(page);
    expect(result.task.end).toBe('2026-10-23');
    expect(result.task.capacity[0].capacity).toBeCloseTo(11 / 75 * 100, 12);
    const writes = [];
    await page.route('**/api/scenario', async (route) => {
      writes.push(route.request().postDataJSON());
      await route.fulfill({ json: { id: 'draft', name: 'Effort draft' } });
    });
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      await cmd.scenario.saveScenario();
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].data.overrides.task.capacity).toEqual(result.task.capacity);
    expect(writes[0].data).not.toHaveProperty('allocation');
    await page.reload();
    await mountEditor(page, { overrides: writes[0].data.overrides });
    await expect(input).toHaveValue('11');
    await expect(page.locator('details-panel .capacity-bar-label')).toHaveText('15%');
    await page.evaluate(() => document.body.appendChild(document.createElement('config-modal')));
    await expect(page.locator('config-modal #allocationUnit')).toHaveValue('man-days');
    await page.locator('config-modal #closeConfigBtn').click();
    await expect(page.locator('feature-card-lit .team-load-box').last()).toHaveText('15');
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      await cmd.data.setAllocationUnit('percent');
    });
    await expect(input).toHaveValue('15');
    await input.press('Enter');
    await input.press('Tab');
    expect(await overrides(page)).toEqual(writes[0].data.overrides);
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      await cmd.data.setAllocationUnit('man-days');
    });
    await expect(input).toHaveValue('11');
    await input.press('Enter');
    await input.press('Tab');
    expect(await overrides(page)).toEqual(writes[0].data.overrides);
    await page.locator('details-panel .details-revert').click();
    await expect(input).toHaveValue('10');
    await input.fill('10.1');
    await input.press('Tab');
    expect(await input.evaluate((element) => element.validity.stepMismatch)).toBe(true);
    expect(await overrides(page)).toEqual({});
    await input.fill('10');
    await input.press('Tab');
    await testInfo.attach('man-days-desktop', { body: await page.screenshot({
      path: testInfo.outputPath('man-days-desktop.png'),
    }), contentType: 'image/png' });
    await input.fill('15');
    await input.press('Tab');
    await page.locator('details-panel .details-revert').click();
    expect(await overrides(page)).toEqual({});
    expect(errors).toEqual([]);
  });

  test('add-team input uses selected staffing and over-capacity scheduling preserves all rows', async ({ page }) => {
    await mountEditor(page);
    await enableManDays(page);
    await page.locator('details-panel .add-team-btn').click();
    const form = page.locator('details-panel .add-team-form');
    await expect(form.locator('input')).toBeDisabled();
    await form.locator('select').selectOption('beta');
    await expect(form.locator('input')).toHaveAttribute('max', '25');
    await form.locator('input').fill('20');
    await form.getByRole('button', { name: 'Add', exact: true }).click();
    expect((await overrides(page)).task.capacity).toEqual([
      { team: 'alpha', capacity: 20 }, { team: 'beta', capacity: 80 },
    ]);
    const end = page.locator('details-panel input[type="date"]').nth(1);
    await end.fill('2026-10-09');
    await end.press('Tab');
    await expect(end).toHaveValue('2026-10-16');
    await expect(page.locator('details-panel .capacity-bar-row')).toHaveCount(2);
    expect((await overrides(page)).task.capacity).toEqual([
      { team: 'alpha', capacity: 20 }, { team: 'beta', capacity: 80 },
    ]);
    const notices = await page.evaluate(async () => {
      const { store } = await import('/js/application/store.js');
      return store.getState().notifications;
    });
    expect(notices.some((entry) => entry.message.includes('beta') && entry.message.includes('100%'))).toBe(true);
  });

  test('pointer shrinking above 100 percent keeps the task and restores its original size', async ({ page }, testInfo) => {
    await mountEditor(page, { capacity: [{ team: 'alpha', capacity: 100 }] });
    await enableManDays(page);
    await page.locator('details-panel .details-close').click();
    const card = page.locator('feature-card-lit');
    const handle = await card.locator('[data-resize-policy="keep-effort"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 170, handle.y, { steps: 8 });
    await page.mouse.up();
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS('width', '200px');
    expect(await overrides(page)).toEqual({});
    const result = await page.evaluate(async () => {
      const { store } = await import('/js/application/store.js');
      const { sel } = await import('/js/application/imports.js');
      return { feature: sel.feature.getEffectiveFeatureById('task'),
        notices: store.getState().notifications.filter((entry) => entry.code === 'allocation-resize-limit') };
    });
    expect(result.feature).toMatchObject({ start: '2026-10-05', end: '2026-10-16',
      capacity: [{ team: 'alpha', capacity: 100 }] });
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0].message).toContain('100%');
    await page.screenshot({ path: testInfo.outputPath('man-days-blocked-resize-desktop.png') });
  });

  for (const unit of ['percent', 'man-days']) {
    test(`${unit} wheel bursts paint each step before committing the final allocation once`, async ({ page }) => {
      await mountEditor(page);
      if (unit === 'man-days') await enableManDays(page);
      const feedback = await page.evaluate(async () => {
        const { store } = await import('/js/application/store.js');
        const panel = document.querySelector('details-panel');
        const input = panel.shadowRoot.querySelector('.capacity-bar-input');
        window.wheelAllocationCommits = 0;
        store.subscribe((state, previous) => {
          if (state.scenarios.items !== previous.scenarios.items) window.wheelAllocationCommits++;
        });
        const values = [];
        for (let step = 0; step < 3; step++) {
          input.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          values.push(input.value);
        }
        return { values, commitsBeforePaint: window.wheelAllocationCommits };
      });
      expect(feedback.values).toEqual(unit === 'percent' ? ['30', '40', '50'] : ['11', '12', '13']);
      expect(feedback.commitsBeforePaint).toBe(0);
      await expect.poll(async () => {
        const current = await overrides(page);
        return Object.hasOwn(current, 'task') ? current.task.capacity : [];
      }).toEqual([{ team: 'alpha', capacity: unit === 'percent' ? 50 : 26 }]);
      await expect(page.locator('details-panel .capacity-bar-label')).toHaveText(unit === 'percent' ? '50%' : '26%');
      await page.locator('details-panel .capacity-bar-input').focus();
      await page.locator('details-panel .capacity-bar-input').press('Tab');
      expect(await page.evaluate(() => window.wheelAllocationCommits)).toBe(1);
    });
  }

  test('previous percent submissions do not suppress man-day edits after switching units', async ({ page }) => {
    await mountEditor(page);
    const input = page.locator('details-panel .capacity-bar-input');
    await input.fill('30');
    await input.press('Enter');
    await input.press('Tab');
    await enableManDays(page);
    await expect(input).toHaveValue('15');
    await input.fill('30');
    await input.press('Enter');
    await input.press('Tab');
    await expect(page.locator('details-panel .capacity-bar-label')).toHaveText('60%');
    expect((await overrides(page)).task.capacity).toEqual([{ team: 'alpha', capacity: 60 }]);
  });

  test('failed metadata blocks scheduling without deletion and retry restores editing', async ({ page }) => {
    await page.route('**/api/cost/teams', (route) => route.fulfill({ status: 503, json: { detail: 'Offline' } }));
    await mountEditor(page);
    await enableManDays(page);
    await expect(page.locator('details-panel .capacity-bar-input')).toBeDisabled();
    await page.getByRole('combobox', { name: 'Schedule preset' }).selectOption('longer');
    await expect(page.getByRole('combobox', { name: 'Schedule preset' })).toHaveValue('');
    const end = page.locator('details-panel input[type="date"]').nth(1);
    await end.fill('2026-10-30');
    await end.press('Tab');
    await expect(end).toHaveValue('2026-10-16');
    expect(await overrides(page)).toEqual({});
    await page.route('**/api/cost/teams', (route) => route.fulfill({ json: { teams: {}, groups: {} } }));
    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      await cmd.data.refreshAllocationStaffing();
    });
    await page.locator('details-panel .clear-dates-btn').click();
    expect((await overrides(page)).task).toMatchObject({ start: null, end: null, capacity: [] });
  });

  test('protected unknown duplicates abort the complete scheduling operation', async ({ page }) => {
    await mountEditor(page, { capacity: [
      { team: 'unknown', capacity: 20 }, { team: 'unknown', capacity: 30 },
    ] });
    await enableManDays(page);
    await page.getByRole('combobox', { name: 'Schedule preset' }).selectOption('longer');
    expect(await overrides(page)).toEqual({});
    await expect(page.locator('details-panel .capacity-bar-row')).toHaveCount(2);
    await page.locator('details-panel .details-close').click();
    const card = page.locator('feature-card-lit');
    const handle = await card.locator('[data-resize-policy="keep-effort"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 100, handle.y, { steps: 8 });
    await page.mouse.up();
    await expect(card).toHaveCSS('width', '200px');
    expect(await overrides(page)).toEqual({});
  });

  test('date edits and pointer shrinking explain the child boundary and restore blocked values', async ({ page }) => {
    await mountEditor(page, { childEnd: '2026-10-15' });
    await enableManDays(page);
    const end = page.locator('details-panel input[type="date"]').nth(1);
    await end.fill('2026-10-09');
    await end.press('Tab');
    await expect(end).toHaveValue('2026-10-15');
    expect((await overrides(page)).task.capacity[0].capacity).toBeCloseTo(200 / 9, 12);
    await end.fill('2026-10-09');
    await end.press('Tab');
    await expect(end).toHaveValue('2026-10-15');
    await page.locator('details-panel .details-close').click();
    const card = page.locator('feature-card-lit');
    const handle = await card.locator('[data-resize-policy="keep-effort"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(0, handle.y, { steps: 8 });
    await page.mouse.up();
    const notices = await page.evaluate(async () => {
      const { store } = await import('/js/application/store.js');
      return store.getState().notifications.filter(entry => entry.code === 'schedule-child-boundary');
    });
    expect(notices).toHaveLength(1);
    expect(notices[0].count).toBe(3);
    expect(notices.every(entry => entry.message.includes('child (2026-10-15)'))).toBe(true);
    expect((await overrides(page)).task.end).toBe('2026-10-15');
  });

  test('pointer resizing preserves precise effort while graphs use fractional percent load', async ({ page }) => {
    await mountEditor(page);
    await enableManDays(page);
    await page.locator('details-panel .details-close').click();
    const card = page.locator('feature-card-lit');
    const handle = await card.locator('[data-resize-policy="keep-effort"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 100, handle.y, { steps: 8 });
    await page.mouse.up();
    const result = (await overrides(page)).task;
    expect(result.capacity[0].capacity).toBeLessThan(20);
    const calculation = await page.evaluate(async () => {
      const { store } = await import('/js/application/store.js');
      const { cmd, sel } = await import('/js/application/imports.js');
      const { countWorkingDays } = await import('/js/application/shared/allocationUnits.js');
      const feature = sel.feature.getEffectiveFeatureById('task');
      cmd.feature.setSelectedFeature(feature);
      return { days: countWorkingDays(feature),
        graphLoads: store.getState().capacity.teamDailyMap.map((row) => row.alpha) };
    });
    const percentage = result.capacity[0].capacity;
    const actual = percentage / 100 * 5 * calculation.days;
    expect(actual).toBeCloseTo(10, 12);
    expect(calculation.graphLoads.every((value) => Math.abs(value - percentage) < 1e-10)).toBe(true);
    await expect(page.locator('details-panel .capacity-bar-label')).toHaveText(`${Math.ceil(percentage)}%`);
  });
});