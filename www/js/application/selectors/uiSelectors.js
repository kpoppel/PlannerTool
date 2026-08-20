/** @typedef {import('../types.js').AppState} AppState */

export const uiSelectors = {
  /**
   * @param {AppState} state
   * @returns {boolean}
   */
  debugFlag(state) {
    return Boolean(state?.view?.options?.debugFlag);
  },
}
