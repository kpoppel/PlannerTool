import { fixture, html, expect } from '@open-wc/testing';
import '../../www/js/components/DetailsPanel.lit.js';

describe('DetailsPanel Consolidated', () => {
  beforeEach(async () => { await customElements.whenDefined('details-panel'); });

  it('renders closed by default and opens with feature', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    expect(el).to.exist; const panel = el.shadowRoot.querySelector('.panel.closed'); expect(panel).to.exist;
    el.feature = { id: '1', title: 'Test item' }; el.open = true; await el.updateComplete;
    const label = el.shadowRoot.querySelector('.details-label'); expect(label).to.exist; expect(label.textContent).to.contain('Test item');
  });

  it('closes when close button clicked', async () => {
    const el = await fixture(html`<details-panel></details-panel>`);
    el.feature = { id: '1', title: 'Test item' }; el.open = true; await el.updateComplete;
    const closeBtn = el.shadowRoot.querySelector('.details-close'); expect(closeBtn).to.exist; closeBtn.click(); await el.updateComplete; expect(el.open).to.be.false;
  });
});
