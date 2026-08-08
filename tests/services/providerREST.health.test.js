/* Prototype for tests using the Mock Service Worker (WSW library
 * This test overrides the default handler for the /api/tasks endpoint to return
 * a specific task.
 */
import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/health tests', () => {
  it('getHealth returns health status', async () => {
    const pr = new ProviderREST();
    const out = await pr.checkHealth();
    expect(out.ok).to.equal(true);
    expect(out.data).to.have.property('status');
    expect(out.data.status).to.equal('ok');
  });
});
