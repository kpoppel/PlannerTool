import { describe, it, expect, vi } from 'vitest';
import { RestProviderBase } from '../../www/js/services/RestProviderBase.js';
import { createAuthRecovery } from '../../www/js/services/authRecovery.js';

function response({ ok = true, status = 200, jsonData = null, jsonThrows = false } = {}) {
  return {
    ok,
    status,
    json: vi.fn(async () => {
      if (jsonThrows) {
        throw new Error('bad json');
      }
      return jsonData;
    }),
  };
}

describe('RestProviderBase', () => {
  it('uses injected recovery handlers without selecting a login or credential implementation', async () => {
    const denied = new Response(JSON.stringify({ error: 'interaction_required' }), { status: 403 });
    const fetchImpl = vi.fn().mockResolvedValue(denied);
    const onCredentialFailure = vi.fn().mockResolvedValue(true);
    const onSessionExpired = vi.fn();
    const onResponse = vi.fn();
    const base = new RestProviderBase({
      fetchImpl, session: true, onCredentialFailure, onSessionExpired, onResponse,
    });

    expect(await base._fetch('/api/custom', { method: 'POST' })).toBe(denied);
    expect(onCredentialFailure).toHaveBeenCalledWith(denied, expect.objectContaining({
      url: '/api/custom', options: expect.objectContaining({ method: 'POST' }),
    }));
    expect(onResponse).toHaveBeenCalledWith(denied, expect.objectContaining({
      credentialFailure: true,
    }));
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('shares one session recovery and resets after success=%s', async (success) => {
    let finishRecovery;
    const pending = new Promise((resolve, reject) => {
      finishRecovery = () => {
        if (success) resolve();
        else reject(new Error('Renewal unavailable'));
      };
    });
    const acquireSession = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const onSessionError = vi.fn();
    const recovery = createAuthRecovery({ acquireSession, onSessionError });
    const first = recovery.onSessionExpired({ url: '/api/tasks' });
    const second = recovery.onSessionExpired({ url: '/api/cost' });

    expect(acquireSession).toHaveBeenCalledTimes(1);
    finishRecovery();
    expect(await Promise.all([first, second])).toEqual([success, success]);
    expect(onSessionError).toHaveBeenCalledTimes(success ? 0 : 1);
    expect(await recovery.onSessionExpired({ url: '/api/tasks' })).toBe(true);
    expect(acquireSession).toHaveBeenCalledTimes(2);
  });

  it('does not share recovery state between coordinators', async () => {
    const acquireFirst = vi.fn().mockResolvedValue(undefined);
    const acquireSecond = vi.fn().mockResolvedValue(undefined);
    const first = createAuthRecovery({ acquireSession: acquireFirst });
    const second = createAuthRecovery({ acquireSession: acquireSecond });

    expect(await Promise.all([
      first.onSessionExpired({}), second.onSessionExpired({}),
    ])).toEqual([true, true]);
    expect(acquireFirst).toHaveBeenCalledTimes(1);
    expect(acquireSecond).toHaveBeenCalledTimes(1);
  });

  it('reports PAT failures without waiting for repair or replaying the request', async () => {
    const onPatRequired = vi.fn(() => new Promise(() => {}));
    const onResponse = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'pat_required' }), { status: 403 }));
    const recovery = createAuthRecovery({ notifyCredential: onPatRequired });
    const base = new RestProviderBase({ fetchImpl, ...recovery, onResponse, session: true });

    const response = await base._fetch('/api/tasks');

    expect(response.status).toBe(403);
    expect(onPatRequired).toHaveBeenCalledWith('pat_required');
    expect(onResponse).toHaveBeenCalledWith(response, expect.objectContaining({
      credentialFailure: true,
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not replay a write after PAT repair or open repair for permission denials', async () => {
    const onPatRequired = vi.fn().mockResolvedValue(true);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'pat_invalid' }), { status: 403 }),
    );
    const recovery = createAuthRecovery({ notifyCredential: onPatRequired });
    const base = new RestProviderBase({ fetchImpl, ...recovery });
    await base._fetch('/api/tasks', { method: 'POST' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onPatRequired).toHaveBeenCalledTimes(1);
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ error: 'access_denied' }), { status: 403 }));
    await base._fetch('/admin/check');
    expect(onPatRequired).toHaveBeenCalledTimes(1);
  });

  it('observes only the final response after session recovery', async () => {
    const finalResponse = response({ jsonData: { ok: true } });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ ok: false, status: 401 }))
      .mockResolvedValueOnce(finalResponse);
    const onResponse = vi.fn();
    const base = new RestProviderBase({ session: true, fetchImpl, onResponse,
      onSessionExpired: vi.fn().mockResolvedValue(true) });

    await base._fetch('/api/tasks');

    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(onResponse).toHaveBeenCalledWith(finalResponse, expect.objectContaining({ url: '/api/tasks' }));
  });

  it('does not retry a completed write when its response observer fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response());
    const base = new RestProviderBase({ retry: true, fetchImpl,
      onResponse: vi.fn().mockRejectedValue(new Error('Observer failed')) });

    await expect(base._fetch('/api/tasks', { method: 'POST' })).rejects.toThrow('Observer failed');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves absolute URLs with configured base URL provider', () => {
    const base = new RestProviderBase({ baseUrlProvider: () => '/root' });
    expect(base._resolveUrl('/api/health')).toBe('/root/api/health');
    expect(base._resolveUrl('https://example.com/x')).toBe('https://example.com/x');
  });

  it('adds Accept header and preserves explicit Accept values', () => {
    const base = new RestProviderBase();
    expect(base._headers({})).toEqual({ Accept: 'application/json' });
    expect(base._headers({ Accept: 'text/plain', Foo: 'bar' })).toEqual({
      Accept: 'text/plain',
      Foo: 'bar',
    });
  });

  it('applies default credentials and resolved URL in fetch options', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true, status: 200, jsonData: { ok: true } }));
    const base = new RestProviderBase({
      fetchImpl,
      defaultCredentials: 'same-origin',
      baseUrlProvider: () => '/root',
    });

    await base._fetch('/api/test', { method: 'GET' });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/root/api/test',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
    );
  });

  it('retries network errors when retry mode is enabled', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(response({ ok: true, status: 200, jsonData: { ok: true } }));

    const base = new RestProviderBase({
      retry: true,
      networkRetryCount: 1,
      networkRetryDelay: 0,
      fetchImpl,
    });

    const out = await base._fetch('/api/test', {});
    expect(out.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws network errors without retry when retry mode is disabled', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const base = new RestProviderBase({ retry: false, fetchImpl });

    await expect(base._fetch('/api/test', {})).rejects.toThrow('network down');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('calls session-recovery hook and retries once on 401 when enabled', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: false, status: 401, jsonData: { error: 'invalid_session' } }))
      .mockResolvedValueOnce(response({ ok: true, status: 200, jsonData: { value: 42 } }));

    const onSessionExpired = vi.fn().mockResolvedValue(true);

    const base = new RestProviderBase({
      session: true,
      fetchImpl,
      onSessionExpired,
    });

    const out = await base._fetch('/api/secured', {});
    expect(out.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('does not replay %s after successful session recovery', async (method) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: false, status: 401, jsonData: { error: 'invalid_session' } }))
      .mockResolvedValueOnce(response({ ok: true, status: 200, jsonData: { saved: true } }));
    const onSessionExpired = vi.fn().mockResolvedValue(true);
    const base = new RestProviderBase({ session: true, fetchImpl, onSessionExpired });
    const options = { method, body: JSON.stringify({ title: 'New task' }) };

    await base._fetch('/api/tasks', options);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toEqual(expect.objectContaining(options));
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('does not retry ambiguous %s network failures', async (method) => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Connection lost'));
    const base = new RestProviderBase({ retry: true, fetchImpl });
    await expect(base._fetch('/api/tasks', { method })).rejects.toThrow('Connection lost');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('allows individual reads to prohibit replay without leaking policy into fetch', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Connection lost'));
    const base = new RestProviderBase({ retry: true, fetchImpl });
    await expect(base._fetch('/api/tasks', { safeRead: false })).rejects.toThrow('Connection lost');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('safeRead');
  });

  it('does not retry 401 when session recovery hook returns false', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response({ ok: false, status: 401, jsonData: { error: 'invalid_session' } }));

    const onSessionExpired = vi.fn().mockResolvedValue(false);

    const base = new RestProviderBase({
      session: true,
      fetchImpl,
      onSessionExpired,
    });

    const out = await base._fetch('/api/secured', {});
    expect(out.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('fetchJson returns ok result for success payloads', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true, status: 200, jsonData: { x: 1 } }));
    const base = new RestProviderBase({ fetchImpl });

    await expect(base._fetchJson('/api/data')).resolves.toEqual({ ok: true, data: { x: 1 } });
  });

  it('fetchJson returns fail result for non-OK responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response({ ok: false, status: 404, jsonData: { error: 'missing' } }));
    const base = new RestProviderBase({ fetchImpl });

    await expect(base._fetchJson('/api/data')).resolves.toEqual({
      ok: false,
      error: {
        message: 'HTTP 404',
        status: 404,
        code: 'missing',
        detail: { error: 'missing' },
      },
    });
  });

  it('fetchJson preserves status + detail when non-OK response has invalid JSON body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response({ ok: false, status: 500, jsonThrows: true }));
    const base = new RestProviderBase({ fetchImpl });

    await expect(base._fetchJson('/api/data')).resolves.toEqual({
      ok: false,
      error: {
        message: 'HTTP 500',
        status: 500,
        code: undefined,
        detail: null,
      },
    });
  });

  it('fetchJson returns fail result on malformed success JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response({ ok: true, status: 200, jsonThrows: true }));
    const base = new RestProviderBase({ fetchImpl });

    const out = await base._fetchJson('/api/data');
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('Invalid JSON response');
    expect(out.error.status).toBe(200);
  });

  it('fetchJson calls network error hook after retries are exhausted', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const onNetworkError = vi.fn();
    const base = new RestProviderBase({
      retry: true,
      networkRetryCount: 1,
      networkRetryDelay: 0,
      fetchImpl,
      onNetworkError,
    });

    const out = await base._fetchJson('/api/data');
    expect(out.ok).toBe(false);
    expect(onNetworkError).toHaveBeenCalledTimes(1);
  });
});
