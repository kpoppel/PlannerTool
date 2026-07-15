import { expect, fixture, html, waitUntil } from '@open-wc/testing';
import { oneEvent } from '@open-wc/testing';
import '../../www/js/components/Modal.lit.js';
import { state } from '../helpers/runtimeState.js';

describe('Modal Consolidated Tests', () => {
  it('renders title and slotted content', async () => {
    const el = await fixture(
      html`<modal-lit .open=${true}
        ><div slot="title">Test Modal</div>
        <p id="testContent">This is test content</p></modal-lit
      >`
    );
    const slotted = el.querySelector('[slot="title"]');
    expect(slotted).to.exist;
    expect(slotted.textContent.trim()).to.equal('Test Modal');
    const content = el.querySelector('#testContent');
    expect(content).to.exist;
    expect(content.textContent).to.equal('This is test content');
  });

  it('open/close behaviour and events', async () => {
    const el = await fixture(
      html`<modal-lit .open=${true}><div slot="title">Test Modal</div></modal-lit>`
    );
    expect(el.open).to.be.true;
    const closeBtn = el.shadowRoot.querySelector('button');
    closeBtn.click();
    await waitUntil(() => !el.open, 'Modal should close');
    expect(el.open).to.be.false;
    // modal-close event
    const el2 = await fixture(
      html`<modal-lit .open=${true}><div slot="title">Test Modal</div></modal-lit>`
    );
    let eventFired = false;
    el2.addEventListener('modal-close', () => {
      eventFired = true;
    });
    el2.shadowRoot.querySelector('button').click();
    await waitUntil(() => eventFired, 'modal-close event should fire');
    expect(eventFired).to.be.true;
  });

  it('visibility based on open and overlay behaviour', async () => {
    const el = await fixture(
      html`<modal-lit .open=${false}><div slot="title">Test Modal</div></modal-lit>`
    );
    const overlay = el.shadowRoot.querySelector('.modal-overlay');
    expect(overlay).to.exist;
    expect(overlay.hasAttribute('open')).to.be.false;
    const elOpen = await fixture(
      html`<modal-lit .open=${true}><div slot="title">Test Modal</div></modal-lit>`
    );
    const overlay2 = elOpen.shadowRoot.querySelector('.modal-overlay');
    overlay2.click();
    await waitUntil(() => !elOpen.open, 'Modal should close on overlay click');
    expect(elOpen.open).to.be.false;
  });

  it('openSaveToAzureModal returns selected items when Save clicked', async () => {
    const overrides = { f1: { start: '2025-01-01', end: '2025-01-02' } };
    const s = {
      features: {
        getTitle: (id) => 'Title-' + id,
        getBaseline: () => [{ id: 'f1', start: '', end: '' }],
      },
    };
    const { openAzureDevopsModal } =
      await import('../../www/js/components/modalHelpers.js');
    const prom = openAzureDevopsModal({ overrides, state: s });
    const start = Date.now();
    let saveBtn, modalEl, root;
    while (Date.now() - start < 500) {
      modalEl = document.querySelector('azure-devops-modal');
      if (modalEl) {
        root = modalEl.renderRoot || modalEl.shadowRoot || modalEl;
        saveBtn = Array.from(root.querySelectorAll('button')).find((b) =>
          /Save/i.test(b.textContent)
        );
      }
      if (saveBtn) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(saveBtn).to.exist;
    // All cells start deselected — click Toggle All to select everything, then Save.
    const toggleBtn = Array.from(root.querySelectorAll('button')).find((b) =>
      /Toggle/i.test(b.textContent)
    );
    expect(toggleBtn).to.exist;
    toggleBtn.click();
    await new Promise((r) => setTimeout(r, 20));
    saveBtn.click();
    const res = await prom;
    expect(res).to.be.an('object');
    expect(res.features).to.be.an('array');
    expect(res.features[0]).to.deep.include({
      id: 'f1',
      start: '2025-01-01',
      end: '2025-01-02',
    });
  });

  it('openSaveToAzureModal only returns items whose cells are selected', async () => {
    const overrides = {
      f1: { start: '2025-01-01', end: '2025-01-02' },
      f2: { start: '2025-02-01', end: '2025-02-15' },
      f3: { start: '2025-03-01', end: '2025-03-10' },
    };
    const s = {
      features: {
        getTitle: (id) => 'Title-' + id,
        getBaseline: () => [
          { id: 'f1', start: '', end: '' },
          { id: 'f2', start: '', end: '' },
          { id: 'f3', start: '', end: '' },
        ],
      },
    };
    const { openAzureDevopsModal } =
      await import('../../www/js/components/modalHelpers.js');
    const prom = openAzureDevopsModal({ overrides, state: s });

    // Wait for modal to appear with 3 feature rows
    const start = Date.now();
    let featureRows, saveBtn, modalEl, root;
    while (Date.now() - start < 1000) {
      modalEl = document.querySelector('azure-devops-modal');
      if (modalEl) {
        root = modalEl.renderRoot || modalEl.shadowRoot || modalEl;
        featureRows = Array.from(root.querySelectorAll('tbody tr'));
        saveBtn = Array.from(root.querySelectorAll('button')).find((b) =>
          /Save/i.test(b.textContent)
        );
      }
      if (saveBtn && featureRows && featureRows.length === 3) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(featureRows).to.have.lengthOf(3);
    expect(saveBtn).to.exist;

    // All cells start deselected. Click changed cells on f1 and f3 rows to include them;
    // leave f2 untouched so it is excluded from the save payload.
    for (const targetId of ['f1', 'f3']) {
      const row = featureRows.find((r) => r.textContent?.includes(`Title-${targetId}`));
      expect(row).to.exist;
      const changedCells = Array.from(row.querySelectorAll('td.changed'));
      expect(changedCells.length).to.be.greaterThan(0);
      for (const cell of changedCells) {
        cell.click();
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    // Click save — f1 and f3 should be returned, f2 excluded
    saveBtn.click();
    const res = await prom;

    expect(res).to.be.an('object');
    expect(res.features).to.be.an('array');
    expect(res.features).to.have.lengthOf(2);
    expect(res.features.find((item) => item.id === 'f1')).to.exist;
    expect(res.features.find((item) => item.id === 'f3')).to.exist;
    expect(res.features.find((item) => item.id === 'f2')).to.not.exist;
  });
});
