import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST cache endpoint', () => {
  it('invalidateCache() posts to invalidate endpoint and returns ok', async () => {
    const pr = new ProviderREST();
    const res = await pr.invalidateCache();
    expect(res).to.have.property('ok', true);
    expect(res).to.have.property('invalidated', true);
  });
});
