import { expect } from '@esm-bundle/chai';
import '../../www/js/components/DetailsPanel.lit.js';
import { render } from '../../www/js/vendor/lit.js';
import { cmd } from '../../www/js/application/imports.js';
import { store } from '../../www/js/application/store.js';
import { DETAILS_PANEL_STYLES } from '../../www/js/components/details-panel/DetailsPanel.styles.lit.js';

describe('details-panel', () => {
  let panel;
  beforeEach(() => {
    panel = document.createElement('details-panel');
    document.body.appendChild(panel);
  });

  afterEach(() => {
    panel.remove();
  });

  it('uses the extracted stylesheet within the existing shadow root', () => {
    expect(panel.constructor.styles).to.equal(DETAILS_PANEL_STYLES);
    expect(DETAILS_PANEL_STYLES.cssText).to.include('.capacity-bar-row');
    expect(DETAILS_PANEL_STYLES.cssText).to.include('.relations-group');
    expect(panel.shadowRoot).to.exist;
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
      relations: [],
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

  it('renders the backend-neutral source name for an ancestor outside configured plans', async () => {
    panel.feature = {
      id: 'ancestor', title: 'Ancestor', project: 'context-owner', type: 'Epic',
      ancestorOnly: true, sourcePlanName: 'Portfolio', state: 'New',
      start: null, end: null, capacity: [], orgLoad: '0%', relations: [],
    };
    panel.open = true;
    await panel.updateComplete;
    const label = [...panel.shadowRoot.querySelectorAll('.details-label')]
      .find((element) => element.textContent.startsWith('Plan:'));
    expect(label.querySelector('.details-value').textContent).to.equal('Portfolio');
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
