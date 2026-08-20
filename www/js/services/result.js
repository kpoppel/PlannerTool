/**
 * @param {any} value
 * @returns {Record<string, any>}
 */
function cloneObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

/**
 * @param {any} err
 * @returns {{ message: string, status?: any, code?: any, cause?: any, [key: string]: any }}
 */
export function normalizeError(err) {
  if (err == null) {
    return { message: 'Unknown error' };
  }

  if (typeof err === 'string') {
    return { message: err };
  }

  if (err instanceof Error) {
    /** @type {any} */
    const errAny = err;
    const out = { message: err.message || 'Unknown error' };
    if (errAny.status != null) out.status = errAny.status;
    if (errAny.code != null) out.code = errAny.code;
    if (errAny.cause != null) out.cause = errAny.cause;
    return out;
  }

  if (typeof err === 'object') {
    const out = cloneObject(err);
    if (typeof out.message !== 'string' || out.message.trim() === '') {
      out.message = typeof out.error === 'string' ? out.error : 'Unknown error';
    }
    return /** @type {{ message: string, status?: any, code?: any, cause?: any, [key: string]: any }} */ (out);
  }

  return { message: String(err) };
}

/**
 * @template T
 * @param {T} data
 * @returns {{ ok: true, data: T }}
 */
export function ok(data) {
  return { ok: true, data };
}

/**
 * @param {any} error
 * @returns {{ ok: false, error: ReturnType<typeof normalizeError> }}
 */
export function fail(error) {
  return { ok: false, error: normalizeError(error) };
}

/**
 * @template T
 * @param {() => Promise<T>} promiseFn
 * @returns {Promise<{ ok: true, data: T } | { ok: false, error: ReturnType<typeof normalizeError> }>}
 */
export async function asResult(promiseFn) {
  try {
    const data = await promiseFn();
    return ok(data);
  } catch (err) {
    return fail(err);
  }
}

/**
 * @template T
 * @param {{ ok?: boolean, data?: T }|null|undefined} result
 * @param {T} fallback
 * @returns {T}
 */
export function dataOr(result, fallback) {
  if (!result || result.ok !== true) {
    return fallback;
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'data')) {
    return fallback;
  }
  return result.data === undefined ? fallback : result.data;
}
