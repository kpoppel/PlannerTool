import { expect } from '@open-wc/testing';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST publishBaseline variants', () => {
  let pr;
  let restoreFetch;
  beforeEach(() => {
    pr = new ProviderREST();
    restoreFetch = window.fetch;
    pr._networkRetryCount = 0;
  });
  afterEach(() => { window.fetch = restoreFetch; });

  it('sends POST body and returns parsed json on success', async () => {
    window.fetch = (url, opts) => {
      expect(url).to.equal('/api/tasks');
      expect(opts.method).to.equal('POST');
      const body = JSON.parse(opts.body);
      expect(Array.isArray(body)).to.equal(true);
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, posted: body.length }) });
    };
    const res = await pr.publishBaseline([{ id: 'f1' }]);
    expect(res).to.be.an('object'); expect(res.ok).to.equal(true);
    expect(res.posted).to.equal(1);
  });

  it('returns error object on HTTP failure', async () => {
    window.fetch = () => Promise.resolve({ ok: false, status: 503 });
    const res = await pr.publishBaseline([{ id: 'f1' }]);
    expect(res.ok).to.equal(false);
    expect(res.error).to.contain('HTTP 503');
  });

  it('returns session_expired when reacquire fails after 401 invalid_session', async () => {
    // simulate initial 401 invalid_session and failed reacquire
    window.fetch = async () => ({ status: 401, ok: false, json: async () => ({ error: 'invalid_session' }) });
    // ensure _handleSessionExpiry returns false
    pr._handleSessionExpiry = async () => false;
    const res = await pr.publishBaseline([{ id: 'f1' }]);
    expect(res.ok).to.equal(false);
    expect(res.error).to.equal('session_expired');
  });
});
