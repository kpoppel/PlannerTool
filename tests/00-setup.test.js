// Global setup for browser tests - create expected DOM elements and simple mocks
// This module intentionally runs before other tests (filename prefix 00-)
/* global window, document */
const ids = ['featureBoard', 'sidebar', 'timeline', 'detailsPanel', 'featureCard'];
for (const id of ids) {
  if (!document.getElementById(id)) {
    const d = document.createElement('div');
    d.id = id;
    document.body.appendChild(d);
  }
}

// Minimal localStorage shim if not present
if (typeof window.localStorage === 'undefined') {
  let store = {};
  window.localStorage = {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: key => { delete store[key]; },
    clear: () => { store = {}; }
  };
}

// Provide simple providerMock and config services expected by many tests
if (!window.ProviderMock) {
  window.ProviderMock = {
    getLocalPref(key) {
      const defaults = { 'autosave.interval': null, 'sidebar.state': null };
      return defaults[key] ?? null;
    }
  };
}

if (!window.ConfigService) {
  window.ConfigService = {
    getPref(key) { return window.ProviderMock.getLocalPref(key); }
  };
}

// Avoid network fetches failing tests: intercept fetch to return 404 for unknown api paths
if (typeof window.fetch === 'function') {
  const _fetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      // let tests call real fetch for static files and same-origin paths
      const url = typeof input === 'string' ? input : input.url || '';
      if (url.includes('/api/')) {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return _fetch(input, init);
    } catch (e) {
      return new Response(null, { status: 500 });
    }
  };
}

// expose some convenient globals
window._TEST_SETUP = true;
console.log('Global test setup applied');
