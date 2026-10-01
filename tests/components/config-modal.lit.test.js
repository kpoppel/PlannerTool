import { expect } from '@esm-bundle/chai';
import '../../www/js/components/ConfigModal.lit.js';
import { dataService } from '../../www/js/services/dataService.js';
import { vi } from 'vitest';

describe('config-modal', () => {
  let modal;
  beforeEach(() => {
    modal = document.createElement('config-modal');
    document.body.appendChild(modal);
  });

  afterEach(() => {
    if (modal) modal.remove();
    vi.restoreAllMocks();
  });

  it('offers sign out and leaves browser data alone when cancelled', async () => {
    await modal.updateComplete;
    const signOut = vi.spyOn(dataService, 'signOut').mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(modal._qs('#signOutBtn').textContent.trim()).to.equal('Sign out');
    await modal._signOut();
    expect(signOut.mock.calls.length).to.equal(0);
  });

  it('offers account deletion without any pairing controls', async () => {
    await modal.updateComplete;
    expect(modal._qs('#pairBrowserBtn')).to.equal(null);
    expect(modal._qs('#deleteAccountBtn').textContent.trim()).to.equal('Delete account');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ email: 'current@example.com' }),
    }));
    await modal._deleteAccount();
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('#email').value).to.equal('current@example.com');
    expect(dialog.renderRoot.querySelector('#accountKey').required).to.equal(true);
    dialog._toggleDeletion();
    expect(document.querySelector('auth-dialog')).to.equal(null);
    vi.unstubAllGlobals();
  });

  it('shows a failure and re-enables sign out when server revocation fails', async () => {
    await modal.updateComplete;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(dataService, 'signOut').mockRejectedValue(new Error('Server unavailable'));
    await modal._signOut();
    await modal.updateComplete;
    expect(modal._qs('#configStatus').textContent).to.equal('Could not sign out. Please try again.');
    expect(modal._qs('#signOutBtn').disabled).to.equal(false);
  });

  it('prevents repeated sign out and configuration saves while pending', async () => {
    await modal.updateComplete;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let rejectSignOut;
    const pending = new Promise((resolve, reject) => { rejectSignOut = reject; });
    const signOut = vi.spyOn(dataService, 'signOut').mockReturnValue(pending);
    const first = modal._signOut();
    await modal.updateComplete;
    expect(modal._qs('#signOutBtn').disabled).to.equal(true);
    expect(modal._qs('#saveConfigBtn').disabled).to.equal(true);
    await modal._signOut();
    expect(confirm.mock.calls.length).to.equal(1);
    expect(signOut.mock.calls.length).to.equal(1);
    rejectSignOut(new Error('Server unavailable'));
    await first;
  });

  it('shows account email as non-editable text rather than an input', async () => {
    await modal.updateComplete;
    const email = modal._qs('#configEmail');
    expect(email.tagName).to.equal('OUTPUT');
    expect(modal._qs('input#configEmail')).to.equal(null);
    expect(modal._qs('label[for="configEmail"]').textContent).to.equal('Account email');
  });

  it('_populate reads prefs and fills inputs (mocked)', async () => {
    const origGet = dataService.getLocalPref;
    dataService.getLocalPref = async (k) => (k === 'user.email' ? 'a@b.c' : 5);
    // wait for Lit render/update lifecycle to complete and populate inputs
    if (modal.updateComplete) await modal.updateComplete;
    if (typeof modal._populate === 'function') await modal._populate();
    const inner =
      modal.renderRoot ?
        modal.renderRoot.querySelector('modal-lit')
      : modal.querySelector('modal-lit');
    const emailInput = inner ? inner.querySelector('#configEmail') : null;
    expect(emailInput).to.exist;
    expect(emailInput.value).to.equal('a@b.c');
    dataService.getLocalPref = origGet;
  });

  it('Save button triggers dataService.setLocalPref and saveConfig', async () => {
    const origSet = dataService.setLocalPref;
    const origSave = dataService.saveConfig;
    const saved = {};
    dataService.setLocalPref = async (k, v) => {
      saved[k] = v;
    };
    dataService.saveConfig = async (cfg) => ({ ok: true });
    // wait for Lit render/update lifecycle to complete and find inner modal elements
    if (modal.updateComplete) await modal.updateComplete;
    const inner2 =
      modal.renderRoot ?
        modal.renderRoot.querySelector('modal-lit')
      : modal.querySelector('modal-lit');
    const emailInput = inner2 ? inner2.querySelector('#configEmail') : null;
    const autosaveInput = inner2 ? inner2.querySelector('#autosaveInterval') : null;
    emailInput.value = 'z@y.z';
    autosaveInput.value = '10';
    const saveBtn = inner2 ? inner2.querySelector('#saveConfigBtn') : null;
    expect(saveBtn).to.exist;
    // click save
    saveBtn.click();
    // allow async handlers
    await new Promise((r) => setTimeout(r, 0));
    expect(saved['user.email']).to.equal('z@y.z');
    dataService.setLocalPref = origSet;
    dataService.saveConfig = origSave;
  });
});
