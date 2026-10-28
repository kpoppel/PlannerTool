import { expect } from '@esm-bundle/chai';
import { server } from '../msw/server.js';
import { http, HttpResponse } from 'msw';
import { vi, it as itVitest, expect as expectVitest } from 'vitest';
import { ProviderREST } from '../../www/js/services/providerREST.js';
import { showAuthDialog } from '../../www/js/components/AuthDialog.lit.js';
import { bus } from '../../www/js/core/EventBus.js';
import { SessionEvents } from '../../www/js/core/EventRegistry.js';
import { dataService } from '../../www/js/services/dataService.js';
import { createAuthClient, createBrokerHttpAdapter, AUTH_DECISIONS } from '../../www/js/services/authClient.js';
import { createMockAuth, MOCK_ACCOUNT, OTHER_MOCK_ACCOUNT, AUTH_SCENARIOS } from '../helpers/mockAuth.js';
import { AdminProviderREST } from '../../www/admin/js/services/providerREST.js';
import { store } from '../../www/js/application/store.js';

vi.mock('../../www/js/components/AuthDialog.lit.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    showAuthDialog: vi.fn().mockResolvedValue(undefined),
  };
});

describe('ProviderREST /api/session tests', () => {
  it('composes one discovered client and binds app/admin providers before use', async () => {
    const { initializeAuthentication, getAuthentication } = await import('../../www/js/services/authStartup.js');
    const state = createMockAuth('entra_signed_in').state;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(state)));
    const [authentication, shared] = await Promise.all([
      initializeAuthentication('/api', { fetchImpl, presentLogin: vi.fn() }),
      initializeAuthentication('/api', { fetchImpl, presentLogin: vi.fn() }),
    ]);
    expectVitest(shared).toBe(authentication);
    expectVitest(getAuthentication()).toBe(authentication);
    expectVitest(fetchImpl.mock.calls.map(call => call[0])).toEqual(['/api/auth/config', '/api/auth/me']);
    const app = new ProviderREST();
    const admin = new AdminProviderREST();
    app.setAuthentication(authentication);
    admin.setAuthentication(authentication);
    expectVitest(app._authentication).toBe(admin._authentication);
    expectVitest(authentication.blocked).toBe(false);
    expectVitest(() => admin.setAuthentication(createMockAuth('entra_signed_in')))
      .toThrow('Authentication source changed');
  });

  it('shares single-flight recovery across app and admin for one client', async () => {
    const state = createMockAuth('entra_signed_in').state;
    const signIn = vi.fn(async () => state);
    const authentication = createAuthClient({ initialState: state, instance: '/team_1',
      adapter: { signIn }, onAccountChanged: vi.fn() });
    const app = new ProviderREST({ authentication });
    const admin = new AdminProviderREST({ authentication });
    for (const provider of [app, admin]) {
      provider._fetchImpl = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'session_expired' }), { status: 401 }))
        .mockResolvedValueOnce(new Response('{}'));
    }
    const results = await Promise.all([app._fetch('/api/tasks'), admin._fetch('/admin/check')]);
    expectVitest(results.every(result => result.ok)).toBe(true);
    expectVitest(signIn).toHaveBeenCalledTimes(1);
    expectVitest(authentication.generation).toBe(0);
  });

  itVitest.each([ProviderREST, AdminProviderREST])('fences switched accounts and stale responses in %s', async Provider => {
    const invalidate = vi.fn();
    const authentication = createMockAuth('entra_signed_in', { onAccountChanged: invalidate });
    const provider = new Provider({ authentication });
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    provider._fetchImpl = vi.fn().mockReturnValueOnce(pending);
    const stale = provider._fetch('/api/tasks');
    authentication.setSignInOutcome({ account: OTHER_MOCK_ACCOUNT });
    expectVitest(await authentication.recover()).toBe(false);
    finish(new Response('{}'));
    await expectVitest(stale).rejects.toMatchObject({ code: 'account_changed' });
    await expectVitest(provider._fetch('/api/tasks')).rejects.toMatchObject({ code: 'account_changed' });
    expectVitest(provider._fetchImpl).toHaveBeenCalledTimes(1);
    expectVitest(invalidate).toHaveBeenCalledTimes(1);
  });

  itVitest.each([ProviderREST, AdminProviderREST])('preserves partial write results in %s', async Provider => {
    const provider = new Provider({ authentication: createMockAuth('entra_signed_in') });
    const partial = { ok: false, updated: ['synthetic-task-1'], errors: ['synthetic-task-2 denied'] };
    provider._fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(partial)));
    const result = await provider._requestJson('/api/tasks', { method: 'POST' });
    expectVitest(result).toEqual({ ok: true, data: partial });
    expectVitest(provider._fetchImpl).toHaveBeenCalledTimes(1);
  });

  itVitest.each([ProviderREST, AdminProviderREST])('does not repair backend denial, outage or interaction automatically in %s', async Provider => {
    const authentication = createMockAuth('entra_signed_in');
    const recover = vi.spyOn(authentication, 'recover');
    const provider = new Provider({ authentication });
    for (const code of ['access_denied', 'auth_unavailable', 'interaction_required']) {
      provider._fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: code }), {
        status: AUTH_DECISIONS[code].status,
      }));
      await provider._fetch('/api/tasks');
      expectVitest(provider._fetchImpl).toHaveBeenCalledTimes(1);
      expectVitest(authentication.state.account).toEqual(MOCK_ACCOUNT);
    }
    expectVitest(recover).not.toHaveBeenCalled();
    expectVitest(authentication.state.capabilities.reauthenticate).toBe(true);
  });
  itVitest.each([ProviderREST, AdminProviderREST])('notifies fake ADO credentials without changing login or replaying in %s', async Provider => {
    const state = createMockAuth('entra_signed_in').state;
    const signIn = vi.fn();
    const authentication = createAuthClient({ initialState: state, instance: '/team_1',
      adapter: { signIn }, onAccountChanged: vi.fn() });
    const provider = new Provider({ authentication });
    for (const method of ['GET', 'POST']) {
      provider._fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        error: 'ado_credential_unusable',
      }), { status: 403 }));
      const response = await provider._fetch('/api/tasks', { method });
      expectVitest(response.status).toBe(403);
      expectVitest(provider._fetchImpl).toHaveBeenCalledTimes(1);
      expectVitest(authentication.state).toBe(state);
    }
    expectVitest(signIn).not.toHaveBeenCalled();
    expectVitest(store.getState().notifications.some(notification =>
      notification.code === 'ado_credential_unusable'
      && notification.message.includes('No Azure DevOps request was sent.')
    )).toBe(true);
  });

  itVitest.each(Object.keys(AUTH_SCENARIOS).filter(name => AUTH_SCENARIOS[name].mode === 'broker'))('uses the shared client contract for %s mocks and HTTP', async scenario => {
    const mock = createMockAuth(scenario);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(mock.state)));
    const adapter = createBrokerHttpAdapter({ apiUrl: '/team_1/api', fetchImpl,
      presentLogin: async () => ({ code: 'one-use-fixture', state: 'browser-bound-fixture' }) });
    const client = createAuthClient({ adapter, initialState: mock.state,
      instance: '/team_1', onAccountChanged: vi.fn() });
    expectVitest(await client.status()).toEqual(mock.state);
    expectVitest(fetchImpl).toHaveBeenCalledWith('/team_1/api/auth/me', expectVitest.objectContaining({
      credentials: 'same-origin', method: 'GET',
    }));
    expectVitest(await client.discover()).toEqual(mock.state);
  });

  it('shares same-account repair without changing drafts, and fences a different returning UUID', async () => {
    const drafts = { title: 'Unsubmitted work' };
    const invalidate = vi.fn(async () => { delete drafts.title; });
    const client = createMockAuth('interaction_required', { onAccountChanged: invalidate });
    expectVitest(await Promise.all([client.recover(), client.recover()])).toEqual([true, true]);
    expectVitest(drafts.title).toBe('Unsubmitted work');
    client.setSignInOutcome({ account: OTHER_MOCK_ACCOUNT });
    expectVitest(await client.recover()).toBe(false);
    expectVitest(invalidate).toHaveBeenCalledWith({ previous: MOCK_ACCOUNT, next: OTHER_MOCK_ACCOUNT });
    expectVitest(drafts).toEqual({});
    expectVitest(client.blocked).toBe(true);
  });

  it('invalidates old work when signing in without a known previous identity', async () => {
    const invalidate = vi.fn();
    const client = createMockAuth('session_expired', { onAccountChanged: invalidate });
    client.setSignInOutcome({ account: OTHER_MOCK_ACCOUNT });
    expectVitest(await client.recover()).toBe(false);
    expectVitest(invalidate).toHaveBeenCalledWith({ previous: null, next: OTHER_MOCK_ACCOUNT });
    expectVitest(client.blocked).toBe(true);
  });

  it('supports HTTP begin/complete, cancellation and logout without retrying writes', async () => {
    const state = createMockAuth('entra_signed_in').state;
    const fetchImpl = vi.fn(async url => new Response(JSON.stringify(
      url.endsWith('/begin') ? { transaction: 'synthetic' } : state)));
    const presentLogin = vi.fn().mockResolvedValueOnce(false)
      .mockResolvedValueOnce({ code: 'synthetic', state: 'browser-bound' });
    const adapter = createBrokerHttpAdapter({ apiUrl: '/team_1/api', fetchImpl, presentLogin });
    expectVitest(await adapter.signIn()).toBe(false);
    expectVitest(fetchImpl).toHaveBeenCalledTimes(1);
    expectVitest(await adapter.signIn()).toEqual(state);
    expectVitest(fetchImpl.mock.calls[2][0]).toBe('/team_1/api/auth/login/complete');
    await adapter.logout();
    expectVitest(fetchImpl.mock.calls[3][0]).toBe('/team_1/api/auth/logout');
  });

  it('reads status without redeeming again after a server-completed popup', async () => {
    const state = createMockAuth('entra_signed_in').state;
    const fetchImpl = vi.fn(async url => new Response(JSON.stringify(
      url.endsWith('/begin') ? { state: 'bound-state' } : state)));
    const adapter = createBrokerHttpAdapter({ apiUrl: '/api', fetchImpl,
      presentLogin: async () => ({ completed: true }) });
    expectVitest(await adapter.signIn()).toEqual(state);
    expectVitest(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      '/api/auth/login/begin', '/api/auth/me',
    ]);
  });

  it('links an existing account once and invalidates the previous browser account context', async () => {
    const state = createMockAuth('entra_signed_in').state;
    const linked = { ...state, account: OTHER_MOCK_ACCOUNT };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(linked)));
    const onAccountChanged = vi.fn();
    const adapter = createBrokerHttpAdapter({ apiUrl: '/team_1/api', fetchImpl, presentLogin: vi.fn() });
    const client = createAuthClient({ adapter, initialState: state, instance: '/team_1', onAccountChanged });
    await client.linkAccount('sam@example.com');
    expectVitest(fetchImpl).toHaveBeenCalledTimes(1);
    expectVitest(fetchImpl).toHaveBeenCalledWith('/team_1/api/auth/links/claim', expectVitest.objectContaining({
      method: 'POST', body: JSON.stringify({ email: 'sam@example.com' }), credentials: 'same-origin',
    }));
    expectVitest(onAccountChanged).toHaveBeenCalledWith({ previous: state.account, next: OTHER_MOCK_ACCOUNT });
    expectVitest(client.blocked).toBe(true);
  });

  it('rejects a PAT response in the Entra HTTP adapter instead of selecting PAT', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(createMockAuth('pat_current').state)));
    const adapter = createBrokerHttpAdapter({ apiUrl: '/api', fetchImpl, presentLogin: vi.fn() });
    await expectVitest(adapter.status()).rejects.toThrow('incompatible authentication mode');
  });

  itVitest.each(Object.entries(AUTH_DECISIONS))('freezes typed HTTP decision %s', async (code, decision) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: code }), { status: decision.status }));
    const adapter = createBrokerHttpAdapter({ apiUrl: '/api', fetchImpl, presentLogin: vi.fn() });
    await expectVitest(adapter.status()).rejects.toMatchObject({ code, ...decision });
    expectVitest(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('notifies account changes but not renewal for the same account', async () => {
    const invalidate = vi.fn();
    const provider = new ProviderREST({ onAccountChanged: invalidate });
    const emit = vi.spyOn(bus, 'emit');
    const fetch = vi.spyOn(provider, '_fetch');
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ email: 'first@example.com' })));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ email: 'first@example.com' })));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ email: 'second@example.com' })));
    try {
      await provider.acquireSession();
      emit.mockClear();
      await provider.acquireSession();
      expectVitest(emit).not.toHaveBeenCalledWith(SessionEvents.CHANGED);
      await provider.acquireSession();
      expectVitest(emit).toHaveBeenCalledWith(SessionEvents.CHANGED);
      expectVitest(invalidate).toHaveBeenCalledWith({ previous: 'first@example.com', next: 'second@example.com' });
      await expectVitest(provider._fetch('/api/tasks')).rejects.toMatchObject({ code: 'account_changed' });
    } finally {
      emit.mockRestore();
      fetch.mockRestore();
    }
  });

  itVitest.each(['signOut', 'deleteAccount'])('notifies after successful %s', async (method) => {
    const provider = new ProviderREST();
    const emit = vi.spyOn(bus, 'emit');
    const fetch = vi.spyOn(provider, '_fetch').mockResolvedValue(new Response('{}'));
    try {
      await provider[method]('user@example.com', 'synthetic-key');
      expectVitest(emit).toHaveBeenCalledWith(SessionEvents.CHANGED);
    } finally {
      emit.mockRestore();
      fetch.mockRestore();
    }
  });

  it('preserves failed group fetch Results instead of treating them as empty groups', async () => {
    const list = vi.spyOn(dataService.providers.rest, 'listGroups').mockResolvedValue({
      ok: false, error: { message: 'Group fetch failed' },
    });
    try {
      await expectVitest(dataService.listGroups()).resolves.toEqual({
        ok: false, error: { message: 'Group fetch failed' },
      });
    } finally {
      list.mockRestore();
    }
  });

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
    server.use(
      http.post('/api/session', () =>
        HttpResponse.json({ detail: 'Device authentication required' }, { status: 401 })),
      http.get('/api/auth/me', () => HttpResponse.json({ email: 'enrolled@example.com' })),
    );

    await new ProviderREST().init();

    expect(vi.mocked(showAuthDialog).mock.calls.length).to.equal(1);
  });

  itVitest.each(['entra_signed_in', 'entra_signed_out'])('rejects late login completion after logout from %s', async scenario => {
    const state = createMockAuth(scenario).state;
    let complete;
    const adapter = {
      signIn: () => new Promise(resolve => { complete = resolve; }),
      logout: async () => createMockAuth('entra_signed_out').state,
    };
    const client = createAuthClient({ adapter, initialState: state,
      instance: '/team_1', onAccountChanged: vi.fn() });
    const pending = client.signIn();
    await client.logout();
    complete(state);
    await expectVitest(pending).rejects.toThrow('Stale authentication response');
    expectVitest(client.state.account).toBeNull();
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
