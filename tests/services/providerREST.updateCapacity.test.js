import { expect } from '@open-wc/testing';

import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST update capacity APIs', () => {
  let pr;
  let restoreFetch;
  beforeEach(() => {
    pr = new ProviderREST();
    restoreFetch = window.fetch;
    // keep tests fast
    pr._networkRetryCount = 0;
  });
  afterEach(() => { window.fetch = restoreFetch; });

  it('updateTasksWithCapacity posts updates and returns parsed json on success', async () => {
    window.fetch = (url, opts) => {
      expect(url).to.equal('/api/tasks');
      expect(opts.method).to.equal('POST');
      // ensure body is JSON
      const body = JSON.parse(opts.body);
      expect(Array.isArray(body)).to.equal(true);
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, count: body.length }) });
    };
    const updates = [{ id: 't1', capacity: [{ team: 'a', capacity: 5 }] }];
    const res = await pr.updateTasksWithCapacity(updates);
    expect(res).to.be.an('object');
    expect(res.ok).to.equal(true);
    expect(res.count).to.equal(1);
  });

  it('updateTasksWithCapacity returns error object on HTTP failure', async () => {
    window.fetch = () => Promise.resolve({ ok: false, status: 500 });
    const res = await pr.updateTasksWithCapacity([{ id: 'x' }]);
    expect(res).to.be.an('object');
    expect(res.ok).to.equal(false);
    expect(res.error).to.contain('HTTP 500');
  });

  it('updateTasksWithCapacity returns error object on network exception', async () => {
    window.fetch = () => Promise.reject(new Error('no-network'));
    const res = await pr.updateTasksWithCapacity([{ id: 'x' }]);
    expect(res).to.be.an('object');
    expect(res.ok).to.equal(false);
    expect(res.error).to.contain('no-network');
  });

  it('updateWorkItemCapacity PUTs capacity and returns parsed json or error text', async () => {
    // success case
    window.fetch = (url, opts) => {
      if(url.endsWith('/capacity')) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    const ok = await pr.updateWorkItemCapacity('WI1', [{ team: 't', capacity: 3 }]);
    expect(ok).to.be.an('object'); expect(ok.ok).to.equal(true);

    // failure case - include response text
    window.fetch = (url, opts) => Promise.resolve({ ok: false, status: 400, text: async () => 'bad' });
    const bad = await pr.updateWorkItemCapacity('WI2', [{ team: 't', capacity: 1 }]);
    expect(bad.ok).to.equal(false);
    expect(bad.error).to.contain('HTTP 400');
    expect(bad.error).to.contain('bad');
  });
});
