import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import PluginDependencies from '../../www/js/plugins/PluginDependencies.js';

function stubMountedElement(plugin) {
  plugin._ensureComponent = async () => {};
  plugin._ensureElement = async () => {
    plugin._resolveHost();
    plugin._el = document.createElement('div');
    plugin._el.open = vi.fn();
    plugin._el.close = vi.fn();
    plugin._el.style.display = 'none';
    plugin._host.appendChild(plugin._el);
  };
}

describe('PluginDependencies Phase 4 seam wrapper', () => {
  let host;

  beforeEach(() => {
    host = document.createElement('div');
    host.id = '_body';
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (host) host.remove();
    host = null;
  });

  it('activate opens the overlay without reading application Context state', async () => {
    const plugin = new PluginDependencies('plugin-dependencies');
    stubMountedElement(plugin);

    await plugin.activate();

    expect(plugin._el.open).toHaveBeenCalledTimes(1);
  });

  it('deactivate closes the overlay without changing calculation or view options', async () => {
    const plugin = new PluginDependencies('plugin-dependencies');
    stubMountedElement(plugin);

    await plugin.activate();
    await plugin.deactivate();

    expect(plugin._el.close).toHaveBeenCalled();
  });
});
