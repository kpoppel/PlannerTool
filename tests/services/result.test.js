import { describe, it, expect } from 'vitest';
import { ok, fail, asResult, dataOr, normalizeError } from '../../www/js/services/result.js';

describe('result helpers', () => {
  it('ok wraps successful data', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
  });

  it('fail normalizes string and object errors', () => {
    expect(fail('boom')).toEqual({ ok: false, error: { message: 'boom' } });
    expect(fail({ message: 'bad', status: 400 })).toEqual({
      ok: false,
      error: { message: 'bad', status: 400 },
    });
  });

  it('normalizeError extracts Error fields', () => {
    const err = new Error('failure');
    err.status = 503;
    err.code = 'UNAVAILABLE';

    expect(normalizeError(err)).toEqual({
      message: 'failure',
      status: 503,
      code: 'UNAVAILABLE',
    });
  });

  it('normalizeError handles null and non-object values', () => {
    expect(normalizeError(null)).toEqual({ message: 'Unknown error' });
    expect(normalizeError(undefined)).toEqual({ message: 'Unknown error' });
    expect(normalizeError(42)).toEqual({ message: '42' });
    expect(normalizeError(false)).toEqual({ message: 'false' });
  });

  it('asResult resolves and catches', async () => {
    await expect(asResult(async () => 123)).resolves.toEqual({ ok: true, data: 123 });
    await expect(
      asResult(async () => {
        throw new Error('x');
      })
    ).resolves.toEqual({ ok: false, error: { message: 'x' } });
  });

  it('asResult catches synchronous throws', async () => {
    await expect(
      asResult(() => {
        throw new Error('sync boom');
      })
    ).resolves.toEqual({ ok: false, error: { message: 'sync boom' } });
  });

  it('dataOr unwraps success and applies fallback on failure', () => {
    expect(dataOr({ ok: true, data: [1, 2] }, [])).toEqual([1, 2]);
    expect(dataOr({ ok: false, error: { message: 'x' } }, [])).toEqual([]);
    expect(dataOr(null, 'fallback')).toBe('fallback');
    expect(dataOr(undefined, 'fallback')).toBe('fallback');
    expect(dataOr({ ok: true }, 'fallback')).toBe('fallback');
    expect(dataOr({ ok: true, payload: 1 }, 'fallback')).toBe('fallback');
  });
});
