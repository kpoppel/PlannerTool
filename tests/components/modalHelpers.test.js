import { expect, fixture } from '@open-wc/testing';

import {
  openConfigModal,
  openHelpModal,
  openAzureDevopsModal,
  openScenarioCloneModal,
  openScenarioRenameModal,
  openScenarioDeleteModal
} from '../../../www/js/components/modalHelpers.js';

describe('modalHelpers', () => {
  beforeEach(() => {
    // Ensure document body is clean before each test
    document.body.innerHTML = '';
  });

  // Make customElements.define idempotent to avoid NotSupportedError when
  // the real component modules register the same tags during dynamic import.
  const _origDefine = customElements.define.bind(customElements);
  before(() => {
    customElements.define = (name, ctor) => {
      if (!customElements.get(name)) return _origDefine(name, ctor);
      // already defined - ignore
    };
  });

  // Helper to wait for an element to appear in the document
  async function waitFor(selector, timeout = 2000) {
    const start = Date.now();
    while (true) {
      const el = document.querySelector(selector);
      if (el) return el;
      if (Date.now() - start > timeout) throw new Error('Timed out waiting for ' + selector);
      await new Promise(r => setTimeout(r, 10));
    }
  }

  it('openConfigModal resolves when modal-close dispatched', async () => {
    const promise = openConfigModal();
    const el = await waitFor('config-modal');
    // Simulate close
    el.dispatchEvent(new CustomEvent('modal-close', { detail: { ok: true } }));
    const result = await promise;
    expect(result).to.deep.equal({ ok: true });
    expect(document.querySelector('config-modal')).to.be.null;
  });

  it('openHelpModal resolves when modal-close dispatched', async () => {
    const promise = openHelpModal();
    const el = await waitFor('help-modal');
    el.dispatchEvent(new CustomEvent('modal-close', { detail: 'helped' }));
    const result = await promise;
    expect(result).to.equal('helped');
    expect(document.querySelector('help-modal')).to.be.null;
  });

  it('openAzureDevopsModal resolves on save and close appropriately', async () => {
    // Test save path
    const savePromise = openAzureDevopsModal({ overrides: { a: 1 }, state: null });
    let el = await waitFor('azure-devops-modal');
    el.dispatchEvent(new CustomEvent('azure-save', { detail: [{ id: 'x' }] }));
    const saved = await savePromise;
    expect(saved).to.deep.equal([{ id: 'x' }]);

    // Test close path
    const closePromise = openAzureDevopsModal({ overrides: {}, state: null });
    el = await waitFor('azure-devops-modal');
    el.dispatchEvent(new CustomEvent('modal-close'));
    const closed = await closePromise;
    expect(closed).to.be.null;
  });

  it('scenario modals resolve and remove elements', async () => {
    const cPromise = openScenarioCloneModal({ id: 'i', name: 'n' });
    let el = await waitFor('scenario-clone-modal');
    el.dispatchEvent(new CustomEvent('modal-close', { detail: { cloned: true } }));
    const cres = await cPromise;
    expect(cres).to.deep.equal({ cloned: true });
    expect(document.querySelector('scenario-clone-modal')).to.be.null;

    // Rename
    const rPromise = openScenarioRenameModal({ id: 'r', name: 'rn' });
    el = await waitFor('scenario-rename-modal');
    el.dispatchEvent(new CustomEvent('modal-close', { detail: { renamed: true } }));
    const rres = await rPromise;
    expect(rres).to.deep.equal({ renamed: true });

    // Delete
    const dPromise = openScenarioDeleteModal({ id: 'd', name: 'dn' });
    el = await waitFor('scenario-delete-modal');
    el.dispatchEvent(new CustomEvent('modal-close', { detail: { deleted: true } }));
    const dres = await dPromise;
    expect(dres).to.deep.equal({ deleted: true });
  });
});
