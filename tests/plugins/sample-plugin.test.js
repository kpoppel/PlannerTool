import { expect } from '@open-wc/testing';
import { vi } from 'vitest';
import SamplePlugin from '../../www/js/plugins/SamplePlugin.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('SamplePlugin', () => {
  let onSpy;
  let offSpy;

  beforeEach(() => {
    onSpy = vi.spyOn(bus, 'on');
    offSpy = vi.spyOn(bus, 'off');
  });

  afterEach(() => {
    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  it('initializes, activates, deactivates and destroys correctly', async () => {
    const p = new SamplePlugin('sample-1', { name: 'Sample' });
    expect(p.initialized).to.be.false;
    expect(p.active).to.be.false;

    await p.init();
    expect(p.initialized).to.be.true;

    // Mock the mount resolution so _resolveHost doesn't fail in JSDOM
    const mockHost = document.createElement('div');
    mockHost.id = 'app';
    document.body.appendChild(mockHost);
    p._host = mockHost;

    await p.activate();
    expect(p.active).to.be.true;
    // should have subscribed to FeatureEvents.SELECTED — find it among all bus.on calls
    const selectedCall = onSpy.mock.calls.find((c) => c[0] === FeatureEvents.SELECTED);
    expect(selectedCall).to.exist;
    expect(selectedCall[1]).to.equal(p._boundOnFeatureSelect);

    await p.deactivate();
    expect(p.active).to.be.false;
    // find the off call for SELECTED
    const offSelected = offSpy.mock.calls.find((c) => c[0] === FeatureEvents.SELECTED);
    expect(offSelected).to.exist;

    // destroy clears initialized (MountedPlugin.destroy sets this.initialized = false)
    await p.destroy();
    expect(p.initialized).to.be.false;
  });
});
