import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import PluginExportTimeline from '../../www/js/plugins/PluginExportTimeline.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';
import { TimelineExportRenderer } from '../../www/js/plugins/export/TimelineExportRenderer.js';

describe('PluginExportTimeline', () => {
  let emitStub;

  beforeEach(() => {
    emitStub = stub(bus, 'emit');
  });

  afterEach(() => {
    emitStub.restore();
  });

  it('exports task labels from board geometry without ghost titles', () => {
    const renderer = new TimelineExportRenderer();
    renderer._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    renderer._renderTaskLabels(32, 300, { rows: [
      { id: 'f1', top: 60, height: 60, feature: { title: 'Release delivery' } },
      { id: 'g1', top: 0, height: 28, isGroup: true, groupObj: { name: 'Release' } },
    ] });
    const labels = renderer._svg.querySelectorAll('.task-label');
    expect(labels).to.have.length(2);
    expect(labels[0].firstChild.textContent).to.equal('Release delivery');
    expect(labels[0].querySelector('title').textContent).to.equal('Release delivery');
    expect(labels[0].getAttribute('y')).to.equal('122');
    expect(renderer._renderGhostTitles).to.equal(undefined);
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