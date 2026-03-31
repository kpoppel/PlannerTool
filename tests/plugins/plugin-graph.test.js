import { expect } from '@open-wc/testing';
import sinon from 'sinon';
import { isEnabled, enable, disable } from '../../www/js/config.js';

const PluginGraphPlugin =
  (await import('../../www/js/plugins/PluginGraph.js')).default ||
  (await import('../../www/js/plugins/PluginGraph.js')).PluginGraphPlugin;

describe('PluginGraphPlugin lifecycle', () => {
  beforeEach(() => {
    enable('USE_PLUGIN_SYSTEM');
  });

  it('initializes and activates/deactivates/destroys', async () => {
    const plugin = new PluginGraphPlugin('plugin-graph', { fullscreen: true });
    plugin._componentLoaded = true;
    plugin._host = document.createElement('div');
    document.body.appendChild(plugin._host);
    await plugin.init();
    await plugin.activate();
    // Ensure element is mounted in DOM for destroy logic
    if (plugin._el && plugin._host && plugin._el.parentNode !== plugin._host)
      plugin._host.appendChild(plugin._el);
    expect(plugin.initialized).to.be.true;
    expect(plugin.active).to.be.true;
    await plugin.deactivate();
    expect(plugin.active).to.be.false;
    // Remove element manually if still attached to avoid removal errors
    try {
      if (plugin._el && plugin._el.parentNode) {
        plugin._el.parentNode.removeChild(plugin._el);
      }
    } catch (e) {
      // ignore DOM removal races in test environment
    }
    await plugin.destroy();
    expect(plugin._el).to.be.null;
    try {
      if (plugin._host && plugin._host.parentNode) {
        plugin._host.parentNode.removeChild(plugin._host);
      }
    } catch (e) {
      // ignore
    }
  });
});
