function cloneObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

export function normalizeError(err) {
  if (err == null) {
    return { message: 'Unknown error' };
  }

  if (typeof err === 'string') {
    return { message: err };
  }

  if (err instanceof Error) {
    const out = { message: err.message || 'Unknown error' };
    if (err.status != null) out.status = err.status;
    if (err.code != null) out.code = err.code;
    if (err.cause != null) out.cause = err.cause;
    return out;
  }

  if (typeof err === 'object') {
    const out = cloneObject(err);
    if (!out.message) {
      out.message = typeof out.error === 'string' ? out.error : 'Unknown error';
    }
    return out;
  }

  return { message: String(err) };
}

export function ok(data) {
  return { ok: true, data };
}

export function fail(error) {
  return { ok: false, error: normalizeError(error) };
}

export async function asResult(promiseFn) {
  try {
    const data = await promiseFn();
    return ok(data);
  } catch (err) {
    return fail(err);
  }
}

export function dataOr(result, fallback) {
  if (!result || result.ok !== true) {
    return fallback;
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'data')) {
    return fallback;
  }
  return result.data;
}
