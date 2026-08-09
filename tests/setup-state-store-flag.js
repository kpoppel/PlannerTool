/* global window */

// Force the Phase 6 state-store path regardless of config defaults.
window.__featureFlags = {
  ...(window.__featureFlags || {}),
  USE_STATE_STORE: true,
};
