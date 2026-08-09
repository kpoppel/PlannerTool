import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyFilterCommands,
  createFilterCommands,
} from '../../www/js/application/commands/filterCommands.js';

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
    const legacyState = { setSelectedTaskTypes: vi.fn() };
    const commands = createFilterCommands(store, bus, legacyState);

    commands.setSelectedTaskTypes(['feature'], { suppressEvents: true });
    commands.setSelectedStates(['Doing'], { suppressEvents: true });
    commands.setSidebarDisabledElements({ states: ['Doing'] }, { suppressEvents: true });

    const selection = store.getState().selection;
    expect(selection.taskTypeNames).toEqual(['feature']);
    expect(selection.featureStateNames).toEqual(['Doing']);
    expect(selection.sidebarDisabled).toEqual({ states: ['Doing'] });
    expect(legacyState.setSelectedTaskTypes).toHaveBeenCalledWith(['feature'], {
      suppressEvents: true,
    });
    expect(bus.emit).not.toHaveBeenCalled();
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
    expect(bus.emit).toHaveBeenCalledWith('filter:all-states-changed', { selected: true });
  });
});
