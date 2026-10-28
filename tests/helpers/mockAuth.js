import { createAuthClient } from '../../www/js/services/authClient.js';

export const MOCK_ACCOUNT = Object.freeze({
  uuid: '00000000-0000-4000-8000-000000000001',
  email: 'alex@example.com',
  name: 'Alex Example',
});

export const OTHER_MOCK_ACCOUNT = Object.freeze({
  uuid: '00000000-0000-4000-8000-000000000002',
  email: 'sam@example.com',
  name: 'Sam Example',
});

export const AUTH_SCENARIOS = Object.freeze({
  pat_current: { mode: 'pat', status: 'connected' },
  pat_missing: { mode: 'pat', status: 'pat_required' },
  pat_invalid: { mode: 'pat', status: 'pat_invalid' },
  local: { mode: 'local', status: 'connected' },
  entra_signed_out: { mode: 'broker', status: 'signed_out' },
  entra_signed_in: { mode: 'broker', status: 'connected' },
  session_expired: { mode: 'broker', status: 'session_expired' },
  interaction_required: { mode: 'broker', status: 'interaction_required' },
  access_denied: { mode: 'broker', status: 'access_denied' },
  unavailable: { mode: 'broker', status: 'unavailable' },
});

export function createMockAuth(scenario, options = {}) {
  const listeners = new Set();
  let state;
  let signInOutcome = {};
  const model = {
    get state() { return state; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select(name) {
      if (!Object.hasOwn(AUTH_SCENARIOS, name)) throw new Error(`Unknown auth scenario: ${name}`);
      const { mode, status } = AUTH_SCENARIOS[name];
      const signedIn = !['signed_out', 'session_expired'].includes(status);
      state = Object.freeze({
        mode, status, account: signedIn ? MOCK_ACCOUNT : null,
        capabilities: Object.freeze({
          pat: mode === 'pat', enrollment: mode !== 'broker',
          reauthenticate: mode === 'broker' && status === 'interaction_required',
          logout: signedIn, deleteAccount: signedIn,
        }),
      });
      for (const listener of listeners) listener();
    },
    setSignInOutcome(outcome) { signInOutcome = outcome; },
    async signIn({ cancelled = false, account = MOCK_ACCOUNT } = signInOutcome) {
      if (cancelled) return false;
      state = Object.freeze({ ...state, status: 'connected', account,
        capabilities: Object.freeze({ ...state.capabilities,
          reauthenticate: false, logout: true, deleteAccount: true }) });
      for (const listener of listeners) listener();
      return true;
    },
    async saveSettings({ pat }) {
      if (state.capabilities.pat && pat !== '') {
        state = Object.freeze({ ...state, status: 'connected' });
        for (const listener of listeners) listener();
      }
      return { ok: true };
    },
    async logout() {
      state = Object.freeze({ ...state, status: 'signed_out', account: null,
        capabilities: Object.freeze({ ...state.capabilities,
          reauthenticate: false, logout: false, deleteAccount: false }) });
      for (const listener of listeners) listener();
    },
    async deleteAccount() { await model.logout(); },
  };
  model.select(scenario);
  const select = model.select;
  const signIn = model.signIn;
  const logout = model.logout;
  const deleteAccount = model.deleteAccount;
  let client;
  const resetClient = () => createAuthClient({
    initialState: model.state,
    instance: 'mock-instance',
    onAccountChanged: options.onAccountChanged === undefined ? async () => {} : options.onAccountChanged,
    adapter: {
      discover: async () => ({ mode: model.state.mode, capabilities: model.state.capabilities }),
      status: async () => model.state,
      signIn: async outcome => await signIn(outcome) ? model.state : false,
      completeLogin: async outcome => await signIn(outcome) ? model.state : false,
      saveSettings: async settings => {
        const result = await model.saveSettings(settings);
        await client.status();
        return result;
      },
      logout: async () => { await logout(); return model.state; },
      deleteAccount: async () => { await deleteAccount(); return model.state; },
    },
  });
  client = resetClient();
  model.select = name => { select(name); client = resetClient(); };
  model.signIn = outcome => client.signIn(outcome);
  model.recover = () => client.recover();
  model.discover = () => client.discover();
  model.status = () => client.status();
  model.completeLogin = completion => client.completeLogin(completion);
  model.handleDecision = async code => {
    await client.handleDecision(code);
    state = client.state;
    for (const listener of listeners) listener();
  };
  Object.defineProperties(model, {
    instance: { get: () => client.instance },
    generation: { get: () => client.generation },
    blocked: { get: () => client.blocked },
  });
  return model;
}