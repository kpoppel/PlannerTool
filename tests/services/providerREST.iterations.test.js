import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/iterations tests', () => {
  it('getIterationsConfig() returns set-id keyed payload', async () => {
    const pr = new ProviderREST();
    const payload = await pr.getIterationsConfig();
    expect(payload).to.be.an('object');
    expect(payload).to.have.property('iterationSetsById');
  });
});
