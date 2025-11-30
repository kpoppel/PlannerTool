import { readdirSync } from 'fs';
import { join, basename } from 'path';

const testDir = join(process.cwd(), 'tests/frontend');
const testFiles = readdirSync(testDir)
  .filter(f => f.startsWith('test-') && f.endsWith('.js'))
  .map(f => join(testDir, f));

// List of test files that require DOM mocking (UI tests)
// DEPRECATED: Use RUN_UI_TESTS flag instead
const uiTestNames = [
  'test-colorManager.js',
  'test-condensedView.js',
  'test-featureOrder.js',
  'test-loadGraph.js',
  'test-scenarios.js',
  'test-state-functional.js',
  'test-state-extra.js',
  'test-state-branches.js',
  'test-loadViewMode.js',
  // Add more as needed
];

const uiTestFiles = testFiles.filter(f => uiTestNames.includes(basename(f)));
const nonUiTestFiles = testFiles.filter(f => !uiTestNames.includes(basename(f)));

function injectDomMocks() {
  if (typeof global !== 'undefined' && typeof document === 'undefined') {
    // Minimal DOM mock for Node
    function makeElement(tag) {
      return {
        style: {},
        setAttribute() {},
        appendChild(child) { this.children = this.children || []; this.children.push(child); },
        className: '',
        id: '',
        textContent: '',
        children: [],
        listeners: {},
        addEventListener(type, fn) {
          if (!this.listeners[type]) this.listeners[type] = [];
          this.listeners[type].push(fn);
        },
        removeEventListener(type, fn) {
          if (this.listeners[type]) {
            this.listeners[type] = this.listeners[type].filter(f => f !== fn);
          }
        },
        dispatchEvent(evt) {
          const type = evt.type;
          if (this.listeners[type]) {
            this.listeners[type].forEach(fn => fn.call(this, evt));
          }
        },
        querySelectorAll(sel) {
          return this.children.filter(c => {
            if (sel.startsWith('.')) return c.className === sel.slice(1);
            if (sel.startsWith('#')) return c.id === sel.slice(1);
            return false;
          });
        },
        click() {
          if (typeof this.onclick === 'function') this.onclick();
          this.dispatchEvent({ type: 'click' });
        },
        set onclick(fn) { this._onclick = fn; },
        get onclick() { return this._onclick; },
        classList: {
          classes: [],
          add(...cls) { this.classes.push(...cls); },
          remove(...cls) { this.classes = this.classes.filter(c => !cls.includes(c)); },
          contains(cls) { return this.classes.includes(cls); }
        }
      };
    }
    global.document = {
      createElement: makeElement,
      getElementById: function(id){
        if (!this._elements) this._elements = {};
        return this._elements[id] || null;
      },
      querySelector: function(sel) {
        if (sel.startsWith('#')) {
          const id = sel.slice(1);
          return this.getElementById(id);
        }
        return null;
      },
      body: {
        appendChild(el){
          if (!global.document._elements) global.document._elements = {};
          if (el.id) global.document._elements[el.id] = el;
        }
      },
      _elements: {}
    };
    // Pre-populate required elements for UI tests
    const featureBoard = makeElement('div'); featureBoard.id = 'featureBoard';
    global.document.body.appendChild(featureBoard);
    const sidebar = makeElement('div'); sidebar.id = 'sidebar';
    global.document.body.appendChild(sidebar);
    const timeline = makeElement('div'); timeline.id = 'timeline';
    global.document.body.appendChild(timeline);
    const detailsPanel = makeElement('div'); detailsPanel.id = 'detailsPanel';
    global.document.body.appendChild(detailsPanel);
    const featureCard = makeElement('div'); featureCard.id = 'featureCard'; featureCard.className = 'feature-card';
    global.document.body.appendChild(featureCard);
  }
  if (typeof global !== 'undefined' && typeof localStorage === 'undefined') {
    let store = {};
    global.localStorage = {
      getItem: key => key in store ? store[key] : null,
      setItem: (key, val) => { store[key] = String(val); },
      removeItem: key => { delete store[key]; },
      clear: () => { store = {}; }
    };
  }
}

async function runSuite(name, fn) {
  try {
    const results = await fn();
    for (const r of results) {
      console.log(JSON.stringify({ suite: name, ...r }));
    }
    return results.every(r => r.pass);
  } catch (e) {
    console.error(JSON.stringify({ suite: name, name: `${name} crashed`, pass: false, info: e.message }));
    return false;
  }
}

// Configuration switch: set to true to run UI tests, false to skip
const RUN_UI_TESTS = false;

async function main() {
  let allOk = true;
  // Always ensure localStorage (and minimal DOM if desired) for all tests
  injectDomMocks();
  // Run non-UI tests
  for (const file of nonUiTestFiles) {
    const mod = await import(file);
    let fn = mod.run || mod.default;
    if (!fn) fn = Object.values(mod).find(v => typeof v === 'function');
    const suiteName = basename(file).replace('.js', '');
    if (typeof fn === 'function') {
      const ok = await runSuite(suiteName, fn);
      allOk = allOk && ok;
    } else {
      console.warn(`No test runner found in ${file}`);
    }
  }
  // Conditionally run UI tests
  if (RUN_UI_TESTS) {
    injectDomMocks();
    for (const file of uiTestFiles) {
      const mod = await import(file);
      let fn = mod.run || mod.default;
      if (!fn) fn = Object.values(mod).find(v => typeof v === 'function');
      const suiteName = basename(file).replace('.js', '');
      if (typeof fn === 'function') {
        const ok = await runSuite(suiteName, fn);
        allOk = allOk && ok;
      } else {
        console.warn(`No test runner found in ${file}`);
      }
    }
  }
  if (!allOk) {
    process.exitCode = 1;
  }
}

main();
