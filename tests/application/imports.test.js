import { describe, it, expect, afterEach, vi } from 'vitest';

describe('application/imports', () => {
  afterEach(() => {
    delete window.__featureFlags;
  });

  it('does not access legacy task filter service in store-mode selectors', async () => {
    const { createFilterSelectors } = await import('../../www/js/application/selectors/filterSelectors.js');
    const seen = [];
    const legacyState = new Proxy({}, {
      get(target, prop) {
        seen.push(prop);
        if (prop === 'taskFilterService') {
          throw new Error('legacy taskFilterService should not be touched in store mode');
        }
        return undefined;
      },
    });

    const store = {
      getState: () => ({
        selection: {
          taskFilters: {
            schedule: { planned: true },
            allocation: null,
            hierarchy: null,
            relations: null,
          },
        },
      }),
    };

    const selectors = createFilterSelectors(store, legacyState);
    expect(selectors.getTaskFilters()).toEqual({
      schedule: { planned: true, unplanned: true },
      allocation: { allocated: true, unallocated: true },
      hierarchy: { hasParent: true, noParent: true },
      relations: { hasLinks: true, noLinks: true },
    });
    expect(seen).not.toContain('taskFilterService');
  });

  it('exports store-backed commands and selectors unconditionally', async () => {
    vi.resetModules();
    const mod = await import('../../www/js/application/imports.js?phase1_off=1');
    expect(mod.isStateStoreEnabled).toBe(true);
    expect(typeof mod.cmd.ui.setDebugFlag).toBe('function');
    expect(typeof mod.cmd.data.hydrateBaseline).toBe('function');
    expect(typeof mod.cmd.data.hydrateScenarioData).toBe('function');
    expect(typeof mod.cmd.selection.setProjectsSelectedBulk).toBe('function');
    expect(typeof mod.cmd.selection.setTeamsSelectedBulk).toBe('function');
    expect(typeof mod.cmd.filter.toggleStateSelected).toBe('function');
    expect(typeof mod.cmd.view.setContext).toBe('function');
    expect(typeof mod.sel.ui.debugFlag).toBe('function');
    expect(typeof mod.sel.selection.getSelectedProjectIds).toBe('function');
    expect(typeof mod.sel.filter.getAvailableFeatureStates).toBe('function');
  });

  it('ignores runtime USE_STATE_STORE overrides', async () => {
    vi.resetModules();
    window.__featureFlags = { USE_STATE_STORE: false };
    const mod = await import('../../www/js/application/imports.js?phase1_on=1');

    expect(mod.isStateStoreEnabled).toBe(true);
    expect(typeof mod.cmd.ui.setDebugFlag).toBe('function');
    expect(typeof mod.cmd.data.hydrateBaseline).toBe('function');
    expect(typeof mod.cmd.data.hydrateScenarioData).toBe('function');
    expect(typeof mod.cmd.selection.setProjectsSelectedBulk).toBe('function');
    expect(typeof mod.cmd.selection.setTeamsSelectedBulk).toBe('function');
    expect(typeof mod.cmd.filter.toggleStateSelected).toBe('function');
    expect(typeof mod.cmd.view.setContext).toBe('function');
    expect(typeof mod.sel.ui.debugFlag).toBe('function');
    expect(typeof mod.sel.selection.getSelectedProjectIds).toBe('function');
    expect(typeof mod.sel.filter.getAvailableFeatureStates).toBe('function');
  });

  it('keeps full scenario overrides when server metadata updates arrive', async () => {
    vi.resetModules();

    const mod = await import('../../www/js/application/imports.js?scenario_sync_merge=1');
    const { bus } = await import('../../www/js/core/EventBus.js');
    const { DataEvents } = await import('../../www/js/core/EventRegistry.js');

    const firstOverrides = {
      feat_1: { start: '2026-07-01', end: '2026-07-10' },
    };

    await mod.cmd.data.hydrateScenarioData({
      preloadedItems: [{ id: 's1', name: 'Scenario One', overrides: firstOverrides }],
      activeId: 's1',
    });

    bus.emit(DataEvents.SCENARIOS_CHANGED, [{ id: 's1', name: 'Scenario One (meta)' }]);
    let active = mod.sel.scenario.getActiveScenario();
    expect(active.name).toBe('Scenario One (meta)');
    expect(active.overrides).toEqual(firstOverrides);

    const fullOverrides = {
      feat_1: { start: '2026-07-05', end: '2026-07-12' },
      feat_2: { start: '2026-08-01', end: '2026-08-08' },
    };
    bus.emit(DataEvents.SCENARIOS_DATA, [{ id: 's1', name: 'Scenario One (full)', overrides: fullOverrides }]);

    active = mod.sel.scenario.getActiveScenario();
    expect(active.name).toBe('Scenario One (full)');
    expect(active.overrides).toEqual(fullOverrides);
  });

  it('keeps the dirty set untouched during server scenario sync', async () => {
    vi.resetModules();

    const mod = await import('../../www/js/application/imports.js?scenario_sync_dirty_noop=1');
    const { bus } = await import('../../www/js/core/EventBus.js');
    const { DataEvents } = await import('../../www/js/core/EventRegistry.js');
    const { store } = await import('../../www/js/application/store.js');

    store.setState(
      {
        ...store.getState(),
        scenarios: {
          ...store.getState().scenarios,
          activeId: 'baseline',
          changedIds: ['scen_123', 'scen_456'],
          items: [
            { id: 'baseline', name: 'Baseline', readonly: true },
            { id: 'scen_123', name: 'Local draft', overrides: {}, filters: {}, view: {} },
            { id: 'scen_456', name: 'Server-known', overrides: {}, filters: {}, view: {} },
          ],
        },
      },
      true,
      'test.keepDirtyIds'
    );

    bus.emit(DataEvents.SCENARIOS_DATA, [{ id: 'scen_456', name: 'Server-known' }]);

    expect(mod.sel.scenario.getChangedScenarioIds()).toEqual(['scen_123', 'scen_456']);
  });

  it('syncs loaded group cache into the canonical store slice', async () => {
    vi.resetModules();

    const mod = await import('../../www/js/application/imports.js?group_store_sync=1');
    const { bus } = await import('../../www/js/core/EventBus.js');
    const { GroupEvents } = await import('../../www/js/core/EventRegistry.js');
    const { store } = await import('../../www/js/application/store.js');
    const { groupService } = await import('../../www/js/services/GroupService.js');

    groupService._groupsByPlan.clear();
    groupService._groupsByPlan.set('p1', [{ id: 'g1', plan_id: 'p1', name: 'Core', members: ['f1'] }]);

    bus.emit(GroupEvents.LOADED);

    expect(store.getState().groups.byPlanId).toEqual({
      p1: [{ id: 'g1', plan_id: 'p1', name: 'Core', members: ['f1'] }],
    });
    expect(mod.sel.group.getEffectiveGroups('p1')).toEqual([
      expect.objectContaining({ id: 'g1', plan_id: 'p1' }),
    ]);
  });

  it('preserves existing plan entries when only a subset of groups loads', async () => {
    vi.resetModules();

    const mod = await import('../../www/js/application/imports.js?group_store_sync_partial=1');
    const { bus } = await import('../../www/js/core/EventBus.js');
    const { GroupEvents } = await import('../../www/js/core/EventRegistry.js');
    const { store } = await import('../../www/js/application/store.js');
    const { groupService } = await import('../../www/js/services/GroupService.js');

    store.setState({
      ...store.getState(),
      groups: {
        ...store.getState().groups,
        byPlanId: {
          p1: [{ id: 'g1', plan_id: 'p1', name: 'Core', members: ['f1'] }],
          p2: [],
        },
      },
    }, true, 'test.seed.partialGroups');

    groupService._groupsByPlan.clear();
    groupService._groupsByPlan.set('p1', [{ id: 'g1', plan_id: 'p1', name: 'Core', members: ['f1'] }]);

    bus.emit(GroupEvents.LOADED);

    expect(store.getState().groups.byPlanId.p2).toEqual([]);
    expect(mod.sel.group.getEffectiveGroups('p2')).toEqual([]);
  });

});
