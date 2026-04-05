import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST feature/team/project endpoints', () => {
  it('getFeatures(project) returns enriched feature array', async () => {
    const pr = new ProviderREST();
    const feats = await pr.getFeatures('project-a');
    expect(Array.isArray(feats)).to.equal(true);
    expect(feats.length).to.be.at.least(1);
    const f = feats[0];
    expect(f).to.have.property('parentId');
    expect(f).to.have.property('original');
    expect(f).to.have.property('changedFields');
    expect(Array.isArray(f.changedFields)).to.equal(true);
    expect(f).to.have.property('dirty');
  });

  it('getTeams() returns teams with selected flag', async () => {
    const pr = new ProviderREST();
    const teams = await pr.getTeams();
    expect(Array.isArray(teams)).to.equal(true);
    expect(teams.length).to.be.at.least(1);
    const t = teams[0];
    expect(t).to.have.property('id');
    expect(t).to.have.property('name');
    expect(t).to.have.property('selected');
    expect(t.selected).to.equal(true);
  });

  it('getProjects() returns projects with selected flag', async () => {
    const pr = new ProviderREST();
    const projects = await pr.getProjects();
    expect(Array.isArray(projects)).to.equal(true);
    expect(projects.length).to.be.at.least(1);
    const p = projects[0];
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
    expect(Array.isArray(res.updated)).to.equal(true);
    expect(res.updated).to.include('100');
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
    expect(Array.isArray(res.updated)).to.equal(true);
    expect(res.updated).to.include('101');
  });

  it('updateWorkItemCapacity updates a single work item capacity', async () => {
    const pr = new ProviderREST();
    const capacity = [{ team: 'team-t2', capacity: 200 }];
    const res = await pr.updateWorkItemCapacity('110', capacity);
    expect(res).to.have.property('ok', true);
    expect(res).to.have.property('id', '110');
    expect(Array.isArray(res.capacity)).to.equal(true);
    expect(res.capacity[0].capacity).to.equal(200);
  });
});
