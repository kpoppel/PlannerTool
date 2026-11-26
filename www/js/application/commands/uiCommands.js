export const UiEvents = {
  DEBUG_FLAG_SET: Symbol('ui:debug-flag-set'),
};

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 */
export function createUiCommands(store, bus) {
  return {
    addNotification({ source = 'Application', code = '', severity = 'info', message }) {
      if (typeof message !== 'string' || message.trim() === '') {
        throw new Error('Notification message must be a nonempty string');
      }
      if (!['info', 'success', 'warning', 'error'].includes(severity)) {
        throw new Error(`Invalid notification severity: ${severity}`);
      }
      const text = message.trim();
      const now = Date.now();
      store.setState((state) => {
        const previous = state.notifications.find((entry) => entry.source === source
          && entry.code === code && entry.severity === severity && entry.message === text);
        const entry = {
          source, code, severity, message: text,
          firstSeenAt: previous === undefined ? now : previous.firstSeenAt,
          lastSeenAt: now,
          count: previous === undefined ? 1 : previous.count + 1,
          unread: true,
        };
        return {
          ...state,
          notifications: [entry, ...state.notifications.filter((item) => item !== previous)].slice(0, 100),
        };
      }, false, 'ui.addNotification');
    },
    markNotificationsRead() {
      store.setState((state) => ({
        ...state,
        notifications: state.notifications.map((entry) => ({ ...entry, unread: false })),
      }), false, 'ui.markNotificationsRead');
    },
    clearNotifications() {
      store.setState((state) => ({ ...state, notifications: [] }), false, 'ui.clearNotifications');
    },
    setDebugFlag(value) {
      const nextDebugFlag = Boolean(value);
      store.setState(
        (state) => ({
          ...state,
          view: {
            ...state.view,
            options: {
              ...state.view.options,
              debugFlag: nextDebugFlag,
            },
          },
        }),
        false,
        'ui.setDebugFlag'
      );

      bus.emit(UiEvents.DEBUG_FLAG_SET, { debugFlag: nextDebugFlag });
    },
  };
}
