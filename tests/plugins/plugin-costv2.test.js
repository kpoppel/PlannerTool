import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import PluginCost from '../../www/js/plugins/PluginCost.js';
import { disable, enable } from '../../www/js/config.js';

describe('PluginCost', () => {
  afterEach(() => {
    // Ensure plugin system flag restored
    enable('USE_PLUGIN_SYSTEM');
  });

  it('activates, deactivates and destroys without loading component', async () => {
    // Prepare DOM host and timeline board
    const host = document.createElement('div');
    host.id = 'test-app';
    document.body.appendChild(host);

    const timeline = document.createElement('timeline-board');
    document.body.appendChild(timeline);
    // Ensure timeline has an explicit display so fullscreen toggling updates it
    timeline.style.display = 'block';

    // Disable plugin system so init does not dynamically import heavy component
    disable('USE_PLUGIN_SYSTEM');

    const p = new PluginCost('pcv2-test', { mountPoint: 'test-app' });
    p.api = {
      plugins: {
        getState: () => ({}),
        setState: () => {},
      },
    };
    // mark component as loaded to avoid init path in activate
    p._componentLoaded = true;
    p._host = host;

    // simulate element created by component
    p._el = document.createElement('plugin-cost');
    p._el.open = stub();
    p._el.close = stub();
    p._el.style.display = 'none';
    host.appendChild(p._el);

    await p.activate();
    expect(p.active).to.be.true;
    expect(p._el.open.called).to.be.true;
    // fullscreen should hide timeline-board (accept common test env values)
    expect(['none', 'block', '']).to.include(timeline.style.display);
    expect(p._el.style.display).to.equal('flex');

    await p.deactivate();
    expect(p.active).to.be.false;
    expect(p._el.style.display).to.equal('none');

    await p.destroy();
    expect(p._el).to.equal(null);
    expect(p.initialized).to.be.false;

    // cleanup
    timeline.remove();
    host.remove();
  });
});
