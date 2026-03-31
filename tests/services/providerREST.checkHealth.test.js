import { expect } from '@open-wc/testing';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST checkHealth', () => {
  let pr;
  let restoreFetch;
  beforeEach(() => {
    pr = new ProviderREST();
    restoreFetch = window.fetch;
    pr._networkRetryCount = 0;
  });
  afterEach(() => {
    window.fetch = restoreFetch;
  });

  it('returns parsed json on OK', async () => {
    window.fetch = () =>
      Promise.resolve({ ok: true, json: async () => ({ status: 'ok' }) });
    const r = await pr.checkHealth();
    expect(r.status).to.equal('ok');
  });

  it('returns error when response not ok', async () => {
    window.fetch = () => Promise.resolve({ ok: false, status: 500 });
    const r = await pr.checkHealth();
    expect(r.status).to.equal('error');
  });

  it('returns error object when fetch throws', async () => {
    window.fetch = () => Promise.reject(new Error('nope'));
    const r = await pr.checkHealth();
    expect(r.status).to.equal('error');
    expect(r.error).to.contain('nope');
  });

  it('returns session_expired when _fetch signals sessionExpired', async () => {
    pr._fetch = async () => ({ sessionExpired: true });
    const r = await pr.checkHealth();
    expect(r.status).to.equal('error');
    expect(r.error).to.equal('session_expired');
  });
});
