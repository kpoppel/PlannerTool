import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import PluginExportTimeline from '../../www/js/plugins/PluginExportTimeline.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';

describe('PluginExportTimeline', () => {
  let emitStub;

  beforeEach(() => {
    emitStub = stub(bus, 'emit');
  });

  afterEach(() => {
    emitStub.restore();
  });

  it('activate mounts element to the app root, opens it, and destroys cleanly', async () => {
    const appRoot = document.createElement('div');
    appRoot.className = 'app-container';
    document.body.appendChild(appRoot);

    const plugin = new PluginExportTimeline('export-test');
    plugin._componentLoaded = true;

    await plugin.activate();

    expect(plugin.active).to.be.true;
    expect(plugin._el).to.exist;
    expect(plugin._el.parentNode).to.exist;
    expect(emitStub.calledOnce).to.be.true;
    expect(emitStub.firstCall.args[0]).to.equal(PluginEvents.ACTIVATED);

    plugin._el.open = stub();
    plugin._el.close = stub();

    await plugin.deactivate();
    expect(plugin.active).to.be.false;
    expect(emitStub.calledTwice).to.be.true;
    expect(emitStub.secondCall.args[0]).to.equal(PluginEvents.DEACTIVATED);

    await plugin.destroy();
    expect(plugin._el).to.equal(null);

    appRoot.remove();
  });
});