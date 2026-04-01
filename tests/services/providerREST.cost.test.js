import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST cost endpoints', () => {
  it('getCost() with no payload returns cost data', async () => {
    const pr = new ProviderREST();
    const cost = await pr.getCost();
    expect(cost).to.have.property('projects');
    expect(cost).to.have.property('months');
    expect(cost).to.have.property('teams');
    expect(Array.isArray(cost.projects)).to.equal(true);
    expect(Array.isArray(cost.months)).to.equal(true);
    expect(Array.isArray(cost.teams)).to.equal(true);
    expect(cost.projects.length).to.be.at.least(1);
    const proj = cost.projects[0];
    expect(proj).to.have.property('project_id');
    expect(proj).to.have.property('total_cost');
    expect(proj).to.have.property('months');
  });

  it('getCost(overrides) with array payload returns cost data', async () => {
    const pr = new ProviderREST();
    const overrides = [
      { id: '100', capacity: [{ team: 'team-t1', capacity: 50 }] },
    ];
    const cost = await pr.getCost(overrides);
    expect(cost).to.have.property('projects');
    expect(cost).to.have.property('months');
    expect(cost).to.have.property('teams');
  });

  it('getCost(payload) with features array returns cost data', async () => {
    const pr = new ProviderREST();
    const payload = {
      features: [
        { id: '100', start: '2026-01-01', end: '2026-02-01', capacity: [] },
      ],
    };
    const cost = await pr.getCost(payload);
    expect(cost).to.have.property('projects');
    expect(cost).to.have.property('months');
    expect(cost).to.have.property('teams');
  });

  it('getCost(payload) with empty features array returns minimal schema', async () => {
    const pr = new ProviderREST();
    const payload = { features: [] };
    const cost = await pr.getCost(payload);
    // Should return minimal schema without calling backend
    expect(cost).to.have.property('projects');
    expect(cost).to.have.property('months');
    expect(cost).to.have.property('teams');
    expect(Array.isArray(cost.projects)).to.equal(true);
    expect(cost.projects.length).to.equal(0);
  });

  it('getCostTeams() returns team cost configuration', async () => {
    const pr = new ProviderREST();
    const data = await pr.getCostTeams();
    expect(data).to.have.property('teams');
    expect(Array.isArray(data.teams)).to.equal(true);
    expect(data.teams.length).to.be.at.least(1);
    const t = data.teams[0];
    expect(t).to.have.property('id');
    expect(t).to.have.property('name');
    expect(t).to.have.property('members');
    expect(t).to.have.property('totals');
  });
});
