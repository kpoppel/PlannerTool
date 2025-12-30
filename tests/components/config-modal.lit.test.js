import { expect } from '@esm-bundle/chai';
import '../../www/js/components/ConfigModal.lit.js';
import { dataService } from '../../www/js/services/dataService.js';

describe('config-modal', () => {
  let modal;
  beforeEach(() => {
    modal = document.createElement('config-modal');
    document.body.appendChild(modal);
  });

  afterEach(() => {
    if(modal) modal.remove();
  });

  it('_populate reads prefs and fills inputs (mocked)', async () => {
    const origGet = dataService.getLocalPref;
    dataService.getLocalPref = async (k) => k === 'user.email' ? 'a@b.c' : 5;
    // wait for Lit render/update lifecycle to complete
    if (modal.updateComplete) await modal.updateComplete;
    const emailInput = modal.querySelector('#configEmail');
    expect(emailInput).to.exist;
    expect(emailInput.value).to.equal('a@b.c');
    dataService.getLocalPref = origGet;
  });

  it('Save button triggers dataService.setLocalPref and saveConfig', async () => {
    const origSet = dataService.setLocalPref;
    const origSave = dataService.saveConfig;
    let saved = {};
    dataService.setLocalPref = async (k,v)=> { saved[k]=v; };
    dataService.saveConfig = async (cfg) => ({ ok: true });
    // wait for Lit render/update lifecycle to complete
    if (modal.updateComplete) await modal.updateComplete;
    const emailInput = modal.querySelector('#configEmail');
    const autosaveInput = modal.querySelector('#autosaveInterval');
    emailInput.value = 'z@y.z';
    autosaveInput.value = '10';
    const saveBtn = modal.querySelector('#saveConfigBtn');
    expect(saveBtn).to.exist;
    // click save
    saveBtn.click();
    // allow async handlers
    await new Promise(r => setTimeout(r, 0));
    expect(saved['user.email']).to.equal('z@y.z');
    dataService.setLocalPref = origSet;
    dataService.saveConfig = origSave;
  });
});
