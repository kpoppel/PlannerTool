import { store } from '../application/store.js';
import { createUiCommands } from '../application/commands/uiCommands.js';
import { bus } from '../core/EventBus.js';
import { AUTH_DECISIONS } from './authClient.js';

const uiCommands = createUiCommands(store, bus);

export function createAuthRecovery({
  authentication = null,
  acquireSession = null,
  onSessionError = null,
  notifyDecision = (code) => uiCommands.addNotification({
    source: 'Authentication', code, severity: 'warning',
    message: {
      interaction_required: 'Azure DevOps requires reauthentication. Local work is still available.',
      access_denied: 'Azure DevOps access denied. Sign-in will not change your permissions.',
      ado_credential_unusable: 'The authentication service returned a fake Azure DevOps token. No Azure DevOps request was sent. Local work is still available.',
      ado_credential_required: 'Azure DevOps requires Entra sign-in, which this server does not use. No Azure DevOps request was sent. Local work is still available.',
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
      if (authentication !== null) await authentication.handleDecision(payload.error);
      notifyDecision(payload.error);
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
