import { expect } from '@open-wc/testing';
import sinon from 'sinon';

import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST unit tests', () => {
  let restoreFetch;
  let pr;
  beforeEach(() => {
    pr = new ProviderREST();
    // save original fetch
    restoreFetch = window.fetch;
  });
  afterEach(() => {
    // restore fetch
    window.fetch = restoreFetch;
    // cleanup localStorage
    try{ localStorage.removeItem('az_planner:user_prefs:v1'); }catch(e){}
  });

  it('_headers includes session id when set', () => {
    pr.sessionId = 'abc123';
    const h = pr._headers({ 'X-Foo': 'bar' });
    expect(h['X-Session-Id']).to.equal('abc123');
    expect(h['X-Foo']).to.equal('bar');
  });

  it('getCapabilities returns capabilities object', async () => {
    const caps = await pr.getCapabilities();
    expect(caps).to.be.an('object');
    expect(caps.scenariosPersisted).to.equal(true);
  });

  it('listScenarios returns empty array on fetch error', async () => {
    window.fetch = () => Promise.reject(new Error('net')); 
    const res = await pr.listScenarios();
    expect(res).to.be.an('array').that.is.empty;
  });

  it('listScenarios returns list and calls bus.emit (no throw)', async () => {
    window.fetch = (url) => Promise.resolve({ ok: true, json: async () => [{ id: 's1' }] });
    const res = await pr.listScenarios();
    expect(res).to.be.an('array').with.lengthOf(1);
  });

  it('getScenario returns null on network failure', async () => {
    window.fetch = () => Promise.reject(new Error('boom'));
    const out = await pr.getScenario('s1');
    expect(out).to.equal(null);
  });

  it('getScenario returns parsed scenario', async () => {
    window.fetch = (url) => Promise.resolve({ ok: true, json: async () => ({ id: 's1', name: 'S1' }) });
    const out = await pr.getScenario('s1');
    expect(out).to.be.an('object'); expect(out.id).to.equal('s1');
  });

  it('saveScenario returns meta or error object', async () => {
    // POST success
    window.fetch = (url, opts) => {
      if(url === '/api/scenario' && opts.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ ok: true, id: 's1' }) });
      return Promise.resolve({ ok: true, json: async () => [] });
    };
    const meta = await pr.saveScenario({ id: 's1' });
    expect(meta).to.be.an('object'); expect(meta.ok).to.equal(true);

    // POST failure
    window.fetch = () => Promise.resolve({ ok: false, status: 500 });
    const bad = await pr.saveScenario({ id: 'x' });
    expect(bad.ok).to.equal(false);
  });

  it('renameScenario behaves like saveScenario', async () => {
    window.fetch = (url, opts) => Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    const r = await pr.renameScenario('s1', 'New');
    expect(r).to.be.an('object');
  });

  it('deleteScenario returns boolean', async () => {
    // success path
    window.fetch = (url, opts) => Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    const ok = await pr.deleteScenario('s1');
    expect(ok).to.equal(true);

    // failure path
    window.fetch = () => Promise.resolve({ ok: false, status: 500 });
    const ok2 = await pr.deleteScenario('s2');
    expect(ok2).to.equal(false);
  });

  it('publishBaseline and saveConfig return parsed json or error object', async () => {
    window.fetch = (url) => Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    const p = await pr.publishBaseline([{ id: 'f1' }]);
    expect(p.ok).to.equal(true);
    const s = await pr.saveConfig({ foo: 'bar' });
    expect(s.ok).to.equal(true);
  });

  it('checkHealth returns error object when fetch throws', async () => {
    window.fetch = () => Promise.reject(new Error('nope'));
    const r = await pr.checkHealth();
    expect(r.status).to.equal('error');
  });

  it('setFeatureField, batchSetFeatureDates, setFeatureDates and getConfig are simple passthroughs', async () => {
    const out1 = await pr.setFeatureField('f1', 'foo', 'bar');
    expect(out1.id).to.equal('f1'); expect(out1.foo).to.equal('bar');
    const out2 = await pr.batchSetFeatureDates([{ id: 'f1', start: 's', end: 'e' }]);
    expect(out2).to.be.an('array'); expect(out2[0].id).to.equal('f1');
    const out3 = await pr.setFeatureDates('f2', 's2', 'e2');
    expect(out3.id).to.equal('f2');
    const cfg = await pr.getConfig(); expect(cfg).to.be.an('object');
  });

  it('getFeatures maps parent relations into parentEpic', async () => {
    const tasks = [ { id: 't1', relations: [{ type: 'Parent', id: 'p1' }] } ];
    window.fetch = (url) => Promise.resolve({ ok: true, json: async () => tasks });
    const out = await pr.getFeatures();
    expect(out).to.be.an('array'); expect(out[0].parentEpic).to.equal('p1');
  });

  it('getTeams and getProjects map selected=true and handle errors', async () => {
    window.fetch = (url) => Promise.resolve({ ok: true, json: async () => [{ id: 'x' }] });
    const teams = await pr.getTeams(); expect(teams[0].selected).to.equal(true);
    const projects = await pr.getProjects(); expect(projects[0].selected).to.equal(true);
    // error paths
    window.fetch = () => Promise.reject(new Error('err'));
    const t2 = await pr.getTeams(); expect(t2).to.be.an('object');
    const p2 = await pr.getProjects(); expect(p2).to.be.an('object');
  });

  it('init reads localStorage and posts to /api/session when email present', async () => {
    // store prefs
    localStorage.setItem('az_planner:user_prefs:v1', JSON.stringify({ 'user.email': 'a@b.c' }));
    // simulate session creation and subsequent loadAllScenarios
    window.fetch = (url, opts) => {
      if(url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ sessionId: 'S1' }) });
      if(url.startsWith('/api/scenario')) return Promise.resolve({ ok: true, json: async () => (url.includes('?id=') ? { id: 's1' } : [{ id: 's1' }]) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    await pr.init();
    expect(pr.sessionId).to.equal('S1');
  });

});
