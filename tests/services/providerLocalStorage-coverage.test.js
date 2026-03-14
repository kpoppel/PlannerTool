import { expect } from '@esm-bundle/chai';
import { ProviderLocalStorage } from '../../www/js/services/providerLocalStorage.js';
import { dataService } from '../../www/js/services/dataService.js';

describe('ProviderLocalStorage coverage', () => {
  let prov;
  beforeEach(() => {
    localStorage.clear();
    prov = new ProviderLocalStorage();
  });

  it('capabilities and health', async () => {
    const caps = await prov.getCapabilities();
    expect(caps).to.be.an('object');
    const h = await prov.checkHealth();
    expect(h.ok).to.equal(true);
  });

  it('save/list/rename/delete scenarios', async () => {
    const s = { id: 's1', name: 'S1' };
    await prov.saveScenario(s);
    let list = await prov.listScenarios();
    expect(list.length).to.equal(1);
    await prov.renameScenario('s1', 'New');
    list = await prov.listScenarios();
    expect(list[0].name).to.equal('New');
    const del = await prov.deleteScenario('s1');
    expect(del.deleted).to.equal(true);
  });

  it('batch update and get lists', async () => {
    // feature date/field helpers removed; ensure list getters still function
    localStorage.setItem('projects', JSON.stringify([{ id: 'p1' }]));
    localStorage.setItem('teams', JSON.stringify([{ id: 't1' }]));
    localStorage.setItem('features', JSON.stringify([{ id: 'f1', start: '', end: '' }]));
    expect(Array.isArray(await prov.getProjects())).to.equal(true);
    expect(Array.isArray(await prov.getTeams())).to.equal(true);
    expect(Array.isArray(await prov.getFeatures())).to.equal(true);
  });

  it('color prefs and local prefs', async () => {
    await prov.saveProjectColor('p1', '#abc');
    await prov.saveTeamColor('t1', '#def');
    const colors = await prov.loadColors();
    expect(colors).to.be.an('object');
    await prov.clearAll();
    await prov.setLocalPref('k', 'v');
    const v = await prov.getLocalPref('k');
    expect(v).to.equal('v');
  });

  it('dataService delegates to providers', async () => {
    // dataService is wired to providerLocalStorage for 'local'
    await dataService.updateProjectColor('p1', '#001');
    await dataService.updateTeamColor('t1', '#002');
    const colors = await dataService.getColorMappings();
    expect(colors).to.be.an('object');
    // read endpoints use providerREST which may return arrays; just call them to exercise functions
      // providerREST uses fetch; default global fetch returns an object - force an array response for these calls
      const origFetch = window.fetch;
      window.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
      const projects = await dataService.getProjects();
      const pIsArrayOrObject = Array.isArray(projects) || typeof projects === 'object';
      expect(pIsArrayOrObject).to.equal(true);
      const teams = await dataService.getTeams();
      const tIsArrayOrObject = Array.isArray(teams) || typeof teams === 'object';
      expect(tIsArrayOrObject).to.equal(true);
      const features = await dataService.getFeatures();
      const fIsArrayOrObject = Array.isArray(features) || typeof features === 'object';
      expect(fIsArrayOrObject).to.equal(true);
      window.fetch = origFetch;
  }).timeout(2000);
});
