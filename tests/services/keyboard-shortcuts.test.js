import { expect } from '@open-wc/testing';
import {
  createApplicationShortcutDefinitions,
  initKeyboardShortcuts,
  KeyboardShortcutManager,
} from '../../www/js/services/KeyboardShortcuts.js';
import { dataService } from '../../www/js/services/dataService.js';
import { bus } from '../../www/js/core/EventBus.js';
import { BoardEvents, ConfigEvents } from '../../www/js/core/EventRegistry.js';

describe('KeyboardShortcutManager', () => {
  it('loads the browser preference, applies saved changes and unsubscribes on disconnect', async () => {
    const preference = vi.spyOn(dataService, 'getLocalPref').mockResolvedValue(false);
    const manager = await initKeyboardShortcuts();
    try {
      expect(preference.mock.calls).to.deep.equal([['keyboard.letters']]);
      expect(manager.characterShortcutsEnabled).to.equal(false);
      bus.emit(ConfigEvents.UPDATED, { characterShortcutsEnabled: true });
      expect(manager.characterShortcutsEnabled).to.equal(true);
      manager.disconnect();
      bus.emit(ConfigEvents.UPDATED, { characterShortcutsEnabled: false });
      expect(manager.characterShortcutsEnabled).to.equal(true);
    } finally {
      manager.disconnect();
      preference.mockRestore();
    }
  });

  it('routes display shortcuts through their commands and cycles current values', () => {
    const calls = [];
    const definitions = createApplicationShortcutDefinitions({
      commands: {
        setTimelineScale: (value) => calls.push(['timeline', value]),
        setDisplayMode: (value) => calls.push(['display', value]),
        setFeatureSortMode: (value) => calls.push(['sort', value]),
        setCapacityViewMode: (value) => calls.push(['graph', value]),
        setTaskViewMode: (value) => calls.push(['task-view', value]),
        setHighlightFeatureRelationMode: (value) => calls.push(['highlight', value]),
      },
      selectors: {
        getTimelineScale: () => 'months',
        getDisplayMode: () => 'normal',
        getFeatureSortMode: () => 'rank',
        getCapacityViewMode: () => 'team',
        getEffectiveCapacityViewMode: () => 'team',
        getAvailableGraphTypes: () => ['team', 'project'],
        getPackedMode: () => false,
        getTaskViewMode: () => 'plan',
        getHighlightFeatureRelationMode: () => false,
      },
      openSearch: () => calls.push(['search']),
      getTimelineBoard: () => ({ adjustBoardZoom() {}, resetBoardZoom() {} }),
    });
    const manager = new KeyboardShortcutManager(document, definitions);

    const timelineKey = letterEvent('t');
    manager.handleKeydown(timelineKey);
    for (const key of ['c', 's', 'g', 'f', 'v', 'h']) {
      manager.handleKeydown(letterEvent(key));
    }

    expect(calls).to.deep.equal([
      ['timeline', 'quarters'],
      ['display', 'compact'],
      ['sort', 'date'],
      ['graph', 'project'],
      ['search'],
      ['task-view', 'team'],
      ['highlight', true],
    ]);
    expect(timelineKey.defaultPrevented).to.equal(true);

    const restoreTab = keyEvent('t');
    manager.handleKeydown(restoreTab);
    expect(restoreTab.defaultPrevented).to.equal(false);
  });

  it('cycles only selected graph levels from the effective displayed level', () => {
    const calls = [];
    const definitions = createApplicationShortcutDefinitions({
      commands: { setCapacityViewMode: (mode) => calls.push(mode) },
      selectors: {
        getCapacityViewMode: () => 'team',
        getEffectiveCapacityViewMode: () => 'project',
        getAvailableGraphTypes: () => ['project', 'program'],
      },
      openSearch() {},
      getTimelineBoard() {},
    });
    const manager = new KeyboardShortcutManager(document, definitions);

    manager.handleKeydown(letterEvent('g'));

    expect(calls).to.deep.equal(['program']);
  });

  it('does not change task sort while packed mode disables the control', () => {
    const calls = [];
    const definitions = createApplicationShortcutDefinitions({
      commands: { setFeatureSortMode: (value) => calls.push(value) },
      selectors: { getPackedMode: () => true },
      openSearch() {},
      getTimelineBoard() {},
    });
    const manager = new KeyboardShortcutManager(document, definitions);

    manager.handleKeydown(letterEvent('s'));

    expect(calls).to.deep.equal([]);
  });

  it('routes the four filter letters through the disabled-aware cycle command', () => {
    const calls = [];
    const definitions = createApplicationShortcutDefinitions({
      commands: displayCommands(),
      selectors: displaySelectors(),
      openSearch() {},
      getTimelineBoard() {},
      filterCommands: { cycleTaskFilter: (dimension) => calls.push(dimension) },
    });
    const manager = new KeyboardShortcutManager(document, definitions);

    for (const key of ['p', 'a', 'i', 'r']) manager.handleKeydown(letterEvent(key));

    expect(calls).to.deep.equal(['schedule', 'allocation', 'hierarchy', 'relations']);
  });

  it('routes plus and minus to one-level hierarchy actions without claiming Ctrl zoom', () => {
    const actions = [];
    const definitions = createApplicationShortcutDefinitions({
      commands: displayCommands(),
      selectors: displaySelectors(),
      openSearch() {},
      getTimelineBoard() {},
      foldHierarchy: (action) => actions.push(action),
    });
    const manager = new KeyboardShortcutManager(document, definitions);
    const shiftedPlus = new KeyboardEvent('keydown', {
      key: '+', shiftKey: true, cancelable: true,
    });
    for (const event of [letterEvent('+'), shiftedPlus, letterEvent('-')]) {
      manager.handleKeydown(event);
      expect(event.defaultPrevented).to.equal(true);
    }

    expect(actions).to.deep.equal(['expand-one', 'expand-one', 'collapse-one']);
  });

  it('connects hierarchy shortcuts to the existing board action bus', async () => {
    const preference = vi.spyOn(dataService, 'getLocalPref').mockResolvedValue(true);
    const actions = [];
    const onAction = ({ action }) => actions.push(action);
    bus.on(BoardEvents.FOLD_ACTION, onAction);
    const manager = await initKeyboardShortcuts();
    try {
      manager.handleKeydown(letterEvent('+'));
      manager.handleKeydown(letterEvent('-'));
      expect(actions).to.deep.equal(['expand-one', 'collapse-one']);
    } finally {
      manager.disconnect();
      bus.off(BoardEvents.FOLD_ACTION, onAction);
      preference.mockRestore();
    }
  });

  it('replaces the former Ctrl+Shift bindings rather than retaining aliases', () => {
    const calls = [];
    const definitions = createApplicationShortcutDefinitions({
      commands: displayCommands(),
      selectors: displaySelectors(),
      openSearch: () => calls.push('search'),
      getTimelineBoard() {},
    });
    const manager = new KeyboardShortcutManager(document, definitions);

    for (const key of ['f', '1', 't', 'c', 's', 'g']) {
      const event = keyEvent(key);
      manager.handleKeydown(event);
      expect(event.defaultPrevented).to.equal(false);
    }
    expect(calls).to.deep.equal([]);
  });

  it('prevents browser zoom and adjusts only the timeline board', () => {
    const zoomCalls = [];
    const definitions = createApplicationShortcutDefinitions({
      commands: displayCommands(),
      selectors: displaySelectors(),
      openSearch() {},
      getTimelineBoard: () => ({
        adjustBoardZoom: (direction, anchorClientY) => zoomCalls.push([direction, anchorClientY]),
        resetBoardZoom: () => zoomCalls.push([0]),
      }),
    });
    const manager = new KeyboardShortcutManager(document, definitions);
    const zoomIn = keyEvent('+', { shiftKey: false });
    const zoomOut = keyEvent('-', { shiftKey: false });
    const zoomReset = keyEvent('0', { shiftKey: false });

    manager.handleKeydown(zoomIn);
    manager.handleKeydown(zoomOut);
    manager.handleKeydown(zoomReset);
    const wheelIn = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -10,
      clientX: 320,
      clientY: 450,
      cancelable: true,
    });
    const wheelOut = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: 10,
      clientX: 320,
      clientY: 450,
      cancelable: true,
    });
    manager.handleWheel(wheelIn);
    manager.handleWheel(wheelOut);

    expect(zoomCalls).to.deep.equal([
      [1, undefined],
      [-1, undefined],
      [0],
      [1, 450],
      [-1, 450],
    ]);
    expect(zoomIn.defaultPrevented).to.equal(true);
    expect(zoomOut.defaultPrevented).to.equal(true);
    expect(zoomReset.defaultPrevented).to.equal(true);
    expect(wheelIn.defaultPrevented).to.equal(true);
    expect(wheelOut.defaultPrevented).to.equal(true);
  });

  it('does not claim zoom keys or wheel events without Ctrl', () => {
    const definitions = createApplicationShortcutDefinitions({
      commands: displayCommands(),
      selectors: displaySelectors(),
      openSearch() {},
      getTimelineBoard: () => ({ adjustBoardZoom() {}, resetBoardZoom() {} }),
    });
    const manager = new KeyboardShortcutManager(document, definitions);
    const key = new KeyboardEvent('keydown', { key: '0', cancelable: true });
    const wheel = new WheelEvent('wheel', { deltaY: -10, cancelable: true });

    manager.handleKeydown(key);
    manager.handleWheel(wheel);

    expect(key.defaultPrevented).to.equal(false);
    expect(wheel.defaultPrevented).to.equal(false);
  });

  describe('plain character shortcut eligibility', () => {
    let manager;
    let host;
    let calls;

    beforeEach(() => {
      calls = [];
      host = document.createElement('div');
      document.body.appendChild(host);
      manager = new KeyboardShortcutManager(document, [
        { id: 'plain-search', keys: ['f'], run: () => calls.push('plain') },
        {
          id: 'modified-search', keys: ['f'], ctrlKey: true, shiftKey: true,
          run: () => calls.push('modified'),
        },
      ]);
      manager.connect();
    });

    afterEach(() => {
      manager.disconnect();
      host.remove();
      document.body.classList.remove('has-modal');
    });

    function dispatchKey(target, options = {}) {
      const event = new KeyboardEvent('keydown', {
        key: 'f', bubbles: true, composed: true, cancelable: true, ...options,
      });
      target.dispatchEvent(event);
      return event;
    }

    it('runs an unmodified definition on the board', () => {
      const event = dispatchKey(host);

      expect(calls).to.deep.equal(['plain']);
      expect(event.defaultPrevented).to.equal(true);
    });

    for (const tag of ['input', 'textarea', 'select']) {
      it(`preserves typing in a nested shadow-root ${tag}`, () => {
        const innerHost = document.createElement('div');
        host.attachShadow({ mode: 'open' }).appendChild(innerHost);
        const input = document.createElement(tag);
        innerHost.attachShadow({ mode: 'open' }).appendChild(input);
        const event = dispatchKey(input);

        expect(calls).to.deep.equal([]);
        expect(event.defaultPrevented).to.equal(false);
      });
    }

    for (const editable of ['', 'true', 'plaintext-only']) {
      it(`preserves typing inside contenteditable="${editable}"`, () => {
        host.setAttribute('contenteditable', editable);
        const child = document.createElement('span');
        host.appendChild(child);
        const event = dispatchKey(child);

        expect(calls).to.deep.equal([]);
        expect(event.defaultPrevented).to.equal(false);
      });
    }

    it('allows shortcuts in non-editable content', () => {
      host.setAttribute('contenteditable', 'false');
      dispatchKey(host);

      expect(calls).to.deep.equal(['plain']);
    });

    for (const role of [
      'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider',
      'menu', 'menubar', 'listbox', 'dialog', 'alertdialog',
    ]) {
      it(`leaves keys to a ${role} and its descendants`, () => {
        host.setAttribute('role', role);
        const child = document.createElement('button');
        host.appendChild(child);
        const event = dispatchKey(child);

        expect(calls).to.deep.equal([]);
        expect(event.defaultPrevented).to.equal(false);
      });
    }

    for (const tag of ['top-menu-bar', 'group-context-menu']) {
      it(`leaves keys to existing ${tag} popovers without menu roles`, () => {
        const menu = document.createElement(tag);
        const button = document.createElement('button');
        menu.attachShadow({ mode: 'open' }).appendChild(button);
        host.appendChild(menu);
        const event = dispatchKey(button);

        expect(calls).to.deep.equal([]);
        expect(event.defaultPrevented).to.equal(false);
      });
    }

    it('suspends background shortcuts while an application modal is open', () => {
      document.body.classList.add('has-modal');
      const event = dispatchKey(host);

      expect(calls).to.deep.equal([]);
      expect(event.defaultPrevented).to.equal(false);
    });

    it('also preserves modified keys in editable controls', () => {
      const input = document.createElement('input');
      host.appendChild(input);
      const event = dispatchKey(input, { ctrlKey: true, shiftKey: true });

      expect(calls).to.deep.equal([]);
      expect(event.defaultPrevented).to.equal(false);
    });

    it('respects keys already handled by a component', () => {
      host.addEventListener('keydown', (event) => event.preventDefault());
      dispatchKey(host);

      expect(calls).to.deep.equal([]);
    });

    it('ignores composition without preventing text entry', () => {
      const event = dispatchKey(host, { isComposing: true });

      expect(calls).to.deep.equal([]);
      expect(event.defaultPrevented).to.equal(false);
    });

    it('does not repeatedly trigger a held character shortcut', () => {
      const event = dispatchKey(host, { repeat: true });

      expect(calls).to.deep.equal([]);
      expect(event.defaultPrevented).to.equal(false);
    });

    for (const modifier of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
      it(`does not treat ${modifier} as an unmodified character`, () => {
        const event = dispatchKey(host, { [modifier]: true });

        expect(calls).to.deep.equal([]);
        expect(event.defaultPrevented).to.equal(false);
      });
    }

    it('rejects extra modifiers on an existing modified binding', () => {
      const event = dispatchKey(host, { ctrlKey: true, shiftKey: true, altKey: true });

      expect(calls).to.deep.equal([]);
      expect(event.defaultPrevented).to.equal(false);
    });

    it('can disable character shortcuts without disabling modified bindings', () => {
      manager.characterShortcutsEnabled = false;
      const plain = dispatchKey(host);
      const modified = dispatchKey(host, { ctrlKey: true, shiftKey: true });

      expect(calls).to.deep.equal(['modified']);
      expect(plain.defaultPrevented).to.equal(false);
      expect(modified.defaultPrevented).to.equal(true);
    });

    it('can re-enable character shortcuts', () => {
      manager.characterShortcutsEnabled = false;
      dispatchKey(host);
      manager.characterShortcutsEnabled = true;
      dispatchKey(host);

      expect(calls).to.deep.equal(['plain']);
    });
  });
});

function keyEvent(key, options = {}) {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    shiftKey: options.shiftKey !== false,
    cancelable: true,
  });
}

function letterEvent(key) {
  return new KeyboardEvent('keydown', { key, cancelable: true });
}

function displayCommands() {
  return {
    setTimelineScale() {},
    setDisplayMode() {},
    setFeatureSortMode() {},
    setCapacityViewMode() {},
  };
}

function displaySelectors() {
  return {
    getTimelineScale: () => 'months',
    getDisplayMode: () => 'normal',
    getFeatureSortMode: () => 'rank',
    getCapacityViewMode: () => 'team',
  };
}