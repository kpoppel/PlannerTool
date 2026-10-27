import { store } from '../application/store.js';
import {
  createUiCommands,
  NotificationActionIds,
  UiEvents,
} from '../application/commands/uiCommands.js';
import { bus } from '../core/EventBus.js';
import { showSetPat } from '../components/SetPat.lit.js';

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
