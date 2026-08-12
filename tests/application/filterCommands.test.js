import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyFilterCommands,
  createFilterCommands,
} from '../../www/js/application/commands/filterCommands.js';
import {
  FeatureEvents,
  FilterEvents,
  StateFilterEvents,
} from '../../www/js/core/EventRegistry.js';

describe('application/commands/filterCommands', () => {
  beforeEach(() => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('legacy branch delegates filter command methods to state 1:1', () => {
    const state = {
      setSelectedTaskTypes: vi.fn(),
      setSelectedStates: vi.fn(),
      setAllStatesSelected: vi.fn(),
      toggleStateSelected: vi.fn(),
      setStateFilter: vi.fn(),
      setSidebarDisabledElements: vi.fn(),
      clearSidebarDisabledElements: vi.fn(),
    };
    const commands = createLegacyFilterCommands(state);

    commands.setSelectedTaskTypes(['feature']);
    commands.setSelectedStates(['New']);
    commands.setAllStatesSelected(true);
    commands.toggleStateSelected('New');
    commands.setStateFilter('Doing');
    commands.setSidebarDisabledElements({ states: ['Doing'] });
    commands.clearSidebarDisabledElements();

    expect(state.setSelectedTaskTypes).toHaveBeenCalledWith(['feature'], undefined);
    expect(state.setSelectedStates).toHaveBeenCalledWith(['New'], undefined);
    expect(state.setAllStatesSelected).toHaveBeenCalledWith(true, undefined);
    expect(state.toggleStateSelected).toHaveBeenCalledWith('New', undefined);
    expect(state.setStateFilter).toHaveBeenCalledWith('Doing', undefined);
    expect(state.setSidebarDisabledElements).toHaveBeenCalledWith({ states: ['Doing'] });
    expect(state.clearSidebarDisabledElements).toHaveBeenCalled();
  });

  it('store branch updates selection filter slices and supports suppressEvents', () => {
    const bus = { emit: vi.fn() };
    const recomputeCapacity = vi.fn();
    const commands = createFilterCommands(store, bus, recomputeCapacity);

    commands.setSelectedTaskTypes(['feature'], { suppressEvents: true });
    commands.setSelectedStates(['Doing'], { suppressEvents: true });
    commands.setSidebarDisabledElements({ states: ['Doing'] }, { suppressEvents: true });

    const selection = store.getState().selection;
    expect(selection.taskTypeNames).toEqual(['feature']);
    expect(selection.featureStateNames).toEqual(['Doing']);
    expect(selection.sidebarDisabled).toEqual({ states: ['Doing'] });
    expect(recomputeCapacity).toHaveBeenCalledTimes(1);
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

    const selectors = createFilterCommands(store, { emit: vi.fn() });
    expect(selectors.setTaskFilter).toBeTypeOf('function');
    expect(store.getState().selection.taskFilters.schedule).toEqual({ planned: true, unplanned: true });
  });

  it('emits the expected filter events for state and task filter toggles', () => {
    const bus = { emit: vi.fn() };
    const commands = createFilterCommands(store, bus);

    commands.setSelectedStates(['New']);
    commands.toggleTaskFilter('schedule', 'planned');
    commands.toggleStateSelected('Doing');

    expect(bus.emit.mock.calls.some(([event, payload]) => event === FilterEvents.CHANGED && payload?.selectedFeatureStateFilter?.includes('New'))).toBe(true);
    expect(bus.emit.mock.calls.some(([event, payload]) => event === FilterEvents.CHANGED && payload?.taskFilters?.schedule?.planned === false)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === FeatureEvents.UPDATED)).toBe(true);
  });

  it('store branch setAllStatesSelected(true) derives available states from baseline features', () => {
    // eslint-disable-next-line local/no-runtime-state-violations
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
    const commands = createFilterCommands(store, bus);
    commands.setAllStatesSelected(true);

    expect(store.getState().selection.featureStateNames).toEqual(['New', 'Doing', 'Done']);
    expect(
      bus.emit.mock.calls.some(
        ([event, payload]) =>
          event === FilterEvents.CHANGED &&
          Array.isArray(payload?.selectedFeatureStateFilter) &&
          payload.selectedFeatureStateFilter.length === 3
      )
    ).toBe(true);
    expect(
      bus.emit.mock.calls.some(([event]) => event === StateFilterEvents.CHANGED)
    ).toBe(true);
  });
});
