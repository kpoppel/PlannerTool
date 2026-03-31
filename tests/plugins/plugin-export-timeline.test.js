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

  it('activate mounts element to app root, opens it, and deactivates/destroys', async () => {
    const appRoot = document.createElement('div');
    appRoot.className = 'app-container';
    document.body.appendChild(appRoot);

    const p = new PluginExportTimeline('export-test');
    p._componentLoaded = true;

    await p.activate();
    expect(p.active).to.be.true;
    expect(p._el).to.exist;
    // element should be appended to app root
    expect(p._el.parentNode).to.exist;
    // simulate element open/close methods
    p._el.open = stub();
    p._el.close = stub();
    await p.deactivate();
    expect(p.active).to.be.false;
    await p.destroy();
    expect(p._el).to.equal(null);

    appRoot.remove();
  });
});
