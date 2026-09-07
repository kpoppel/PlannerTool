import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { bus } from '../../www/js/core/EventBus.js';
import { PluginManager } from '../../www/js/core/PluginManager.js';

function createPlugin(id, config) {
  return {
    id,
    config,
    initialized: false,
    active: false,
    calls: {
      init: 0,
      activate: 0,
      deactivate: 0,
    },
    async init() {
      this.initialized = true;
      this.calls.init += 1;
    },
    async activate() {
      this.active = true;
      this.calls.activate += 1;
    },
    async deactivate() {
      this.active = false;
      this.calls.deactivate += 1;
    },
    async destroy() {
      this.active = false;
    },
    getMetadata() {
      return {
        id: this.id,
        dependencies: config.dependencies,
      };
    },
  };
}

describe('PluginManager persistent plugin activation', () => {
  let emitSpy;

  beforeEach(() => {
    emitSpy = vi.spyOn(bus, 'emit').mockImplementation(() => {});
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  it('keeps an active persistent plugin open when activating an exclusive plugin', async () => {
    const manager = new PluginManager();
    const dependencies = createPlugin('plugin-dependencies', {
      dependencies: [],
      exclusive: false,
      persistent: true,
    });
    const fullscreen = createPlugin('plugin-graph', {
      dependencies: [],
      exclusive: true,
      fullscreen: true,
    });

    await manager.register(dependencies);
    await manager.register(fullscreen);

    await manager.activate('plugin-dependencies');
    await manager.activate('plugin-graph');

    expect(manager.isActive('plugin-dependencies')).to.equal(true);
    expect(manager.isActive('plugin-graph')).to.equal(true);
    expect(dependencies.calls.deactivate).to.equal(0);
  });

  it('does not close an active exclusive plugin when activating a persistent plugin', async () => {
    const manager = new PluginManager();
    const fullscreen = createPlugin('plugin-graph', {
      dependencies: [],
      exclusive: true,
      fullscreen: true,
    });
    const dependencies = createPlugin('plugin-dependencies', {
      dependencies: [],
      exclusive: false,
      persistent: true,
    });

    await manager.register(fullscreen);
    await manager.register(dependencies);

    await manager.activate('plugin-graph');
    await manager.activate('plugin-dependencies');

    expect(manager.isActive('plugin-graph')).to.equal(true);
    expect(manager.isActive('plugin-dependencies')).to.equal(true);
    expect(fullscreen.calls.deactivate).to.equal(0);
  });

  it('continues to close non-persistent shareable plugins for exclusive targets', async () => {
    const manager = new PluginManager();
    const events = createPlugin('plugin-events', {
      dependencies: [],
      exclusive: false,
    });
    const fullscreen = createPlugin('plugin-graph', {
      dependencies: [],
      exclusive: true,
      fullscreen: true,
    });

    await manager.register(events);
    await manager.register(fullscreen);

    await manager.activate('plugin-events');
    await manager.activate('plugin-graph');

    expect(manager.isActive('plugin-events')).to.equal(false);
    expect(manager.isActive('plugin-graph')).to.equal(true);
    expect(events.calls.deactivate).to.equal(1);
  });
});