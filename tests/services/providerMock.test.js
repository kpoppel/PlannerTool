import { expect } from '@open-wc/testing';

import { ProviderMock } from '../../www/js/services/providerMock.js';

describe('ProviderMock', () => {
  let pm;
  beforeEach(() => { pm = new ProviderMock(); });

  it('getCapabilities returns expected shape', async () => {
    const c = await pm.getCapabilities();
    expect(c.scenariosPersisted).to.equal(true);
    expect(c.batchUpdates).to.equal(true);
  });

  it('listScenarios returns array with expected fields', async () => {
    const list = await pm.listScenarios();
    expect(list).to.be.an('array'); expect(list[0]).to.have.property('id');
  });

  it('saveScenario creates and updates scenarios', async () => {
    const res = await pm.saveScenario({ name: 'New Scenario' });
    expect(res).to.have.property('id');
    const updated = await pm.saveScenario({ id: res.id, name: 'Updated' });
    expect(updated.name).to.equal('Updated');
  });

  it('deleteScenario respects live flag', async () => {
    const s = await pm.saveScenario({ name: 'ToDelete' });
    const ok = await pm.deleteScenario(s.id);
    expect(ok).to.equal(true);
    const bad = await pm.deleteScenario('no-such');
    expect(bad).to.equal(false);
  });

  it('renameScenario throws for missing scenario and renames valid', async () => {
    let threw = false;
    try{ await pm.renameScenario('missing','x'); }catch(e){ threw = true; }
    expect(threw).to.equal(true);
    const s = await pm.saveScenario({ name: 'ForRename' });
    const r = await pm.renameScenario(s.id, 'Renamed');
    expect(r.name).to.equal('Renamed');
  });

  it('publishBaseline updates features when overrides exist', async () => {
    // create scenario with overrides
    const s = await pm.saveScenario({ name: 'WithOverrides', overrides: { 'feat-alpha-A': { start: '2025-01-02', end: '2025-02-01' } } });
    const res = await pm.publishBaseline([], s);
    expect(res.ok).to.equal(true);
  });

  it('setFeatureField updates feature and marks changedFields', async () => {
    const f = pm.features[0];
    const updated = await pm.setFeatureField(f.id, 'title', 'New Title');
    expect(updated.title).to.equal('New Title');
    expect(updated.changedFields).to.include('title');
  });

  it('setFeatureDates and batchSetFeatureDates behave as expected', async () => {
    const f = pm.features[1];
    const out = await pm.setFeatureDates(f.id, '2025-09-01', '2025-10-01');
    expect(out.start).to.equal('2025-09-01');
    const res = await pm.batchSetFeatureDates([{ id: f.id, start: '2025-01-01', end: '2025-02-02' }]);
    expect(res[0].start).to.equal('2025-01-01');
  });

  it('getConfig/getFeatures/getTeams/getProjects return data', async () => {
    const cfg = await pm.getConfig(); expect(cfg).to.have.property('developmentMode');
    const feats = await pm.getFeatures(); expect(Array.isArray(feats)).to.equal(true);
    const teams = await pm.getTeams(); expect(Array.isArray(teams)).to.equal(true);
    const projs = await pm.getProjects(); expect(Array.isArray(projs)).to.equal(true);
  });

  it('checkHealth and saveConfig behave', async () => {
    const h = await pm.checkHealth(); expect(h.ok).to.equal(true);
    const s = await pm.saveConfig({ email: 'x@y.z' }); expect(s.ok).to.equal(true); expect(s.email).to.equal('x@y.z');
  });
});
