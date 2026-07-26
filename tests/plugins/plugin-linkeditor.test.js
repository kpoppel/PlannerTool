import { expect } from '@open-wc/testing';
import sinon from 'sinon';
import PluginLinkEditor from '../../www/js/plugins/PluginLinkEditor.js';

describe('PluginLinkEditor lifecycle', () => {
  it('inits, activates, deactivates and destroys', async () => {
    const plugin = new PluginLinkEditor('link-editor', {});

    // MountedPlugin.init only calls _ensureComponent (which is no-op when componentPath is empty)
    // and _resolveHost. It does not need any mock element.
    await plugin.init();
    expect(plugin.initialized).to.be.true;

    // Provide the app host so MountedPlugin can resolve _host without failing in JSDOM
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    plugin._host = app;

    // Mock component loaded and element creation to avoid Lit/JSDOM issues
    plugin._componentLoaded = true;

    await plugin.activate();
    expect(plugin.active).to.be.true;

    await plugin.deactivate();
    expect(plugin.active).to.be.false;

    await plugin.destroy();
    expect(plugin._el).to.equal(null);
  });
});
