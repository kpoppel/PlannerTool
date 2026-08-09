import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockCmd = vi.hoisted(() => ({
  view: {
    setShowDependencies: vi.fn(),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: {},
}));

import PluginDependencies from '../../www/js/plugins/PluginDependencies.js';

describe('PluginDependencies Phase 4 seam wrapper', () => {
  let host;

  beforeEach(() => {
    mockCmd.view.setShowDependencies.mockReset();
    host = document.createElement('div');
    host.id = '_body';
    document.body.appendChild(host);
  });

  afterEach(() => {
    host?.remove();
  });

  it('activate routes dependency visibility through cmd.view with suppressEvents', async () => {
    const plugin = new PluginDependencies('plugin-dependencies');
    plugin._ensureComponent = async () => {};

    await plugin.activate();

    expect(mockCmd.view.setShowDependencies).toHaveBeenCalledWith(true, {
      suppressEvents: true,
    });
  });

  it('deactivate routes dependency visibility through cmd.view with suppressEvents', async () => {
    const plugin = new PluginDependencies('plugin-dependencies');
    plugin._ensureComponent = async () => {};

    await plugin.activate();
    await plugin.deactivate();

    expect(mockCmd.view.setShowDependencies).toHaveBeenLastCalledWith(false, {
      suppressEvents: true,
    });
  });
});
