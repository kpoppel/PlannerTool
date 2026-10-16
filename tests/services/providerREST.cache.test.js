import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST cache endpoint', () => {
  it('refreshTasks() queues a task refresh without invalidating caches', async () => {
    const provider = new ProviderREST();
    const request = vi.spyOn(provider, '_requestJson').mockResolvedValue({
      ok: true, data: { status: 'queued' },
    });
    const result = await provider.refreshTasks();
    expect(result.data.status).to.equal('queued');
    expect(request.mock.calls).to.deep.equal([['/api/tasks/refresh', { method: 'POST' }]]);
  });

  it('invalidateCache() posts to invalidate endpoint and returns ok', async () => {
    const pr = new ProviderREST();
    const res = await pr.invalidateCache();
    expect(res).to.have.property('ok', true);
    expect(res.data).to.have.property('ok', true);
    expect(res.data).to.have.property('invalidated', true);
  });
});
