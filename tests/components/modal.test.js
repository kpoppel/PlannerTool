import { expect, fixture, html, waitUntil } from '@open-wc/testing';
import { oneEvent } from '@open-wc/testing';
import '../../www/js/components/Modal.lit.js';
import { state } from '../../www/js/services/State.js';

describe('Modal Consolidated Tests', () => {
  it('renders title and slotted content', async () => {
    const el = await fixture(html`<modal-lit .open=${true}><div slot="title">Test Modal</div><p id="testContent">This is test content</p></modal-lit>`);
    const slotted = el.querySelector('[slot="title"]'); expect(slotted).to.exist; expect(slotted.textContent.trim()).to.equal('Test Modal');
    const content = el.querySelector('#testContent'); expect(content).to.exist; expect(content.textContent).to.equal('This is test content');
  });

  it('open/close behaviour and events', async () => {
    const el = await fixture(html`<modal-lit .open=${true}><div slot="title">Test Modal</div></modal-lit>`);
    expect(el.open).to.be.true;
    const closeBtn = el.shadowRoot.querySelector('button'); closeBtn.click();
    await waitUntil(() => !el.open, 'Modal should close'); expect(el.open).to.be.false;
    // modal-close event
    const el2 = await fixture(html`<modal-lit .open=${true}><div slot="title">Test Modal</div></modal-lit>`);
    let eventFired = false; el2.addEventListener('modal-close', () => { eventFired = true; });
    el2.shadowRoot.querySelector('button').click(); await waitUntil(() => eventFired, 'modal-close event should fire'); expect(eventFired).to.be.true;
  });

  it('visibility based on open and overlay behaviour', async () => {
    const el = await fixture(html`<modal-lit .open=${false}><div slot="title">Test Modal</div></modal-lit>`);
    const overlay = el.shadowRoot.querySelector('.modal-overlay'); expect(overlay).to.exist; const isVisible = window.getComputedStyle(overlay).display !== 'none'; expect(isVisible).to.be.false;
    const elOpen = await fixture(html`<modal-lit .open=${true}><div slot="title">Test Modal</div></modal-lit>`);
    const overlay2 = elOpen.shadowRoot.querySelector('.modal-overlay'); overlay2.click(); await waitUntil(() => !elOpen.open, 'Modal should close on overlay click'); expect(elOpen.open).to.be.false;
  });

  it('openSaveToAzureModal returns selected items when Save clicked', async () => {
    const overrides = { f1: { start: '2025-01-01', end: '2025-01-02' } };
    const s = { getFeatureTitleById: (id) => 'Title-' + id, baselineFeatures: [{ id: 'f1', start: '', end: '' }] };
    const { openAzureDevopsModal } = await import('../../www/js/components/modalHelpers.js');
    const prom = (async ()=>{ const p = openAzureDevopsModal({ overrides, state: s }); return p; })();
    const start = Date.now(); let saveBtn;
    while(Date.now() - start < 500){ saveBtn = Array.from(document.querySelectorAll('button')).find(b => /Save/i.test(b.textContent)); if(saveBtn) break; await new Promise(r=>setTimeout(r,10)); }
    expect(saveBtn).to.exist; saveBtn.click(); const res = await prom; expect(res).to.be.an('array'); expect(res[0]).to.deep.include({ id: 'f1', start: '2025-01-01', end: '2025-01-02' });
  });
});
