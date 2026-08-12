export const uiSelectors = {
  debugFlag(state) {
    return Boolean(state?.view?.options?.debugFlag);
  },
}
