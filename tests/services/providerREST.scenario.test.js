import { expect } from '@esm-bundle/chai';
import { server } from '../msw/server.js';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/scenario tests', () => {
  it('list, loadAll, get, save (twice) and delete scenarios', async () => {
    const pr = new ProviderREST();

    // listScenarios - should return metadata list
    const list = await pr.listScenarios();
    expect(list.ok).to.equal(true);
    expect(Array.isArray(list.data)).to.equal(true);
    expect(list.data.length).to.be.at.least(1);

    // loadAllScenarios - should return full scenario objects
    const all = await pr.loadAllScenarios();
    expect(all.ok).to.equal(true);
    expect(Array.isArray(all.data)).to.equal(true);
    expect(all.data.length).to.be.at.least(1);
    // known fixture name from handlers.js
    expect(all.data.some((s) => s.name === '03-11 Scenario Bob')).to.equal(true);

    // getScenario - request a known fixture id
    const knownId = 'scen_1773226555116_6770';
    const scen = await pr.getScenario(knownId);
    expect(scen.ok).to.equal(true);
    expect(scen.data).to.not.equal(null);
    expect(scen.data.name).to.equal('03-11 Scenario Bob');

    // saveScenario (create) - id is null for new scenario, server assigns id
    const newScenario = {
      id: null,
      name: 'New Scenario',
      overrides: {},
      filters: {},
      view: {},
    };
    const saved1 = await pr.saveScenario(newScenario);
    expect(saved1.ok).to.equal(true);
    expect(saved1.data).to.have.property('id');
    expect(typeof saved1.data.id).to.equal('string');

    // Server refreshes must normalize all scenario rows back to clean state.
    const refreshed = await pr.listScenarios();
    expect(refreshed.ok).to.equal(true);
    expect(refreshed.data.every((s) => !Object.prototype.hasOwnProperty.call(s, 'changedIds'))).to.equal(true);

    // saveScenario (update)
    const updatedScenario = { ...saved1.data, name: 'New Scenario Updated' };
    const saved2 = await pr.saveScenario(updatedScenario);
    expect(saved2.ok).to.equal(true);
    expect(saved2.data.id).to.equal(saved1.data.id);
    expect(saved2.data.name).to.equal('New Scenario Updated');

    // deleteScenario
    const deleted = await pr.deleteScenario(saved1.data.id);
    expect(deleted.ok).to.equal(true);
    expect(deleted.data).to.equal(true);
  });

  it('re-hydrated scenario lists are always clean', async () => {
    const pr = new ProviderREST();
    const list = await pr.listScenarios();

    expect(list.ok).to.equal(true);
    expect(list.data.every((scenario) => !Object.prototype.hasOwnProperty.call(scenario, 'changedIds'))).to.equal(true);
  });
});
