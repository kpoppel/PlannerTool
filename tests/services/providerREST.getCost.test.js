import { expect } from '@open-wc/testing';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST getCost branches', () => {
  let pr;
  let restoreFetch;
  beforeEach(() => {
    pr = new ProviderREST();
    restoreFetch = window.fetch;
    pr._networkRetryCount = 0;
  });
  afterEach(() => { window.fetch = restoreFetch; });

  it('GET no payload returns parsed json', async () => {
    window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ total: 42 }) });
    const r = await pr.getCost();
    expect(r.total).to.equal(42);
  });

  it('GET no payload throws on non-ok', async () => {
    window.fetch = () => Promise.resolve({ ok: false, status: 500 });
    try{
      await pr.getCost();
      throw new Error('expected throw');
    }catch(e){
      expect(e.message).to.contain('HTTP 500');
    }
  });

  it('array payload posts overrides and returns parsed json', async () => {
    window.fetch = (url, opts) => {
      expect(url).to.equal('/api/cost');
      expect(opts.method).to.equal('POST');
      const body = JSON.parse(opts.body);
      expect(body.overrides).to.be.an('array');
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, count: body.overrides.length }) });
    };
    const out = await pr.getCost([{ id: 'f1' }]);
    expect(out.ok).to.equal(true);
    expect(out.count).to.equal(1);
  });

  it('object payload posts payload and returns parsed json', async () => {
    const payload = { features: [{ id: 'f1' }] };
    window.fetch = (url, opts) => {
      // object payload with features is forwarded to /api/cost/features
      expect(url).to.equal('/api/cost/features');
      expect(opts.method).to.equal('POST');
      const body = JSON.parse(opts.body);
      expect(body.features).to.be.an('array');
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    };
    const out = await pr.getCost(payload);
    expect(out.ok).to.equal(true);
  });

  it('throws session_expired when _fetch signals sessionExpired', async () => {
    pr._fetch = async () => ({ sessionExpired: true });
    try{
      await pr.getCost();
      throw new Error('expected');
    }catch(e){
      expect(e.message).to.equal('session_expired');
      expect(e.sessionExpired).to.equal(true);
    }
  });

  it('rethrows network errors', async () => {
    window.fetch = () => Promise.reject(new Error('no-network'));
    try{ await pr.getCost(); throw new Error('expected'); }catch(e){ expect(e.message).to.contain('no-network'); }
  });
});
