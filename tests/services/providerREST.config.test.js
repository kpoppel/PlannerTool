import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/config tests', () => {
  it('saveConfig sends config to server and returns Result-wrapped saved object', async () => {
    const pr = new ProviderREST();
    const cfg = { theme: 'dark', notifications: true };
    const res = await pr.saveConfig(cfg);
    expect(res).to.be.an('object');
    expect(res.ok).to.equal(true);
    // handler echoes the config
    expect(res.data.theme).to.equal('dark');
    expect(res.data.notifications).to.equal(true);
  });

  it('getConfig returns a Result-wrapped object (stubbed)', async () => {
    const pr = new ProviderREST();
    const res = await pr.getConfig();
    expect(res).to.be.an('object');
    expect(res.ok).to.equal(true);
    expect(res.data).to.be.an('object');
  });

  it('getCapabilities returns Result-wrapped capability flags', async () => {
    const pr = new ProviderREST();
    const caps = await pr.getCapabilities();
    expect(caps).to.be.an('object');
    expect(caps.ok).to.equal(true);
    expect(caps.data.scenariosPersisted).to.equal(true);
    expect(caps.data.colorsPersisted).to.equal(true);
    expect(caps.data.batchUpdates).to.equal(true);
  });
});
