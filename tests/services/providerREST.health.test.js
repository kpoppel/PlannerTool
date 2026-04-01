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
    expect(out).to.have.property('status');
    expect(out.status).to.equal('ok');
  });
});
