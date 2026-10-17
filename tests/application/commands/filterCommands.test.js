import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../../www/js/application/store.js';
import { createInitialAppState } from '../../../www/js/application/createInitialAppState.js';
import { createFilterCommands } from '../../../www/js/application/commands/filterCommands.js';
import {
  FeatureEvents,
  FilterEvents,
  StateFilterEvents,
} from '../../../www/js/core/EventRegistry.js';

describe('application/commands/filterCommands', () => {
  beforeEach(() => {
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  for (const [dimension, first, second] of [
    ['schedule', 'planned', 'unplanned'],
    ['allocation', 'allocated', 'unallocated'],
    ['hierarchy', 'hasParent', 'noParent'],
    ['relations', 'hasLinks', 'noLinks'],
  ]) {
    it(`cycles ${dimension} atomically through both and each single option`, () => {
      const bus = { emit: vi.fn() };
      const commands = createFilterCommands(store, bus);
      const snapshots = [];
      const unsubscribe = store.subscribe((state) =>
        snapshots.push(state.selection.taskFilters[dimension]));
      try {
        for (let step = 0; step < 3; step += 1) commands.cycleTaskFilter(dimension);
      } finally {
        unsubscribe();
      }

      expect(snapshots).toEqual([
        { [first]: true, [second]: false },
        { [first]: false, [second]: true },
        { [first]: true, [second]: true },
      ]);
      expect(bus.emit.mock.calls).toEqual([
        [FilterEvents.CHANGED], [FeatureEvents.UPDATED],
        [FilterEvents.CHANGED], [FeatureEvents.UPDATED],
        [FilterEvents.CHANGED], [FeatureEvents.UPDATED],
      ]);
    });
  }

  for (const [disabled, initial, expected] of [
    [['allocated'], { allocated: true, unallocated: true }, { allocated: true, unallocated: false }],
    [['allocated'], { allocated: true, unallocated: false }, { allocated: true, unallocated: true }],
    [['unallocated'], { allocated: true, unallocated: true }, { allocated: false, unallocated: true }],
    [['allocated'], { allocated: false, unallocated: true }, { allocated: false, unallocated: true }],
    [['allocated', 'unallocated'], { allocated: true, unallocated: true },
      { allocated: true, unallocated: true }],
  ]) {
    it(`preserves disabled allocation options ${disabled} from ${JSON.stringify(initial)}`, () => {
      const bus = { emit: vi.fn() };
      const commands = createFilterCommands(store, bus);
      store.setState((state) => ({ ...state, selection: { ...state.selection,
        sidebarDisabled: { taskFilters: { allocation: disabled } },
        taskFilters: { ...state.selection.taskFilters, allocation: initial },
      } }));

      commands.cycleTaskFilter('allocation');

      expect(store.getState().selection.taskFilters.allocation).toEqual(expected);
      expect(bus.emit).toHaveBeenCalledTimes(JSON.stringify(initial) === JSON.stringify(expected) ? 0 : 2);
    });
  }

  it('leaves the only reachable schedule state alone in Packed mode', () => {
    const bus = { emit: vi.fn() };
    const commands = createFilterCommands(store, bus);
    store.setState((state) => ({ ...state,
      view: { ...state.view, options: { ...state.view.options, displayMode: 'packed' } },
      selection: { ...state.selection, taskFilters: { ...state.selection.taskFilters,
        schedule: { planned: true, unplanned: false },
      } },
    }));

    commands.cycleTaskFilter('schedule');

    expect(store.getState().selection.taskFilters.schedule).toEqual({ planned: true, unplanned: false });
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('recovers a manually cleared pair and supports suppressed events', () => {
    const bus = { emit: vi.fn() };
    const commands = createFilterCommands(store, bus);
    commands.setTaskFilter('relations', 'hasLinks', false, { suppressEvents: true });
    commands.setTaskFilter('relations', 'noLinks', false, { suppressEvents: true });

    commands.cycleTaskFilter('relations', { suppressEvents: true });

    expect(store.getState().selection.taskFilters.relations).toEqual({ hasLinks: true, noLinks: true });
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('does not expose legacy compatibility adapters', async () => {
    const mod = await import('../../../www/js/application/commands/filterCommands.js');
    expect(mod.createLegacyFilterCommands).toBeUndefined();
  });

  it('store branch updates selection filter slices and supports suppressEvents', () => {
    const bus = { emit: vi.fn() };
    const recomputeCapacity = vi.fn();
    const commands = createFilterCommands(store, bus, recomputeCapacity);

    commands.setSelectedTaskTypes(["[\"process\",\"feature\"]"], { suppressEvents: true });
    commands.setSelectedStates(['Doing'], { suppressEvents: true });
    commands.setSidebarDisabledElements({ states: ['Doing'] }, { suppressEvents: true });

    const selection = store.getState().selection;
    expect(selection.taskTypeNames).toEqual(["[\"process\",\"feature\"]"]);
    expect(selection.featureStateNames).toEqual(['Doing']);
    expect(selection.sidebarDisabled).toEqual({ states: ['Doing'] });
    expect(recomputeCapacity).not.toHaveBeenCalled();
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('keeps default task filter dimensions fully initialized with all options enabled', () => {
    const selectionFilters = store.getState().selection.taskFilters;
    expect(selectionFilters).toEqual({
      schedule: { planned: true, unplanned: true },
      allocation: { allocated: true, unallocated: true },
      hierarchy: { hasParent: true, noParent: true },
      relations: { hasLinks: true, noLinks: true },
    });

    const selectors = createFilterCommands(store, { emit: vi.fn() }, vi.fn());
    expect(selectors.setTaskFilter).toBeTypeOf('function');
    expect(store.getState().selection.taskFilters.schedule).toEqual({ planned: true, unplanned: true });
  });

  it('updates type visibility and persisted selection in one transition without a Sidebar', () => {
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: [{ process_id: 'process', id: 'a', type: 'Epic' }, { process_id: 'process', id: 'b', type: 'Task' }],
    } }));
    const bus = { emit: vi.fn() };
    const commands = createFilterCommands(store, bus);
    const snapshots = [];
    const unsubscribe = store.subscribe((state) => snapshots.push(state));
    commands.setTaskTypeSelected("[\"process\",\"task\"]", false);
    unsubscribe();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].selection.taskTypeNames).toEqual(["[\"process\",\"epic\"]"]);
    expect(snapshots[0].view.options.hiddenTypes).toEqual(["[\"process\",\"task\"]"]);
    expect(bus.emit.mock.calls).toEqual([[FilterEvents.CHANGED], [FeatureEvents.UPDATED]]);
    commands.setTaskTypeSelected("[\"process\",\"task\"]", true, { suppressEvents: true });
    expect(store.getState().selection.taskTypeNames).toEqual(["[\"process\",\"epic\"]", "[\"process\",\"task\"]"]);
    expect(store.getState().view.options.hiddenTypes).toEqual([]);
    expect(bus.emit).toHaveBeenCalledTimes(2);
  });

  it('bulk type selection also updates visibility, including deselecting every type', () => {
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: [{ process_id: 'process', id: 'a', type: 'Epic' }, { process_id: 'process', id: 'b', type: 'Task' }],
    } }));
    const commands = createFilterCommands(store, { emit: vi.fn() });
    commands.setSelectedTaskTypes(["[\"process\",\"task\"]"]);
    expect(store.getState().view.options.hiddenTypes).toEqual(["[\"process\",\"epic\"]"]);
    commands.setSelectedTaskTypes([]);
    expect(store.getState().view.options.hiddenTypes).toEqual(["[\"process\",\"epic\"]", "[\"process\",\"task\"]"]);
  });

  it('does not require a capacity seam for presentation filters', () => {
    const commands = createFilterCommands(store, { emit: vi.fn() }, undefined);
    expect(() => commands.setSelectedStates(['Doing'])).not.toThrow();
  });

  it('accepts caller-provided arrays and stores them as selection values', () => {
    const bus = { emit: vi.fn() };
    const commands = createFilterCommands(store, bus, vi.fn());

    expect(() => commands.setSelectedStates(['Doing'])).not.toThrow();
    expect(() => commands.setSelectedTaskTypes(["[\"process\",\"feature\"]"])).not.toThrow();

    expect(store.getState().selection.featureStateNames).toEqual(['Doing']);
    expect(store.getState().selection.taskTypeNames).toEqual(["[\"process\",\"feature\"]"]);
  });

  it('emits the expected filter events for state and task filter toggles', () => {
    const bus = { emit: vi.fn() };
    const commands = createFilterCommands(store, bus, vi.fn());

    commands.setSelectedStates(['New']);
    commands.toggleTaskFilter('schedule', 'planned');
    commands.toggleStateSelected('Doing');

    const filterChangedCalls = bus.emit.mock.calls.filter(
      ([event]) => event === FilterEvents.CHANGED
    );
    expect(filterChangedCalls.length).toBeGreaterThan(0);
    expect(filterChangedCalls.every(([, payload]) => payload === undefined)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === FeatureEvents.UPDATED)).toBe(true);
  });

  it('store branch setAllStatesSelected(true) derives available states from baseline features', () => {
    store.setState(
      (current) => ({
        ...current,
        baseline: {
          ...current.baseline,
          features: [
            { id: 'f1', state: 'New' },
            { id: 'f2', state: 'Doing' },
            { id: 'f3', state: 'New' },
            { id: 'f4', state: 'Done' },
            { id: 'f5' },
          ],
        },
      }),
      false,
      'test.seedBaselineStates'
    );

    const bus = { emit: vi.fn() };
    const commands = createFilterCommands(store, bus, vi.fn());
    commands.setAllStatesSelected(true);

    expect(store.getState().selection.featureStateNames).toEqual(['New', 'Doing', 'Done']);
    const filterChangedCalls = bus.emit.mock.calls.filter(
      ([event]) => event === FilterEvents.CHANGED
    );
    expect(filterChangedCalls.length).toBeGreaterThan(0);
    expect(filterChangedCalls.every(([, payload]) => payload === undefined)).toBe(true);
    expect(
      bus.emit.mock.calls.some(([event]) => event === StateFilterEvents.CHANGED)
    ).toBe(true);
  });
});
