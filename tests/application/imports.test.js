import { describe, it, expect, afterEach, vi } from 'vitest';

describe('application/imports', () => {
  afterEach(() => {
    delete window.__featureFlags;
  });

  it('keeps USE_STATE_STORE disabled by default', async () => {
    vi.resetModules();
    const mod = await import('../../www/js/application/imports.js?phase1_off=1');
    expect(mod.isStateStoreEnabled).toBe(false);
    expect(typeof mod.cmd.ui.setDebugFlag).toBe('function');
    expect(typeof mod.sel.ui.debugFlag).toBe('function');
  });

  it('turns on the state-store branch when runtime override is true', async () => {
    vi.resetModules();
    window.__featureFlags = { USE_STATE_STORE: true };
    const mod = await import('../../www/js/application/imports.js?phase1_on=1');

    expect(mod.isStateStoreEnabled).toBe(true);
    expect(typeof mod.cmd.ui.setDebugFlag).toBe('function');
    expect(typeof mod.sel.ui.debugFlag).toBe('function');
  });
});
