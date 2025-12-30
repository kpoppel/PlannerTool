import { expect } from '@esm-bundle/chai';
import '../../www/js/components/DetailsPanel.lit.js';
import { render } from '../../www/js/vendor/lit.js';
import { bus } from '../../www/js/core/EventBus.js';
import { UIEvents } from '../../www/js/core/EventRegistry.js';

describe('details-panel', () => {
  let panel;
  beforeEach(() => {
    panel = document.createElement('details-panel');
    document.body.appendChild(panel);
  });

  afterEach(() => {
    panel.remove();
  });

  it('renders closed when no feature', () => {
    const html = panel.render();
    // should be closed panel markup
    expect(html).to.exist;
  });

  it('opens when bus emits DETAILS_SHOW', async () => {
    const feature = { id: 'f1', title: 'F1', start: '2025-01-01', end: '2025-02-01', state: 'New', capacity: [{ team: 't1', capacity: 50 }], orgLoad: '10%' };
    bus.emit(UIEvents.DETAILS_SHOW, feature);
    // allow event loop
    await new Promise(r => setTimeout(r, 0));
    expect(panel.open).to.be.true;
    expect(panel.feature).to.equal(feature);
  });

  it('_renderField shows original when changed', () => {
    panel.feature = { original: { start: '2025-01-01' } };
    // Render the template result into a container using lit render
    const tpl = panel._renderField('Start Date','start','2025-02-01');
    const container = document.createElement('div');
    render(tpl, container);
    expect(container.innerHTML).to.include('was');
  });
});
