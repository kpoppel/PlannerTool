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
    const start = Date.now(); let saveBtn, checkboxes;
    while(Date.now() - start < 500){ 
      saveBtn = Array.from(document.querySelectorAll('button')).find(b => /Save/i.test(b.textContent)); 
      checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-id]'));
      if(saveBtn && checkboxes.length > 0) break; 
      await new Promise(r=>setTimeout(r,10)); 
    }
    expect(saveBtn).to.exist;
    // Check the first checkbox (items start unchecked by default now)
    expect(checkboxes[0].checked).to.be.false;
    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r=>setTimeout(r,50));
    saveBtn.click(); 
    const res = await prom; 
    expect(res).to.be.an('array'); 
    expect(res[0]).to.deep.include({ id: 'f1', start: '2025-01-01', end: '2025-01-02' });
  });

  it('openSaveToAzureModal only returns checked items', async () => {
    const overrides = { 
      f1: { start: '2025-01-01', end: '2025-01-02' },
      f2: { start: '2025-02-01', end: '2025-02-15' },
      f3: { start: '2025-03-01', end: '2025-03-10' }
    };
    const s = { 
      getFeatureTitleById: (id) => 'Title-' + id, 
      baselineFeatures: [
        { id: 'f1', start: '', end: '' },
        { id: 'f2', start: '', end: '' },
        { id: 'f3', start: '', end: '' }
      ]
    };
    const { openAzureDevopsModal } = await import('../../www/js/components/modalHelpers.js');
    const prom = (async ()=>{ const p = openAzureDevopsModal({ overrides, state: s }); return p; })();
    
    // Wait for modal to appear and get checkboxes
    const start = Date.now(); 
    let checkboxes, saveBtn;
    while(Date.now() - start < 500){ 
      checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-id]'));
      saveBtn = Array.from(document.querySelectorAll('button')).find(b => /Save/i.test(b.textContent));
      if(checkboxes.length === 3 && saveBtn) break; 
      await new Promise(r=>setTimeout(r,10)); 
    }
    
    expect(checkboxes).to.have.lengthOf(3);
    // All items should start unchecked
    expect(checkboxes[0].checked).to.be.false;
    expect(checkboxes[1].checked).to.be.false;
    expect(checkboxes[2].checked).to.be.false;
    
    // Check items 1 and 3 only
    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }));
    checkboxes[2].checked = true;
    checkboxes[2].dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r=>setTimeout(r,50)); // Wait for state update
    
    // Click save
    saveBtn.click();
    const res = await prom;
    
    // Should only return f1 and f3, not f2
    expect(res).to.be.an('array');
    expect(res).to.have.lengthOf(2);
    expect(res.find(item => item.id === 'f1')).to.exist;
    expect(res.find(item => item.id === 'f3')).to.exist;
    expect(res.find(item => item.id === 'f2')).to.not.exist;
  });
});
