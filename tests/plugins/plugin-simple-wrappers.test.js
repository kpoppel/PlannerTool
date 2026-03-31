import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import PluginGraph from '../../www/js/plugins/PluginGraph.js';
import PluginHistory from '../../www/js/plugins/PluginHistory.js';
import PluginPlanHealth from '../../www/js/plugins/PluginPlanHealth.js';
import PluginLinkEditor from '../../www/js/plugins/PluginLinkEditor.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';

describe('Simple plugin wrappers lifecycle', () => {
  let emitStub;

  beforeEach(() => {
    emitStub = stub(bus, 'emit');
  });
  afterEach(() => {
    emitStub.restore();
  });

  it('PluginGraph activates and deactivates (fullscreen)', async () => {
    const host = document.createElement('div');
    host.id = 'app';
    document.body.appendChild(host);
    const timeline = document.createElement('timeline-board');
    document.body.appendChild(timeline);

    const p = new PluginGraph('pg-test', { fullscreen: true });
    p._componentLoaded = true;
    p._host = host;
    p._el = document.createElement('plugin-graph');
    p._el.open = stub();
    p._el.close = stub();
    host.appendChild(p._el);

    await p.activate();
    expect(p.active).to.be.true;
    expect(emitStub.calledOnce).to.be.true;
    expect(emitStub.firstCall.args[0]).to.equal(PluginEvents.ACTIVATED);

    await p.deactivate();
    expect(p.active).to.be.false;
    expect(emitStub.calledTwice).to.be.true;
    expect(emitStub.secondCall.args[0]).to.equal(PluginEvents.DEACTIVATED);

    await p.destroy();
    timeline.remove();
    host.remove();
  });

  it('PluginHistory lifecycle and refresh', async () => {
    const p = new PluginHistory('ph-test');
    p._componentLoaded = true;
    p._el = document.createElement('plugin-history');
    p._el.open = stub();
    p._el.close = stub();
    p._el.refresh = stub();
    document.body.appendChild(p._el);

    await p.activate();
    expect(p.active).to.be.true;
    expect(emitStub.calledOnce).to.be.true;

    await p.refresh();
    expect(p._el.refresh.called).to.be.true;

    await p.deactivate();
    expect(emitStub.calledTwice).to.be.true;

    await p.destroy();
  });

  it('PluginPlanHealth lifecycle', async () => {
    const p = new PluginPlanHealth('pph-test');
    p._componentLoaded = true;
    p._el = document.createElement('plugin-plan-health');
    p._el.open = stub();
    p._el.close = stub();
    p._el.refresh = stub();
    document.body.appendChild(p._el);

    await p.activate();
    expect(p.active).to.be.true;
    expect(emitStub.calledOnce).to.be.true;

    await p.deactivate();
    expect(emitStub.calledTwice).to.be.true;

    await p.destroy();
  });

  it('PluginLinkEditor init/activate/deactivate/destroy', async () => {
    const p = new PluginLinkEditor('ple-test');
    p._component = document.createElement('plugin-link-editor');
    p._component.open = stub();
    p._component.close = stub();
    document.body.appendChild(p._component);

    await p.init();
    expect(p.initialized).to.be.true;

    await p.activate();
    expect(p.active).to.be.true;

    await p.deactivate();
    expect(p.active).to.be.false;

    await p.destroy();
  });
});
