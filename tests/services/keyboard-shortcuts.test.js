import { expect } from '@open-wc/testing';
import {
  createApplicationShortcutDefinitions,
  KeyboardShortcutManager,
} from '../../www/js/services/KeyboardShortcuts.js';

describe('KeyboardShortcutManager', () => {
  it('routes display shortcuts through their commands and cycles current values', () => {
    const calls = [];
    const definitions = createApplicationShortcutDefinitions({
      commands: {
        setTimelineScale: (value) => calls.push(['timeline', value]),
        setDisplayMode: (value) => calls.push(['display', value]),
        setFeatureSortMode: (value) => calls.push(['sort', value]),
        setCapacityViewMode: (value) => calls.push(['graph', value]),
      },
      selectors: {
        getTimelineScale: () => 'months',
        getDisplayMode: () => 'normal',
        getFeatureSortMode: () => 'rank',
        getCapacityViewMode: () => 'team',
      },
      openSearch: () => calls.push(['search']),
      getTimelineBoard: () => ({ adjustBoardZoom() {}, resetBoardZoom() {} }),
    });
    const manager = new KeyboardShortcutManager(document, definitions);

    manager.handleKeydown(keyEvent('t'));
    manager.handleKeydown(keyEvent('c'));
    manager.handleKeydown(keyEvent('s'));
    manager.handleKeydown(keyEvent('g'));
    manager.handleKeydown(keyEvent('f'));

    expect(calls).to.deep.equal([
      ['timeline', 'quarters'],
      ['display', 'compact'],
      ['sort', 'date'],
      ['graph', 'project'],
      ['search'],
    ]);
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

  it('does not claim key or wheel events without a matching modifier', () => {
    const definitions = createApplicationShortcutDefinitions({
      commands: displayCommands(),
      selectors: displaySelectors(),
      openSearch() {},
      getTimelineBoard: () => ({ adjustBoardZoom() {}, resetBoardZoom() {} }),
    });
    const manager = new KeyboardShortcutManager(document, definitions);
    const key = new KeyboardEvent('keydown', { key: 't', cancelable: true });
    const wheel = new WheelEvent('wheel', { deltaY: -10, cancelable: true });

    manager.handleKeydown(key);
    manager.handleWheel(wheel);

    expect(key.defaultPrevented).to.equal(false);
    expect(wheel.defaultPrevented).to.equal(false);
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