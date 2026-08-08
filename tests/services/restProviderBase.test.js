import { describe, it, expect, vi } from 'vitest';
import { RestProviderBase } from '../../www/js/services/RestProviderBase.js';

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
