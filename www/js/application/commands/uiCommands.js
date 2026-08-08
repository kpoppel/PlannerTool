export const UiEvents = {
  DEBUG_FLAG_SET: Symbol('ui:debug-flag-set'),
};

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
