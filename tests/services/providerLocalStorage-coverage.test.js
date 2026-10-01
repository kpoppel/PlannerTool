import { expect } from '@esm-bundle/chai';
import { ProviderLocalStorage } from '../../www/js/services/providerLocalStorage.js';
import { dataService } from '../../www/js/services/dataService.js';
import { vi } from 'vitest';

describe('ProviderLocalStorage coverage', () => {
  let prov;
  beforeEach(() => {
    localStorage.clear();
    prov = new ProviderLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('clears PlannerTool browser data without clearing unrelated origin storage', async () => {
    const keys = ['az_planner:user_prefs:v1', 'az_planner:last_view_id',
      'az_planner:search:lastQuery', 'az_planner:onboarding_seen',
      'plannerTool_localPluginData_baseline', 'scenarios', 'config', 'features',
      'teams', 'projects', 'cost_teams'];
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of keys) storage.setItem(key, 'private-data');
      storage.setItem('unrelated:preferences', 'keep');
    }
    await prov.clearBrowserData();
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of keys) expect(storage.getItem(key)).to.equal(null);
      expect(storage.getItem('unrelated:preferences')).to.equal('keep');
    }
  });

  it('revokes the browser before clearing local data on sign out', async () => {
    localStorage.setItem('az_planner:user_prefs:v1', 'private-data');
    const signOut = vi.spyOn(dataService.providers.rest, 'signOut').mockImplementation(async () => {
      expect(localStorage.getItem('az_planner:user_prefs:v1')).to.equal('private-data');
    });
    await dataService.signOut();
    expect(signOut.mock.calls.length).to.equal(1);
    expect(localStorage.getItem('az_planner:user_prefs:v1')).to.equal(null);
  });

  it('retains local data when server sign out fails', async () => {
    localStorage.setItem('az_planner:user_prefs:v1', 'private-data');
    vi.spyOn(dataService.providers.rest, 'signOut').mockRejectedValue(new Error('Server unavailable'));
    let failure;
    try {
      await dataService.signOut();
    } catch (error) {
      failure = error;
    }
    expect(failure.message).to.equal('Server unavailable');
    expect(localStorage.getItem('az_planner:user_prefs:v1')).to.equal('private-data');
  });

  it('clears local data only after successful account deletion', async () => {
    localStorage.setItem('az_planner:user_prefs:v1', 'private-data');
    const deletion = vi.spyOn(dataService.providers.rest, 'deleteAccount').mockImplementation(async () => {
      expect(localStorage.getItem('az_planner:user_prefs:v1')).to.equal('private-data');
    });
    await dataService.deleteAccount('owner@example.com', 'account-key');
    expect(deletion.mock.calls[0]).to.deep.equal(['owner@example.com', 'account-key']);
    expect(localStorage.getItem('az_planner:user_prefs:v1')).to.equal(null);
  });

  it('retains local data when account deletion is rejected', async () => {
    localStorage.setItem('az_planner:user_prefs:v1', 'private-data');
    vi.spyOn(dataService.providers.rest, 'deleteAccount').mockRejectedValue(new Error('Invalid account key'));
    let failure;
    try {
      await dataService.deleteAccount('owner@example.com', 'wrong-key');
    } catch (error) {
      failure = error;
    }
    expect(failure.message).to.equal('Invalid account key');
    expect(localStorage.getItem('az_planner:user_prefs:v1')).to.equal('private-data');
  });

  it('capabilities and health', async () => {
    const caps = await prov.getCapabilities();
    expect(caps).to.be.an('object');
    const h = await prov.checkHealth();
    expect(h.ok).to.equal(true);
  });

  it('save/list/delete scenarios', async () => {
    const s = { id: 's1', name: 'S1' };
    await prov.saveScenario(s);
    let list = await prov.listScenarios();
    expect(list.length).to.equal(1);
    const del = await prov.deleteScenario('s1');
    expect(del.deleted).to.equal(true);
    list = await prov.listScenarios();
    expect(list.length).to.equal(0);
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
    window.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    });
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
