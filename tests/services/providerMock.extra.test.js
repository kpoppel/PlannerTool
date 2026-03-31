import { expect } from '@esm-bundle/chai';
import { ProviderMock } from '../../www/js/services/providerMock.js';

describe('ProviderMock extra coverage', () => {
  let prov;
  beforeEach(() => {
    prov = new ProviderMock();
  });

  it('publishBaseline applies overrides and returns summary', async () => {
    // create a scenario with an override for an existing feature
    const feat = prov.features[0];
    const scen = {
      id: 's2',
      name: 'S2',
      overrides: { [feat.id]: { start: '2025-01-10', end: '2025-01-20' } },
      isLive: false,
    };
    prov.scenarios.push(scen);
    const res = await prov.publishBaseline([], 's2');
    expect(res).to.be.an('object');
    expect(res.count).to.be.a('number');
  });

  it('getCost returns parsed JSON when fetch succeeds', async () => {
    const origFetch = window.fetch;
    window.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ total: 123 }),
    });
    const data = await prov.getCost();
    expect(data).to.be.an('object');
    expect(data.total).to.equal(123);
    window.fetch = origFetch;
  });

  it('getCostTeams returns array with team summaries', async () => {
    const out = await prov.getCostTeams();
    expect(Array.isArray(out)).to.equal(true);
    expect(out.length).to.be.greaterThan(0);
    expect(out[0]).to.have.property('id');
  });

  it('saveConfig persists and returns ok', async () => {
    const res = await prov.saveConfig({ email: 'x@y.z' });
    expect(res.ok).to.equal(true);
    expect(res.email).to.equal('x@y.z');
  });
});
