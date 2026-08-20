export const UiEvents = {
  DEBUG_FLAG_SET: Symbol('ui:debug-flag-set'),
};

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 * @returns {{ setDebugFlag: (value: any) => void }}
 */
export function createUiCommands(store, bus) {
  return {
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
