import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/iterations tests', () => {
  it('getIterationsConfig() returns set-id keyed payload', async () => {
    const pr = new ProviderREST();
    const payload = await pr.getIterationsConfig();
    expect(payload).to.be.an('object');
    expect(payload).to.have.property('iterationSetsById');
  });

  it('getIterations(project) returns empty array (deprecated grouped-project path)', async () => {
    const pr = new ProviderREST();
    const iters = await pr.getIterations('project-a');
    expect(Array.isArray(iters)).to.equal(true);
    expect(iters.length).to.equal(0);
  });

  it('getIterations() (no project) returns empty grouped map (deprecated path)', async () => {
    const pr = new ProviderREST();
    const byProject = await pr.getIterations();
    expect(typeof byProject).to.equal('object');
    expect(Array.isArray(byProject)).to.equal(false);
    expect(Object.keys(byProject)).to.have.length(0);
  });
});
