// result.js
// Normalized service/provider result helpers.

/**
 * @template T
 * @typedef {{ ok: true, data: T }} ResultOk
 */

/**
 * @typedef {{ ok: false, error: { message: string, code?: string, status?: number, cause?: string } }} ResultErr
 */

/**
 * @template T
 * @typedef {ResultOk<T> | ResultErr} Result
 */

function normalizeError(error, fallbackMessage) {
  if (error && typeof error === 'object') {
    const message =
      typeof error.message === 'string' && error.message.trim() ?
        error.message
      : fallbackMessage;
    const cause = typeof error.error === 'string' ? error.error : undefined;
    const code = typeof error.code === 'string' ? error.code : undefined;
    const status = typeof error.status === 'number' ? error.status : undefined;
    return { message, code, status, ...(cause ? { cause } : {}) };
  }
  if (typeof error === 'string' && error.trim()) {
    return { message: error };
  }
  return { message: fallbackMessage };
}

export function ok(data) {
  return { ok: true, data };
}

export function fail(error, fallbackMessage = 'Request failed') {
  return { ok: false, error: normalizeError(error, fallbackMessage) };
}

export function isResult(value) {
  return !!value && typeof value === 'object' && typeof value.ok === 'boolean';
}

export function asResult(value, opts = {}) {
  const {
    falseIsError = false,
    nullIsError = false,
    undefinedIsError = false,
    message = 'Request failed',
  } = opts;

  if (isResult(value)) return value;

  if (value && typeof value === 'object' && value.ok === false) {
    return fail(value.error || value, message);
  }

  if (falseIsError && value === false) {
    return fail({ message }, message);
  }

  if (nullIsError && value === null) {
    return fail({ message }, message);
  }

  if (undefinedIsError && typeof value === 'undefined') {
    return fail({ message }, message);
  }

  return ok(value);
}

export function dataOr(resultOrValue, fallback) {
  const r = asResult(resultOrValue);
  return r.ok ? r.data : fallback;
}
