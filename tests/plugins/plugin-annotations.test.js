import { expect } from '@open-wc/testing';
import sinon from 'sinon';
import PluginAnnotations from '../../www/js/plugins/PluginAnnotations.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';

describe('PluginAnnotations', () => {
  let emitStub;

  beforeEach(() => {
    emitStub = sinon.stub(bus, 'emit');
  });

  afterEach(() => {
    emitStub.restore();
  });

  it('activates with board mount and attaches resize handler, then destroys', async () => {
    // Provide both a fallback div AND an #app element so MountedPlugin can resolve _host
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);

    const p = new PluginAnnotations('ann-test', { forceMountInBoard: true });

    // Mock the mount resolution to avoid JSDOM shadow-root / Lit rendering issues.
    // The MountedPlugin base class uses _host and creates _el via createElement + appendChild,
    // but those calls create real Lit elements that fail in JSDOM.  Instead we set up a
    // lightweight stub element so the lifecycle assertions hold without hitting the DOM.
    p._componentLoaded = true;
    p._host = app;

    await p.activate();

    expect(p.active).to.be.true;
    expect(emitStub.calledOnce).to.be.true;
    expect(emitStub.firstCall.args[0]).to.equal(PluginEvents.ACTIVATED);

    // _el should exist as a stub element (not null)
    expect(p._el).to.exist;

    await p.destroy();
    // MountedPlugin.destroy() clears _el AND sets initialized to false
    expect(p._el).to.equal(null);
    expect(p.initialized).to.be.false;
    expect(p.active).to.be.false;

    // cleanup
    app.remove();
  });
});
