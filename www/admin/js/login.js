import { initializeAuthentication, showAuthenticationStartupFailure } from '../../js/services/authStartup.js';
import '../../js/components/AuthStatus.lit.js';

const base = window.APP_BASE_URL;
document.getElementById('planner-link').href = base + '/';

async function checkAccess() {
  const response = await fetch(`${base}/admin/check`, {
    credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  if (response.ok) window.location.replace(`${base}/admin/`);
  else {
    const message = document.getElementById('error-message');
    message.textContent = response.status === 401 ? '' : response.status === 403
      ? 'This account has no administration permissions.'
      : 'Unable to check administration access. Please try again.';
    message.style.display = response.status === 401 ? 'none' : 'block';
  }
}

async function initializeLogin() {
  try {
    const authentication = await initializeAuthentication(`${base}/api`);
    if (authentication === null) {
      const response = await fetch(`${base}/api/session`, { method: 'POST',
        credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (response.ok) await checkAccess();
    } else {
      document.getElementById('login-guidance').hidden = true;
      const status = document.createElement('auth-status');
      status.authentication = authentication;
      status.addEventListener('auth-complete', async event => {
        if (event.detail) await checkAccess();
      });
      document.querySelector('.login-card').appendChild(status);
      if (authentication.state.account !== null) await checkAccess();
    }
  } catch (error) {
    showAuthenticationStartupFailure(error);
  }
}

initializeLogin();