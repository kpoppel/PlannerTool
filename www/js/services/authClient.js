export const AUTH_DECISIONS = Object.freeze({
  session_expired: { status: 401, action: 'login' },
  invalid_session: { status: 401, action: 'login' },
  interaction_required: { status: 409, action: 'reauthenticate' },
  access_denied: { status: 403, action: 'none' },
  ado_credential_unusable: { status: 403, action: 'none' },
  auth_unavailable: { status: 503, action: 'none' },
  auth_configuration_error: { status: 503, action: 'none' },
  pat_required: { status: 403, action: 'set_pat' },
  pat_invalid: { status: 403, action: 'set_pat' },
});

export async function resetAccountContext(_context) {
  const { ProviderLocalStorage } = await import('./providerLocalStorage.js');
  await new ProviderLocalStorage().clearBrowserData();
  window.location.reload();
}

export function createAuthClient({ adapter, initialState, instance, onAccountChanged = resetAccountContext }) {
  const listeners = new Set();
  let state = initialState;
  let generation = 0;
  let recovery = null;
  let blocked = false;
  const client = {
    instance,
    get state() { return state; },
    get generation() { return generation; },
    get blocked() { return blocked; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async handleDecision(code) {
      const decision = AUTH_DECISIONS[code];
      if (decision === undefined) throw new Error(`Unknown authentication decision: ${code}`);
      if (code === 'ado_credential_unusable') return;
      const status = code === 'auth_unavailable' || code === 'auth_configuration_error'
        ? 'unavailable' : code === 'invalid_session' ? 'session_expired' : code;
      await apply({ ...state, status,
        capabilities: { ...state.capabilities, reauthenticate: decision.action === 'reauthenticate' } });
    },
    async status() {
      const started = generation;
      const next = await adapter.status();
      if (started !== generation) throw new Error('Stale authentication response');
      await apply(next);
      return state;
    },
    async signIn(options) {
      const started = generation;
      const next = await adapter.signIn(options);
      if (next === false) return false;
      if (started !== generation) throw new Error('Stale authentication response');
      await apply(next);
      return true;
    },
    async recover() {
      if (blocked) return false;
      if (recovery !== null) return recovery;
      const previous = state.account;
      const previousMode = state.mode;
      const previousGeneration = generation;
      recovery = (async () => {
        const completed = await client.signIn();
        return completed && !blocked && state.mode === previousMode && generation === previousGeneration
          && previous !== null && state.account !== null
          && previous.uuid === state.account.uuid;
      })();
      try { return await recovery; }
      finally { recovery = null; }
    },
    async linkAccount(email) {
      const started = generation;
      const next = await adapter.linkAccount(email);
      if (started !== generation) throw new Error('Stale authentication response');
      await apply(next);
      return state;
    },
    async logout() {
      generation += 1;
      await apply(await adapter.logout());
    },
  };
  async function apply(next) {
    if (next.mode !== initialState.mode) throw new Error('Authentication source changed; reload required');
    if (next.account !== null && typeof next.account.uuid !== 'string') {
      throw new Error('Authentication profile requires an account UUID');
    }
    const changed = state.account === null
      ? next.account !== null
      : next.account === null || state.account.uuid !== next.account.uuid;
    if (changed) {
      generation += 1;
      blocked = true;
      await onAccountChanged({ previous: state.account, next: next.account });
    }
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  return client;
}

export function createBrokerHttpAdapter({ apiUrl, fetchImpl, presentLogin, onLogout = (_state) => {} }) {
  /** @param {string} path @param {string} [method] @param {object} [body] */
  async function request(path, method = 'GET', body = undefined) {
    const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetchImpl(`${apiUrl}/auth/${path}`, options);
    const payload = await response.json();
    if (!response.ok) {
      const decision = AUTH_DECISIONS[payload.error];
      if (decision === undefined || decision.status !== response.status) {
        throw new Error('Invalid authentication decision');
      }
      throw Object.assign(new Error(payload.error), {
        code: payload.error, status: response.status, action: decision.action,
      });
    }
    if (path !== 'login/begin' && payload.mode !== 'broker') {
      throw new Error('Broker adapter received an incompatible authentication mode');
    }
    return payload;
  }
  return {
    status: () => request('me'),
    async signIn() {
      const transaction = await request('login/begin', 'POST');
      const completion = await presentLogin(transaction);
      if (completion === false) return false;
      return request('me');
    },
    linkAccount: email => request('links/claim', 'POST', { email }),
    async logout() {
      const state = await request('logout', 'POST');
      onLogout(state);
      return state;
    },
  };
}
