import { expect } from '@esm-bundle/chai';
import '../../www/js/components/DetailsPanel.lit.js';
import { render } from '../../www/js/vendor/lit.js';
import { cmd } from '../../www/js/application/imports.js';
import { store } from '../../www/js/application/store.js';

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

  it('opens when feature is selected', async () => {
    const feature = {
      id: 'f1',
      title: 'F1',
      start: '2025-01-01',
      end: '2025-02-01',
      state: 'New',
      capacity: [{ team: 't1', capacity: 50 }],
      orgLoad: '10%',
    };
    // feature must be in baseline so sel.feature.getSelectedFeature() resolves
    store.setState(
      (s) => ({ ...s, baseline: { ...s.baseline, features: [feature] } }),
      false,
      'test.setBaseline'
    );
    cmd.feature.setSelectedFeature(feature);
    // allow event loop
    await new Promise((r) => setTimeout(r, 0));
    expect(panel.open).to.be.true;
  });

  it('_renderField shows original when changed', () => {
    panel.feature = { original: { start: '2025-01-01' } };
    // Render the template result into a container using lit render
    const tpl = panel._renderField('Start Date', 'start', '2025-02-01');
    const container = document.createElement('div');
    render(tpl, container);
    expect(container.innerHTML).to.include('was');
  });
});
