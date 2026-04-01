import { expect } from '@esm-bundle/chai';
import { server } from '../msw/server.js';
import { http, HttpResponse } from 'msw';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/session tests', () => {
  it('handles 401 invalid_session by calling acquireSession and retrying', async () => {
    let seq = 0;
    server.use(
      http.get('/api/failing_session', () => {
        seq += 1;
        // Return 401 on the first call, succeed on the retry.
        if (seq < 2)
          return HttpResponse.json({ error: 'invalid_session' }, { status: 401 });
        return HttpResponse.json(
          { sessionId: 'e0a29ba9fc36494393fe9c1afa6fb609' },
          { status: 200 }
        );
      })
    );

    const pr = new ProviderREST();
    const res = await pr._fetch('/api/failing_session', {});
    const body = await res.json();
    expect(body.sessionId).to.equal('e0a29ba9fc36494393fe9c1afa6fb609');
    // The provider instance should also have had its session re-acquired
    expect(pr.sessionId).to.equal('e0a29ba9fc36494393fe9c1afa6fb609');
  });

  it('_headers includes session id when set', () => {
    const pr = new ProviderREST();
    pr.sessionId = 'sid-123';
    const h = pr._headers({ 'X-Custom': 'x' });
    expect(h['X-Session-Id']).to.equal('sid-123');
    expect(h['X-Custom']).to.equal('x');
    expect(h['Accept']).to.equal('application/json');
  });

  it('retries on network errors and eventually throws', async () => {
    const origFetch = globalThis.fetch;
    // Simulate network failure by having fetch throw
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    const pr = new ProviderREST();
    // Keep retries small to speed up test
    pr._networkRetryCount = 1;
    let threw = false;
    try {
      await pr._fetch('/api/unreachable', {});
    } catch (e) {
      threw = true;
    }
    // restore
    globalThis.fetch = origFetch;
    expect(threw).to.equal(true);
  });

  it('returns sessionExpired when reacquire fails', async () => {
    // Arrange: make endpoint respond 401 invalid_session and make session POST fail
    server.use(
      http.get('/api/failing_reacquire', () =>
        HttpResponse.json({ error: 'invalid_session' }, { status: 401 })
      ),
      http.post('/api/session', () =>
        HttpResponse.json({ error: 'server' }, { status: 500 })
      )
    );

    const pr = new ProviderREST();
    const res = await pr._fetch('/api/failing_reacquire', {});
    expect(res).to.have.property('sessionExpired');
    expect(res.sessionExpired).to.equal(true);
    // provider should not have a session id in this case
    expect(pr.sessionId).to.equal(null);
  });
});
