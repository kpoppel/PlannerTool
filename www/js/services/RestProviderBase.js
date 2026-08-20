import { ok, fail } from './result.js';

/** @typedef {{ APP_BASE_URL?: string }} WindowWithBaseUrl */

export class RestProviderBase {
  constructor(options = {}) {
    this._retry = !!options.retry;
    this._session = !!options.session;
    this._networkRetryCount = Number.isInteger(options.networkRetryCount)
      ? options.networkRetryCount
      : 2;
    this._networkRetryDelay = Number.isFinite(options.networkRetryDelay)
      ? options.networkRetryDelay
      : 250;
    this._onSessionExpired =
      typeof options.onSessionExpired === 'function' ? options.onSessionExpired : null;
    this._onNetworkError =
      typeof options.onNetworkError === 'function' ? options.onNetworkError : null;
    this._fetchImpl =
      typeof options.fetchImpl === 'function'
        ? options.fetchImpl
        : (url, init) => fetch(url, init);
    this._defaultCredentials = options.defaultCredentials;
    this._baseUrlProvider =
      typeof options.baseUrlProvider === 'function'
        ? options.baseUrlProvider
        : () => {
            const win = /** @type {WindowWithBaseUrl|undefined} */ (
              typeof window !== 'undefined' ? window : undefined
            );
            if (win && win.APP_BASE_URL) {
              return win.APP_BASE_URL;
            }
            return '';
          };
  }

  _resolveUrl(url) {
    if (typeof url !== 'string') {
      return url;
    }
    if (url.startsWith('/')) {
      return `${this._baseUrlProvider() || ''}${url}`;
    }
    return url;
  }

  /**
   * @param {HeadersInit|undefined} extra
   * @returns {Record<string, string>}
   */
  _headers(extra = undefined) {
    const headers = /** @type {Record<string, string>} */ (Object.assign({}, extra || {}));
    if (!headers.Accept) {
      headers.Accept = 'application/json';
    }
    return headers;
  }

  async _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async _recoverSession(context) {
    if (!this._session || !this._onSessionExpired) {
      return false;
    }
    try {
      return !!(await this._onSessionExpired(context));
    } catch {
      return false;
    }
  }

  /**
   * @param {RequestInit} [options]
   * @returns {RequestInit}
   */
  _buildFetchOptions(options = {}) {
    const out = /** @type {RequestInit} */ ({ ...options });
    out.headers = this._headers(options.headers);
    if (this._defaultCredentials && out.credentials == null) {
      out.credentials = this._defaultCredentials;
    }
    return out;
  }

  async _fetch(url, options = {}, retryAttempt = 0, allowSessionRecovery = true) {
    const resolvedUrl = this._resolveUrl(url);
    const fetchOptions = this._buildFetchOptions(options);

    try {
      const response = await this._fetchImpl(resolvedUrl, fetchOptions);

      if (allowSessionRecovery && response && response.status === 401) {
        const recovered = await this._recoverSession({
          url: resolvedUrl,
          options: fetchOptions,
          response,
        });
        if (recovered) {
          // Retry through the shared base path once recovery succeeds.
          // Recovery is disabled on this retry to avoid infinite 401 loops.
          return this._fetch(resolvedUrl, fetchOptions, retryAttempt, false);
        }
      }

      return response;
    } catch (err) {
      if (this._retry && retryAttempt < this._networkRetryCount) {
        const delay = this._networkRetryDelay * Math.pow(2, retryAttempt);
        await this._sleep(delay);
        return this._fetch(url, options, retryAttempt + 1, allowSessionRecovery);
      }

      if (this._onNetworkError) {
        await this._onNetworkError(err, {
          url: resolvedUrl,
          options: fetchOptions,
          retryAttempt,
        });
      }

      throw err;
    }
  }

  async _fetchJson(url, options = {}) {
    try {
      const response = await this._fetch(url, options);
      if (!response || typeof response.ok !== 'boolean') {
        return fail({ message: 'Invalid response object' });
      }

      let payload = null;
      let parsed = false;
      if (typeof response.json === 'function') {
        try {
          payload = await response.json();
          parsed = true;
        } catch (err) {
          if (response.ok) {
            return fail({
              message: 'Invalid JSON response',
              status: response.status,
              cause: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      if (!response.ok) {
        const detail = parsed ? payload : null;
        const detailRecord = /** @type {any} */ (detail);
        const code = detailRecord && (detailRecord.error || detailRecord.code)
          ? detailRecord.error || detailRecord.code
          : undefined;
        return fail({
          message: `HTTP ${response.status}`,
          status: response.status,
          code,
          detail,
        });
      }

      return ok(parsed ? payload : null);
    } catch (err) {
      return fail(err);
    }
  }
}
