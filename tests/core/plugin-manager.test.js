import { expect, vi, beforeEach, afterEach, describe, it } from 'vitest';
import { Plugin } from '../../www/js/core/Plugin.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginManager } from '../../www/js/core/PluginManager.js';

class TestPlugin extends Plugin {
  constructor(id, config = {}) {
    super(id, config);
    this.initCalled = false;
    this.activateCalled = false;
    this.deactivateCalled = false;
    this.destroyCalled = false;
  }

  async init() {
    this.initCalled = true;
  }

  async activate() {
    this.activateCalled = true;
  }

  async deactivate() {
    this.deactivateCalled = true;
  }

  async destroy() {
    this.destroyCalled = true;
  }
}

describe('PluginManager & Plugin base', () => {
  let manager;

  beforeEach(() => {
    manager = new PluginManager();
    if (bus && bus.listeners && typeof bus.listeners.clear === 'function')
      bus.listeners.clear();
  });

  it('should throw error if init not implemented', async () => {
    const plugin = new Plugin('test');
    try {
      await plugin.init();
      expect.fail('Should have thrown error');
    } catch (error) {
      expect(error.message).to.include('must implement init');
    }
  });

  it('should register a plugin', async () => {
    const plugin = new TestPlugin('test-plugin');

    await manager.register(plugin);

    expect(manager.has('test-plugin')).to.be.true;
    expect(plugin.initialized).to.be.true;
    expect(plugin.initCalled).to.be.true;
  });

  it('should emit plugin:registered event', async () => {
    const plugin = new TestPlugin('test-plugin');

    const { PluginEvents } = await import('../../www/js/core/EventRegistry.js');
    const ev = new Promise((resolve) => bus.once(PluginEvents.REGISTERED, resolve));

    await manager.register(plugin);

    const data = await ev;
    expect(data.plugin).to.equal('test-plugin');
  });

  it('should prevent duplicate registration', async () => {
    const plugin1 = new TestPlugin('test-plugin');
    const plugin2 = new TestPlugin('test-plugin');

    await manager.register(plugin1);

    try {
      await manager.register(plugin2);
      expect.fail('Should have thrown error');
    } catch (error) {
      expect(error.message).to.include('already registered');
    }
  });

  it('should activate and deactivate plugin with events', async () => {
    const plugin = new TestPlugin('test-plugin');
    await manager.register(plugin);

    await manager.activate('test-plugin');
    expect(plugin.active).to.be.true;
    expect(plugin.activateCalled).to.be.true;

    await manager.deactivate('test-plugin');
    expect(plugin.active).to.be.false;
    expect(plugin.deactivateCalled).to.be.true;
  });

  it('should unregister a plugin', async () => {
    const plugin = new TestPlugin('test-plugin');
    await manager.register(plugin);

    await manager.unregister('test-plugin');

    expect(manager.has('test-plugin')).to.be.false;
    expect(plugin.destroyCalled).to.be.true;
  });

  it('should check dependencies on registration', async () => {
    const plugin = new TestPlugin('test-plugin', {
      dependencies: ['missing-plugin'],
    });

    try {
      await manager.register(plugin);
      expect.fail('Should have thrown error');
    } catch (error) {
      expect(error.message).to.include('missing dependencies');
      expect(error.message).to.include('missing-plugin');
    }
  });

  it('Plugin base should throw for unimplemented lifecycle methods', async () => {
    const Base = new Plugin('base');
    // init already tested earlier; ensure other lifecycle methods throw when not overridden
    try {
      await Base.activate();
      expect.fail('activate should throw');
    } catch (e) {
      expect(e.message).to.include('must implement activate');
    }
    try {
      await Base.deactivate();
      expect.fail('deactivate should throw');
    } catch (e) {
      expect(e.message).to.include('must implement deactivate');
    }
    try {
      await Base.destroy();
      expect.fail('destroy should throw');
    } catch (e) {
      expect(e.message).to.include('must implement destroy');
    }
  });

  it('should return plugin via get(), isActive() and list()', async () => {
    const plugin = new TestPlugin('list-plugin', { name: 'List' });
    await manager.register(plugin);

    expect(manager.get('list-plugin')).to.equal(plugin);
    expect(manager.isActive('list-plugin')).to.be.false;

    await manager.activate('list-plugin');
    expect(manager.isActive('list-plugin')).to.be.true;

    const listing = manager.list();
    expect(listing.find((p) => p.id === 'list-plugin')).to.exist;
  });

  it('should prevent unregister when dependents exist', async () => {
    const p1 = new TestPlugin('p1');
    const p2 = new TestPlugin('p2', { dependencies: ['p1'] });

    await manager.register(p1);
    await manager.register(p2);

    try {
      await manager.unregister('p1');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).to.include('required by');
      expect(err.message).to.include('p2');
    }
  });

  it('topological sort should order modules by dependencies', () => {
    const m1 = { id: 'a' };
    const m2 = { id: 'b', dependencies: ['a'] };
    const m3 = { id: 'c', dependencies: ['b'] };

    const sorted = manager._topologicalSort([m3, m1, m2]);
    expect(sorted.map((m) => m.id)).to.deep.equal(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// loadFromConfig — isolated tests using a stub registry injected via vi.mock
// ---------------------------------------------------------------------------

vi.mock('../../www/js/core/pluginRegistry.js', () => {
  // Minimal stub that satisfies PluginManager lifecycle without importing Plugin
  // (vi.mock factories are hoisted before imports, so Plugin is not yet in scope).
  class StubPlugin {
    constructor(id, config = {}) {
      this.id = id;
      this.config = config;
      this.initialized = false;
      this.active = false;
    }
    getMetadata() { return { id: this.id, dependencies: this.config.dependencies || [] }; }
    async init() {}
    async activate() { this.active = true; }
    async deactivate() { this.active = false; }
    async destroy() {}
  }
  return {
    default: {
      'plugin-a': StubPlugin,
      'plugin-b': StubPlugin,
      'plugin-c': StubPlugin,
    },
  };
});

describe('PluginManager.loadFromConfig', () => {
  let manager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeConfig(modules) {
    return { modules };
  }

  it('registers enabled plugins and skips disabled ones', async () => {
    await manager.loadFromConfig(makeConfig([
      { id: 'plugin-a', enabled: true, activated: false, dependencies: [] },
      { id: 'plugin-b', enabled: false, activated: false, dependencies: [] },
    ]));

    expect(manager.has('plugin-a')).to.equal(true);
    expect(manager.has('plugin-b')).to.equal(false);
  });

  it('disabled plugins are not listed', async () => {
    await manager.loadFromConfig(makeConfig([
      { id: 'plugin-a', enabled: true, activated: false, dependencies: [] },
      { id: 'plugin-b', enabled: false, activated: false, dependencies: [] },
    ]));

    const ids = manager.list().map((p) => p.id);
    expect(ids).to.include('plugin-a');
    expect(ids).not.to.include('plugin-b');
  });

  it('auto-activates exactly the first plugin with activated:true', async () => {
    await manager.loadFromConfig(makeConfig([
      { id: 'plugin-a', enabled: true, activated: true, dependencies: [] },
      { id: 'plugin-b', enabled: true, activated: true, dependencies: [] },
    ]));

    expect(manager.isActive('plugin-a')).to.equal(true);
    // second activated:true is ignored — only first one activates
    expect(manager.isActive('plugin-b')).to.equal(false);
  });

  it('does not activate any plugin when none has activated:true', async () => {
    await manager.loadFromConfig(makeConfig([
      { id: 'plugin-a', enabled: true, activated: false, dependencies: [] },
      { id: 'plugin-b', enabled: true, activated: false, dependencies: [] },
    ]));

    expect(manager.isActive('plugin-a')).to.equal(false);
    expect(manager.isActive('plugin-b')).to.equal(false);
  });

  it('preserves admin-defined order when no dependency reordering is needed', async () => {
    await manager.loadFromConfig(makeConfig([
      { id: 'plugin-b', enabled: true, activated: false, dependencies: [] },
      { id: 'plugin-a', enabled: true, activated: false, dependencies: [] },
    ]));

    // list() uses the plugins Map which preserves insertion (registration) order
    const ids = manager.list().map((p) => p.id);
    expect(ids[0]).to.equal('plugin-b');
    expect(ids[1]).to.equal('plugin-a');
  });

  it('reorders for dependency safety and logs a warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // plugin-b depends on plugin-a, but admin put b before a
    await manager.loadFromConfig(makeConfig([
      { id: 'plugin-b', enabled: true, activated: false, dependencies: ['plugin-a'] },
      { id: 'plugin-a', enabled: true, activated: false, dependencies: [] },
    ]));

    // plugin-a must be registered first due to dependency
    expect(manager.loadOrder[0]).to.equal('plugin-a');
    expect(manager.loadOrder[1]).to.equal('plugin-b');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('adjusted for dependency safety'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );

    warnSpy.mockRestore();
  });
});
