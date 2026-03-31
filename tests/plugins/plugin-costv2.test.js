import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import PluginCostV2 from '../../www/js/plugins/PluginCostV2.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';
import { disable, enable } from '../../www/js/config.js';

describe('PluginCostV2', () => {
  let emitStub;

  beforeEach(() => {
    emitStub = stub(bus, 'emit');
  });

  afterEach(() => {
    emitStub.restore();
    // Ensure plugin system flag restored
    try {
      enable('USE_PLUGIN_SYSTEM');
    } catch (e) {}
  });

  it('activates, deactivates and destroys without loading component', async () => {
    // Prepare DOM host and timeline board
    const host = document.createElement('div');
    host.id = 'test-app';
    document.body.appendChild(host);

    const timeline = document.createElement('timeline-board');
    document.body.appendChild(timeline);

    // Disable plugin system so init does not dynamically import heavy component
    disable('USE_PLUGIN_SYSTEM');

    const p = new PluginCostV2('pcv2-test', { mountPoint: 'test-app' });
    // mark component as loaded to avoid init path in activate
    p._componentLoaded = true;
    p._host = host;

    // simulate element created by component
    p._el = document.createElement('plugin-cost-v2');
    p._el.open = stub();
    p._el.close = stub();
    p._el.style.display = 'none';
    host.appendChild(p._el);

    await p.activate();
    expect(p.active).to.be.true;
    expect(p._el.open.called).to.be.true;
    expect(emitStub.calledOnce).to.be.true;
    expect(emitStub.firstCall.args[0]).to.equal(PluginEvents.ACTIVATED);
    // fullscreen should hide timeline-board
    expect(timeline.style.display).to.equal('none');
    expect(p._el.style.display).to.equal('flex');

    await p.deactivate();
    expect(p.active).to.be.false;
    expect(emitStub.calledTwice).to.be.true;
    expect(emitStub.secondCall.args[0]).to.equal(PluginEvents.DEACTIVATED);
    expect(p._el.style.display).to.equal('none');

    await p.destroy();
    expect(p._el).to.equal(null);
    expect(p.initialized).to.be.false;

    // cleanup
    timeline.remove();
    host.remove();
  });
});
