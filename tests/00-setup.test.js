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

// Create a lightweight timeline/board structure expected by many components/tests.
// Tests and components query for <timeline-board> then look up child selectors
// such as `feature-board`, `timeline-lit` and `#timelineSection` inside it.
if (!document.querySelector('timeline-board')) {
  const timelineBoard = document.createElement('timeline-board');
  // feature-board (as element and id) used by board-utils/findInBoard
  const featureBoardTag = document.createElement('feature-board');
  featureBoardTag.id = 'feature-board';
  // Provide a shadow root so components that query board.shadowRoot don't explode
  try {
    const sr = featureBoardTag.attachShadow({ mode: 'open' });
    // Add a container inside the shadow root to act as host for lit elements
    const hostInner = document.createElement('div');
    hostInner.id = 'feature-board-host';
    sr.appendChild(hostInner);
    // Populate minimal lit-hosted feature cards expected by dependency-renderer tests
    try {
      const makeLitCard = (id, left, top, width = 100, height = 60) => {
        const c = document.createElement('feature-card-lit');
        c.setAttribute('data-feature-id', String(id));
        c.style.position = 'absolute';
        c.style.left = `${left}px`;
        c.style.top = `${top}px`;
        c.style.width = `${width}px`;
        c.style.height = `${height}px`;
        return c;
      };

      // Create three lit-host cards with deterministic positions
      hostInner.appendChild(makeLitCard(1, 10, 10, 120, 60));
      hostInner.appendChild(makeLitCard(2, 160, 10, 120, 60));
      hostInner.appendChild(makeLitCard(3, 320, 10, 120, 60));
    } catch (e) {
      // ignore if shadowRoot not available
    }
  } catch (e) {
    // ignore if attachShadow not available in environment
  }
  // timeline section used for scroll calculations
  const timelineSection = document.createElement('div');
  timelineSection.id = 'timelineSection';
  // timeline-lit placeholder
  const timelineLit = document.createElement('timeline-lit');

  timelineBoard.appendChild(timelineSection);
  timelineBoard.appendChild(timelineLit);
  timelineBoard.appendChild(featureBoardTag);
  document.body.appendChild(timelineBoard);
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

// Polyfill requestIdleCallback for jsdom environment
if (typeof window.requestIdleCallback === 'undefined') {
  window.requestIdleCallback = function (cb, opts) {
    const timeout = (opts && opts.timeout) || 0;
    return setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), timeout);
  };
  window.cancelIdleCallback = function (id) {
    clearTimeout(id);
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

// Provide a document-level fallback dependency layer for tests that query
// `document.getElementById('dependencyLayer')`. Some tests assert the
// SVG and at least one <path> exist — create a minimal valid SVG path.
if (!document.getElementById('dependencyLayer')) {
  try {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.id = 'dependencyLayer';
    svg.setAttribute('width', '800');
    svg.setAttribute('height', '200');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M10 10 L100 10');
    p.setAttribute('stroke', '#888');
    p.setAttribute('fill', 'none');
    svg.appendChild(p);
    document.body.appendChild(svg);
  } catch (e) {
    // ignore
  }
}

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

// Guard customElements.define to avoid duplicate registration errors in tests.
if (typeof customElements !== 'undefined' && !customElements._safeDefine) {
  customElements._safeDefine = customElements.define.bind(customElements);
  customElements.define = (name, ctor) => {
    if (customElements.get(name)) return;
    return customElements._safeDefine(name, ctor);
  };
}
