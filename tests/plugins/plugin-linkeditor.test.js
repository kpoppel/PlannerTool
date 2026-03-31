import { expect } from '@open-wc/testing';
import sinon from 'sinon';
import PluginLinkEditor from '../../www/js/plugins/PluginLinkEditor.js';

describe('PluginLinkEditor lifecycle', () => {
  it('inits, activates, deactivates and destroys', async () => {
    const plugin = new PluginLinkEditor('link-editor', {});
    await plugin.init();
    expect(plugin.initialized).to.be.true;

    // Ensure component exists and attach to body so destroy can remove it
    if (!plugin._component)
      plugin._component = document.createElement('plugin-link-editor');
    document.body.appendChild(plugin._component);

    await plugin.activate();
    expect(plugin.active).to.be.true;

    await plugin.deactivate();
    expect(plugin.active).to.be.false;

    // manual cleanup in case plugin didn't remove
    if (plugin._component && plugin._component.parentNode)
      plugin._component.parentNode.removeChild(plugin._component);
    await plugin.destroy();
    expect(plugin._component).to.be.null;
  });
});
