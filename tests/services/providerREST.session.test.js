import { expect } from '@esm-bundle/chai';
import { server } from '../msw/server.js';
import { http, HttpResponse } from 'msw';
import { vi } from 'vitest';
import { ProviderREST } from '../../www/js/services/providerREST.js';
import { showAuthDialog } from '../../www/js/components/AuthDialog.lit.js';

vi.mock('../../www/js/components/AuthDialog.lit.js', () => ({
  showAuthDialog: vi.fn().mockResolvedValue(undefined),
}));

describe('ProviderREST /api/session tests', () => {
  it('does not retry a network failure during destructive account deletion', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    try {
      const provider = new ProviderREST();
      let failure;
      try {
        await provider.deleteAccount('user@example.com', 'current-key');
      } catch (error) {
        failure = error;
      }
      expect(failure.message).to.equal('network down');
      expect(fetch.mock.calls.length).to.equal(1);
    } finally {
      fetch.mockRestore();
    }
  });

  it('does not retry or renew a rejected account deletion', async () => {
    let requests = 0;
    server.use(http.post('/api/auth/delete-account', () => {
      requests += 1;
      return HttpResponse.json({ detail: 'Invalid account key' }, { status: 401 });
    }));
    const provider = new ProviderREST();
    const renew = vi.spyOn(provider, 'acquireSession');
    let failure;
    try {
      await provider.deleteAccount('user@example.com', 'wrong-key');
    } catch (error) {
      failure = error;
    }
    expect(failure.message).to.equal('Invalid account key');
    expect(requests).to.equal(1);
    expect(renew.mock.calls.length).to.equal(0);
  });

  it('rejects failed sign out without renewing the session', async () => {
    server.use(http.post('/api/auth/logout', () =>
      HttpResponse.json({ error: 'invalid_session' }, { status: 401 })
    ));
    const provider = new ProviderREST();
    const renew = vi.spyOn(provider, 'acquireSession');
    let failure;
    try {
      await provider.signOut();
    } catch (error) {
      failure = error;
    }
    expect(failure.message).to.equal('Sign out failed: 401');
    expect(renew.mock.calls.length).to.equal(0);
  });

  it('opens enrollment when startup renewal rejects a legacy session', async () => {
    vi.mocked(showAuthDialog).mockClear();
    server.use(http.post('/api/session', () =>
      HttpResponse.json({ detail: 'Device authentication required' }, { status: 401 })
    ));

    await new ProviderREST().init();

    expect(vi.mocked(showAuthDialog).mock.calls.length).to.equal(1);
  });

  it('handles 401 invalid_session by calling acquireSession and retrying', async () => {
    let seq = 0;
    server.use(
      http.get('/api/failing_session', () => {
        seq += 1;
        // Return 401 on the first call, succeed on the retry.
        if (seq < 2)
          return HttpResponse.json({ error: 'invalid_session' }, { status: 401 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );

    const pr = new ProviderREST();
    const res = await pr._fetch('/api/failing_session', {});
    const body = await res.json();
    expect(body.ok).to.equal(true);
    expect(seq).to.equal(2);
  });

  it('_headers never exposes a session id', () => {
    const pr = new ProviderREST();
    const h = pr._headers({ 'X-Custom': 'x' });
    expect(h['X-Session-Id']).to.equal(undefined);
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

  it('returns 401 response when reacquire fails', async () => {
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
    expect(res.ok).to.equal(false);
    expect(res.status).to.equal(401);
  });
});
