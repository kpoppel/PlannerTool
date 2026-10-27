import { store } from '../application/store.js';
import {
  createUiCommands,
  NotificationActionIds,
  UiEvents,
} from '../application/commands/uiCommands.js';
import { bus } from '../core/EventBus.js';
import { showSetPat } from '../components/SetPat.lit.js';
import { AUTH_DECISIONS } from './authClient.js';

const uiCommands = createUiCommands(store, bus);

bus.on(UiEvents.PAT_REPAIR_REQUESTED, ({ code }) => {
  let baseUrl = '';
  if (typeof window.APP_BASE_URL === 'string') baseUrl = window.APP_BASE_URL;
  showSetPat(`${baseUrl}/api`, code);
});

export function notifyPatRequired(code) {
  if (code !== 'pat_required' && code !== 'pat_invalid') {
    throw new Error(`Unsupported PAT recovery code: ${code}`);
  }
  const message = code === 'pat_invalid'
    ? 'Your Azure DevOps PAT is invalid or expired. Set or update it to continue live operations.'
    : 'A Personal Access Token is required for this Azure DevOps operation.';
  uiCommands.addNotification({
    source: 'Authentication',
    code,
    severity: 'warning',
    message,
    actionId: NotificationActionIds.SET_PAT,
  });
}

export function clearPatRecoveryNotifications() {
  uiCommands.clearPatRecoveryNotifications();
}

export function createAuthRecovery({
  authentication = null,
  acquireSession = null,
  onSessionError = null,
  notifyCredential = notifyPatRequired,
  notifyDecision = (code) => uiCommands.addNotification({
    source: 'Authentication', code, severity: 'warning',
    message: {
      interaction_required: 'Azure DevOps requires reauthentication. Local work is still available.',
      access_denied: 'Azure DevOps access denied. Sign-in will not change your permissions.',
      auth_unavailable: 'Authentication service unavailable. Please try again later.',
      auth_configuration_error: 'Authentication configuration requires administrator attention.',
    }[code],
  }),
} = {}) {
  let sessionRecovery = null;
  return {
    async login(apiUrl) {
      if (authentication !== null) return authentication.signIn();
      const { showAuthDialog } = await import('../components/AuthDialog.lit.js');
      await showAuthDialog(apiUrl);
    },
    async onCredentialFailure(response, context) {
      if (![403, 409, 503].includes(response.status)) return false;
      let payload = null;
      try {
        payload = await response.clone().json();
      } catch (error) {
        console.warn('Non-JSON access denial', { url: context.url, status: response.status });
      }
      if (payload === null) return false;
      const decision = AUTH_DECISIONS[payload.error];
      if (decision === undefined || decision.status !== response.status) {
        return false;
      }
      if (decision.action === 'set_pat') {
        if (authentication !== null && !authentication.state.capabilities.pat) return false;
        notifyCredential(payload.error);
      } else {
        if (authentication !== null) await authentication.handleDecision(payload.error);
        notifyDecision(payload.error);
      }
      return true;
    },
    async onSessionExpired(context) {
      if (authentication !== null) {
        const payload = await context.response.clone().json();
        const decision = AUTH_DECISIONS[payload.error];
        if (decision === undefined || decision.status !== 401 || decision.action !== 'login') return false;
        try { return await authentication.recover(); }
        catch (error) {
          if (AUTH_DECISIONS[error.code] !== undefined) await authentication.handleDecision(error.code);
          if (onSessionError !== null) onSessionError(error);
          return false;
        }
      }
      if (acquireSession === null) return false;
      if (sessionRecovery !== null) return sessionRecovery;
      sessionRecovery = (async () => {
        try {
          const result = await acquireSession(context);
          return result !== false;
        } catch (error) {
          console.error('Failed to re-acquire session', error);
          if (onSessionError !== null) onSessionError(error);
          return false;
        }
      })();
      try {
        return await sessionRecovery;
      } finally {
        sessionRecovery = null;
      }
    },
  };
}
