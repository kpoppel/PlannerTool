import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createFilterCommands } from '../../www/js/application/commands/filterCommands.js';
import {
  FeatureEvents,
  FilterEvents,
  StateFilterEvents,
} from '../../www/js/core/EventRegistry.js';

describe('application/commands/filterCommands', () => {
  beforeEach(() => {
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('does not expose legacy compatibility adapters', async () => {
    const mod = await import('../../www/js/application/commands/filterCommands.js');
    expect(mod.createLegacyFilterCommands).toBeUndefined();
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

    const selectors = createFilterCommands(store, { emit: vi.fn() }, vi.fn());
    expect(selectors.setTaskFilter).toBeTypeOf('function');
    expect(store.getState().selection.taskFilters.schedule).toEqual({ planned: true, unplanned: true });
  });

  it('fails loudly when the recomputeCapacity seam is missing', () => {
    const commands = createFilterCommands(store, { emit: vi.fn() }, undefined);
    expect(() => commands.setSelectedStates(['Doing'])).toThrow(TypeError);
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
