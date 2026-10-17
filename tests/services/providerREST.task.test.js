import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';
import { ProviderREST } from '../../www/js/services/providerREST.js';
import { store } from '../../www/js/application/store.js';

describe('ProviderREST feature/team/project endpoints', () => {
  beforeEach(() => store.setState({ notifications: [] }));
  afterEach(() => vi.restoreAllMocks());

  it('records HTTP failures from any JSON endpoint with the server message', async () => {
    const provider = new ProviderREST();
    vi.spyOn(provider, '_fetchImpl').mockResolvedValue(new Response(JSON.stringify({
      detail: { error: 'backend_unavailable', message: 'Azure DevOps is unreachable.' },
    }), { status: 503 }));

    const result = await provider.checkHealth();

    expect(result.ok).to.equal(false);
    expect(store.getState().notifications).to.have.length(1);
    expect(store.getState().notifications[0].message).to.include('Azure DevOps is unreachable.');
    expect(store.getState().notifications[0].severity).to.equal('error');
  });

  it('records every failed publish item even when HTTP succeeds', async () => {
    const provider = new ProviderREST();
    vi.spyOn(provider, '_fetchImpl').mockResolvedValue(new Response(JSON.stringify({
      ok: false, updated: [], errors: ['100 (dates): denied', '101 (dates): denied'],
    })));

    const result = await provider.publishBaseline([{ id: '100', start: '2026-03-01' }]);

    expect(result.ok).to.equal(true);
    expect(result.data.ok).to.equal(false);
    expect(store.getState().notifications.map(entry => entry.message)).to.deep.equal([
      '101 (dates): denied', '100 (dates): denied',
    ]);
  });

  it('records an exhausted network failure once without opening a message modal', async () => {
    const provider = new ProviderREST();
    vi.spyOn(provider, '_sleep').mockResolvedValue();
    const fetch = vi.spyOn(provider, '_fetchImpl').mockRejectedValue(new Error('Connection refused'));

    const result = await provider.checkHealth();

    expect(result.ok).to.equal(false);
    expect(fetch.mock.calls).to.have.length(3);
    expect(store.getState().notifications).to.have.length(1);
    expect(store.getState().notifications[0].count).to.equal(1);
    expect(document.getElementById('app-message-modal')).to.equal(null);
  });

  it('records all backend diagnostics without opening a warning modal', async () => {
    store.setState({ notifications: [] });
    const diagnostics = [
      { code: 'schedule_missing', severity: 'warning', message: '3 schedules were not found.' },
      { code: 'tasks_stale', severity: 'warning', message: 'Using cached tasks.' },
      { code: 'task_cache_access', severity: 'warning',
        message: 'Your backend access cannot read Plan A; showing previously loaded data.' },
    ];
    const pr = new ProviderREST();
    vi.spyOn(pr, '_fetchImpl').mockResolvedValue(new Response('[]', {
      headers: { 'X-Backend-Diagnostics': JSON.stringify(diagnostics) },
    }));

    const result = await pr.getFeatures();

    expect(result.ok).to.equal(true);
    expect(store.getState().notifications.map((notice) => notice.message)).to.deep.equal(
      diagnostics.map((notice) => notice.message).reverse());
    expect(document.getElementById('app-message-modal')).to.equal(null);
  });

  it('collects diagnostics from non-task endpoints as well', async () => {
    const provider = new ProviderREST();
    vi.spyOn(provider, '_fetchImpl').mockResolvedValue(new Response('{}', {
      headers: { 'X-Backend-Diagnostics': JSON.stringify([
        { code: 'cache_warning', severity: 'warning', message: 'Cache refresh failed.' },
      ]) },
    }));

    const result = await provider.checkHealth();

    expect(result.ok).to.equal(true);
    expect(store.getState().notifications[0].message).to.equal('Cache refresh failed.');
  });

  it('records invalid JSON failures without changing the result contract', async () => {
    const provider = new ProviderREST();
    vi.spyOn(provider, '_fetchImpl').mockResolvedValue(new Response('not json'));

    const result = await provider.checkHealth();

    expect(result.ok).to.equal(false);
    expect(store.getState().notifications[0].code).to.equal('invalid_response');
  });

  it('getFeatures(project) returns enriched feature array', async () => {
    const pr = new ProviderREST();
    const feats = await pr.getFeatures('project-a');
    expect(feats.ok).to.equal(true);
    expect(Array.isArray(feats.data)).to.equal(true);
    expect(feats.data.length).to.be.at.least(1);
    const f = feats.data[0];
    expect(f).to.have.property('parentId');
    expect(f).to.have.property('original');
    expect(f).to.have.property('changedFields');
    expect(Array.isArray(f.changedFields)).to.equal(true);
    expect(f).to.have.property('dirty');
  });

  it('getTeams() returns teams with selected flag', async () => {
    const pr = new ProviderREST();
    const teams = await pr.getTeams();
    expect(teams.ok).to.equal(true);
    expect(Array.isArray(teams.data)).to.equal(true);
    expect(teams.data.length).to.be.at.least(1);
    const t = teams.data[0];
    expect(t).to.have.property('id');
    expect(t).to.have.property('name');
    expect(t).to.have.property('selected');
    expect(t.selected).to.equal(true);
  });

  it('getProjects() returns projects with selected flag', async () => {
    const pr = new ProviderREST();
    const projects = await pr.getProjects();
    expect(projects.ok).to.equal(true);
    expect(Array.isArray(projects.data)).to.equal(true);
    expect(projects.data.length).to.be.at.least(1);
    const p = projects.data[0];
    expect(p).to.have.property('id');
    expect(p).to.have.property('name');
    expect(p).to.have.property('selected');
    expect(p.selected).to.equal(true);
  });

  it('getProjects() excludes archived projects returned by the API', async () => {
    const pr = new ProviderREST();
    vi.spyOn(pr, '_fetchImpl').mockResolvedValue(new Response(JSON.stringify([
      { id: 'active', name: 'Active Project' },
      { id: 'archived', name: 'Archived Project', archived: true },
    ])));

    const projects = await pr.getProjects();

    expect(projects.ok).to.equal(true);
    expect(projects.data.map((project) => project.id)).to.deep.equal(['active']);
    expect(projects.data[0].selected).to.equal(true);
  });

  it('publishBaseline updates tasks and returns updated ids', async () => {
    const pr = new ProviderREST();
    const res = await pr.publishBaseline([
      { id: '100', capacity: [{ team: 'team-t1', capacity: 50 }] },
    ]);
    expect(res).to.have.property('ok', true);
    expect(res.data).to.have.property('ok', true);
    expect(Array.isArray(res.data.updated)).to.equal(true);
    expect(res.data.updated).to.include('100');
  });

  it('updateTasksWithCapacity applies updates and returns updated ids', async () => {
    const pr = new ProviderREST();
    const updates = [
      {
        id: '101',
        start: '2026-03-01',
        end: '2026-03-10',
        capacity: [{ team: 'team-t2', capacity: 75 }],
      },
    ];
    const res = await pr.updateTasksWithCapacity(updates);
    expect(res).to.have.property('ok', true);
    expect(res.data).to.have.property('ok', true);
    expect(Array.isArray(res.data.updated)).to.equal(true);
    expect(res.data.updated).to.include('101');
  });

  it('updateWorkItemCapacity updates a single work item capacity', async () => {
    const pr = new ProviderREST();
    const capacity = [{ team: 'team-t2', capacity: 200 }];
    const res = await pr.updateWorkItemCapacity('110', capacity);
    expect(res).to.have.property('ok', true);
    expect(res.data).to.have.property('ok', true);
    expect(res.data).to.have.property('id', '110');
    expect(Array.isArray(res.data.capacity)).to.equal(true);
    expect(res.data.capacity[0].capacity).to.equal(200);
  });
});
