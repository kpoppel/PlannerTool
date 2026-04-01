import { expect } from '@esm-bundle/chai';
import { server } from '../msw/server.js';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/scenario tests', () => {
  it('list, loadAll, get, save (twice), rename and delete scenarios', async () => {
    const pr = new ProviderREST();

    // listScenarios - should return metadata list
    const list = await pr.listScenarios();
    expect(Array.isArray(list)).to.equal(true);
    expect(list.length).to.be.at.least(1);

    // loadAllScenarios - should return full scenario objects
    const all = await pr.loadAllScenarios();
    expect(Array.isArray(all)).to.equal(true);
    expect(all.length).to.be.at.least(1);
    // known fixture name from handlers.js
    expect(all.some((s) => s.name === '03-11 Scenario Bob')).to.equal(true);

    // getScenario - request a known fixture id
    const knownId = 'scen_1773226555116_6770';
    const scen = await pr.getScenario(knownId);
    expect(scen).to.not.equal(null);
    expect(scen.name).to.equal('03-11 Scenario Bob');

    // saveScenario (create) - id is null for new scenario, server assigns id
    const newScenario = {
      id: null,
      name: 'New Scenario',
      overrides: {},
      filters: {},
      view: {},
    };
    const saved1 = await pr.saveScenario(newScenario);
    expect(saved1).to.have.property('id');
    expect(typeof saved1.id).to.equal('string');

    // saveScenario (update)
    saved1.name = 'New Scenario Updated';
    const saved2 = await pr.saveScenario(saved1);
    expect(saved2.id).to.equal(saved1.id);
    expect(saved2.name).to.equal('New Scenario Updated');

    // renameScenario
    const renamed = await pr.renameScenario(saved1.id, 'Renamed Scenario');
    expect(renamed).to.have.property('id');
    expect(renamed.name).to.equal('Renamed Scenario');

    // deleteScenario
    const ok = await pr.deleteScenario(saved1.id);
    expect(ok).to.equal(true);
  });
});
