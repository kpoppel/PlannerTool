import { expect } from '@open-wc/testing';
import { default as PluginHistory } from '../../www/js/plugins/PluginHistory.js';
import { enable } from '../../www/js/config.js';

describe('PluginHistory lifecycle', () => {
  beforeEach(() => {
    enable('USE_PLUGIN_SYSTEM');
  });

  it('activates, deactivates and destroys correctly', async () => {
    const plugin = new PluginHistory('plugin-history', {});
    // mark component loaded to avoid dynamic import in test
    plugin._componentLoaded = true;

    await plugin.init();
    await plugin.activate();
    // Ensure element is present
    expect(plugin._el).to.exist;
    expect(plugin.active).to.be.true;

    await plugin.deactivate();
    expect(plugin.active).to.be.false;

    // Ensure DOM removal path works
    if (plugin._el && plugin._el.parentNode)
      plugin._el.parentNode.removeChild(plugin._el);
    await plugin.destroy();
    expect(plugin._el).to.be.null;
  });
});
