import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import PluginCost from '../../www/js/plugins/PluginCost.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';

describe('PluginCost', () => {
  let emitStub;

  beforeEach(() => {
    emitStub = stub(bus, 'emit');
  });

  afterEach(() => {
    emitStub.restore();
  });

  it('activates and deactivates, respects fullscreen behavior, and destroys', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    // create a timeline-board element for fullscreen toggling
    const timeline = document.createElement('timeline-board');
    document.body.appendChild(timeline);

    const p = new PluginCost('cost-test', { fullscreen: true });
    // avoid dynamic import
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
    expect(emitStub.calledOnce).to.be.true;
    expect(emitStub.firstCall.args[0]).to.equal(PluginEvents.ACTIVATED);
    // fullscreen should hide timeline-board
    expect(timeline.style.display).to.equal('none');
    expect(p._el.style.display).to.equal('flex');

    await p.deactivate();
    expect(p.active).to.be.false;
    expect(emitStub.calledTwice).to.be.true;
    expect(emitStub.secondCall.args[0]).to.equal(PluginEvents.DEACTIVATED);
    // deactivation should restore timeline display and hide element
    expect(p._el.style.display).to.equal('none');

    await p.destroy();
    expect(p._el).to.equal(null);
    expect(p.initialized).to.be.false;
    // cleanup
    timeline.remove();
    host.remove();
  });
});
