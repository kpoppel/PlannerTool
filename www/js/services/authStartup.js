import { AUTH_DECISIONS, createAuthClient, createBrokerHttpAdapter } from './authClient.js';

let authentication = null;
let initialization = null;
let instanceApi = null;

export function takeLogoutNotice() {
  const key = `planner-auth-logout:${window.APP_BASE_URL}`;
  const pending = sessionStorage.getItem(key) === 'pending';
  sessionStorage.removeItem(key);
  return pending;
}

export function getAuthentication() {
  return authentication;
}

export function presentBrowserLogin(transaction) {
  const popup = window.open(transaction.authorization_url, 'planner-auth', 'popup,width=560,height=720');
  if (popup === null) throw new Error('Allow the sign-in popup and try again.');
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closed);
      window.clearTimeout(expiry);
      popup.close();
    };
    const onMessage = event => {
      if (event.origin !== window.location.origin || event.source !== popup) return;
      const message = event.data;
      if (message === null || typeof message !== 'object'
          || message.type !== 'planner-auth-complete' || message.state !== transaction.state
          || message.instance !== window.APP_BASE_URL) return;
      cleanup();
      if (message.error === 'cancelled') resolve(false);
      else if (message.error === null) resolve({ completed: true });
      else {
        const decision = AUTH_DECISIONS[message.error];
        if (decision === undefined) reject(new Error('Invalid sign-in completion'));
        else reject(Object.assign(new Error(message.error), { code: message.error, ...decision }));
      }
    };
    window.addEventListener('message', onMessage);
    const closed = window.setInterval(() => {
      if (popup.closed) { cleanup(); resolve(false); }
    }, 250);
    const expiry = window.setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error('invalid_session'), { code: 'invalid_session' }));
    }, Math.max(0, transaction.expires_at * 1000 - Date.now()));
  });
}

export async function initializeAuthentication(apiUrl, {
  fetchImpl = (url, options) => fetch(url, options),
  presentLogin = presentBrowserLogin,
} = {}) {
  if (initialization !== null) {
    if (apiUrl !== instanceApi) throw new Error('Authentication instance changed; reload required');
    return initialization;
  }
  instanceApi = apiUrl;
  initialization = (async () => {
    const response = await fetchImpl(`${apiUrl}/auth/config`, { credentials: 'same-origin' });
    const config = await response.json();
    if (!response.ok) throw Object.assign(new Error(config.error), { code: config.error });
    if (config.mode === 'pat' || config.mode === 'local') return null;
    if (config.mode !== 'broker') throw new Error('Unsupported authentication mode');
    const adapter = createBrokerHttpAdapter({ apiUrl, presentLogin,
      onLogout: state => {
        if (state.revocation_pending === true) {
          sessionStorage.setItem(`planner-auth-logout:${window.APP_BASE_URL}`, 'pending');
        }
      },
      fetchImpl: (url, options) => fetchImpl(url, {
        ...options, headers: { ...options.headers,
          'X-Planner-Login-Target': window.location.pathname.includes('/admin') ? 'admin' : 'app' },
      }) });
    const initialState = await adapter.status();
    authentication = createAuthClient({ adapter, initialState, instance: window.APP_BASE_URL });
    return authentication;
  })();
  return initialization;
}

export function showAuthenticationStartupFailure(error) {
  const section = document.createElement('section');
  section.setAttribute('role', 'alert');
  const message = document.createElement('p');
  message.textContent = 'Authentication unavailable. Please try again or contact your administrator.';
  const retry = document.createElement('button');
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => window.location.reload());
  section.append(message, retry);
  document.body.appendChild(section);
  console.error('Authentication startup failed', error);
}