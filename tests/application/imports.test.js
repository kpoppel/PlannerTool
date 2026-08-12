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

  it('keeps USE_STATE_STORE enabled by default', async () => {
    vi.resetModules();
    const mod = await import('../../www/js/application/imports.js?phase1_off=1');
    expect(mod.isStateStoreEnabled).toBe(true);
    expect(typeof mod.cmd.ui.setDebugFlag).toBe('function');
    expect(typeof mod.cmd.data.hydrateBaseline).toBe('function');
    expect(typeof mod.cmd.data.hydrateScenarioData).toBe('function');
    expect(typeof mod.cmd.selection.setProjectsSelectedBulk).toBe('function');
    expect(typeof mod.cmd.selection.setTeamsSelectedBulk).toBe('function');
    expect(typeof mod.cmd.filter.toggleStateSelected).toBe('function');
    expect(typeof mod.cmd.view.setExpansionState).toBe('function');
    expect(typeof mod.cmd.view.setShowDependencies).toBe('function');
    expect(typeof mod.sel.ui.debugFlag).toBe('function');
    expect(typeof mod.sel.selection.getSelectedProjectIds).toBe('function');
    expect(typeof mod.sel.filter.getAvailableFeatureStates).toBe('function');
  });

  it('turns on the state-store branch when runtime override is true', async () => {
    vi.resetModules();
    window.__featureFlags = { USE_STATE_STORE: true };
    const mod = await import('../../www/js/application/imports.js?phase1_on=1');

    expect(mod.isStateStoreEnabled).toBe(true);
    expect(typeof mod.cmd.ui.setDebugFlag).toBe('function');
    expect(typeof mod.cmd.data.hydrateBaseline).toBe('function');
    expect(typeof mod.cmd.data.hydrateScenarioData).toBe('function');
    expect(typeof mod.cmd.selection.setProjectsSelectedBulk).toBe('function');
    expect(typeof mod.cmd.selection.setTeamsSelectedBulk).toBe('function');
    expect(typeof mod.cmd.filter.toggleStateSelected).toBe('function');
    expect(typeof mod.cmd.view.setExpansionState).toBe('function');
    expect(typeof mod.cmd.view.setShowDependencies).toBe('function');
    expect(typeof mod.sel.ui.debugFlag).toBe('function');
    expect(typeof mod.sel.selection.getSelectedProjectIds).toBe('function');
    expect(typeof mod.sel.filter.getAvailableFeatureStates).toBe('function');
  });
});
