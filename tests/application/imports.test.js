import { describe, it, expect, afterEach, vi } from 'vitest';

describe('application/imports', () => {
  afterEach(() => {
    delete window.__featureFlags;
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
