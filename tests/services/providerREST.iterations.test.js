import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/iterations tests', () => {
  it('getIterations(project) returns iterations array for a project', async () => {
    const pr = new ProviderREST();
    const iters = await pr.getIterations('project-a');
    expect(Array.isArray(iters)).to.equal(true);
    // Fixture has iterations array with at least one element
    expect(iters.length).to.be.at.least(1);
    const i = iters[0];
    expect(i).to.have.property('path');
    expect(i).to.have.property('name');
    expect(i).to.have.property('startDate');
    expect(i).to.have.property('finishDate');
  });

  it('getIterations() (no project) returns grouped iterations by project', async () => {
    const pr = new ProviderREST();
    const byProject = await pr.getIterations();
    expect(typeof byProject).to.equal('object');
    expect(Array.isArray(byProject)).to.equal(false);
    expect(byProject).to.have.property('project-a');
    expect(byProject['project-a']).to.have.property('iterations');
    expect(Array.isArray(byProject['project-a'].iterations)).to.equal(true);
    expect(byProject['project-a'].iterations.length).to.be.at.least(1);
  });
});
