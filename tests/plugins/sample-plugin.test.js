import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import SamplePlugin from '../../www/js/plugins/SamplePlugin.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('SamplePlugin', () => {
  let onStub;
  let offStub;

  beforeEach(() => {
    onStub = stub(bus, 'on');
    offStub = stub(bus, 'off');
  });

  afterEach(() => {
    onStub.restore();
    offStub.restore();
  });

  it('initializes, activates, deactivates and destroys correctly', async () => {
    const p = new SamplePlugin('sample-1', { name: 'Sample' });
    expect(p.initialized).to.be.false;
    expect(p.active).to.be.false;

    await p.init();
    expect(p.initialized).to.be.true;

    await p.activate();
    expect(p.active).to.be.true;
    // should have subscribed to FeatureEvents.SELECTED
    expect(onStub.called).to.be.true;
    const callArgs = onStub.firstCall.args;
    expect(callArgs[0]).to.equal(FeatureEvents.SELECTED);

    await p.deactivate();
    expect(p.active).to.be.false;
    expect(offStub.called).to.be.true;

    // destroy should also clear initialized and remove listeners
    await p.destroy();
    expect(p.initialized).to.be.false;
    expect(offStub.called).to.be.true;
  });
});
