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
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
}

// Provide simple providerMock and config services expected by many tests
if (!window.ProviderMock) {
  window.ProviderMock = {
    getLocalPref(key) {
      const defaults = { 'autosave.interval': null, 'sidebar.state': null };
      return defaults[key] ?? null;
    },
  };
}

if (!window.ConfigService) {
  window.ConfigService = {
    getPref(key) {
      return window.ProviderMock.getLocalPref(key);
    },
  };
}

// Global fetch stub: return a resolved successful JSON response by default.
// Individual tests should override `window.fetch` when they need specific
// API responses; leaving this unmocked caused retries and browser timeouts.
// Lightweight test router for `fetch` so tests that expect list endpoints
// receive arrays while single-resource endpoints receive objects. Tests
// can still override `window.fetch` when they need custom behavior.
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const method = (init && init.method) || 'GET';
  const path = (url.split('?')[0] || '').toLowerCase();

  const json = async () => {
    // Heuristic: plural resource names and common list endpoints return arrays
    if (/\/(features|projects|teams|accounts|people)(?:\/|$)/.test(path)) return [];
    if (/list|all|items/.test(path)) return [];
    // Default: return empty object
    return {};
  };

  return { ok: true, status: 200, json };
};

// expose some convenient globals
window._TEST_SETUP = true;
console.log('Global test setup applied');

// Provide a no-op .timeout chaining for tests that use Mocha-style
['it', 'test'].forEach((name) => {
  const orig = globalThis[name];
  if (typeof orig === 'function') {
    const wrapper = function (...args) {
      orig.apply(this, args);
      return { timeout: () => {} };
    };
    // preserve common static helpers if present (skip/only/todo)
    ['skip', 'only', 'todo'].forEach((k) => {
      if (orig[k]) wrapper[k] = orig[k].bind(orig);
      else wrapper[k] = (...a) => {};
    });
    globalThis[name] = wrapper;
  }
});

// Provide Mocha-style lifecycle aliases if tests use them
if (
  typeof globalThis.before === 'undefined' &&
  typeof globalThis.beforeAll === 'function'
) {
  globalThis.before = globalThis.beforeAll.bind(globalThis);
}
if (
  typeof globalThis.after === 'undefined' &&
  typeof globalThis.afterAll === 'function'
) {
  globalThis.after = globalThis.afterAll.bind(globalThis);
}

// Basic ResizeObserver shim for jsdom environment where it's not available.
if (typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    constructor(callback) {
      this._cb = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub;
}
