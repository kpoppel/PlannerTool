import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/account tests', () => {
  it('saveConfig sends config to server and returns saved object', async () => {
    const pr = new ProviderREST();
    const cfg = { theme: 'dark', notifications: true };
    const res = await pr.saveConfig(cfg);
    expect(res).to.be.an('object');
    // handler echoes the config
    expect(res.theme).to.equal('dark');
    expect(res.notifications).to.equal(true);
  });

  it('getConfig returns an object (stubbed)', async () => {
    const pr = new ProviderREST();
    const res = await pr.getConfig();
    expect(res).to.be.an('object');
  });

  it('getCapabilities returns expected capability flags', async () => {
    const pr = new ProviderREST();
    const caps = await pr.getCapabilities();
    expect(caps).to.be.an('object');
    expect(caps.scenariosPersisted).to.equal(true);
    expect(caps.colorsPersisted).to.equal(true);
    expect(caps.batchUpdates).to.equal(true);
  });
});
