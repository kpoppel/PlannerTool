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

  it('getIterations() (no project) returns iterations array', async () => {
    const pr = new ProviderREST();
    const iters = await pr.getIterations();
    expect(Array.isArray(iters)).to.equal(true);
    expect(iters.length).to.be.at.least(1);
  });
});
