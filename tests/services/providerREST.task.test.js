import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST feature/team/project endpoints', () => {
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
