import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import PluginMarkers from '../../www/js/plugins/PluginMarkers.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';

describe('PluginMarkers', () => {
  let emitStub;

  beforeEach(() => {
    emitStub = stub(bus, 'emit');
  });

  afterEach(() => {
    emitStub.restore();
  });

  it('activate/deactivate/destroy/refresh/toggle behave correctly', async () => {
    const p = new PluginMarkers('markers-test');
    // avoid dynamic import path and DOM creation by pre-setting internals
    p._componentLoaded = true;
    p._el = {
      open: stub(),
      close: stub(),
      refresh: stub(),
      remove: stub(),
    };

    await p.activate();
    expect(p.active).to.be.true;
    expect(emitStub.calledOnce).to.be.true;
    expect(emitStub.firstCall.args[0]).to.equal(PluginEvents.ACTIVATED);

    // refresh should call underlying element refresh
    await p.refresh();
    expect(p._el.refresh.called).to.be.true;

    await p.deactivate();
    expect(p.active).to.be.false;
    expect(emitStub.calledTwice).to.be.true;
    expect(emitStub.secondCall.args[0]).to.equal(PluginEvents.DEACTIVATED);

    // destroy should remove element and clear active flag
    await p.destroy();
    expect(p._el).to.equal(null);
    expect(p.active).to.be.false;

    // toggle should call activate when inactive, deactivate when active
    const p2 = new PluginMarkers('markers-toggle');
    p2.activate = stub().resolves();
    p2.deactivate = stub().resolves();
    p2.active = false;
    await p2.toggle();
    expect(p2.activate.calledOnce).to.be.true;
    p2.active = true;
    await p2.toggle();
    expect(p2.deactivate.calledOnce).to.be.true;
  });
});
