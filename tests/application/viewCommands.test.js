import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyViewCommands,
  createViewCommands,
} from '../../www/js/application/commands/viewCommands.js';
import {
  FeatureEvents,
  FilterEvents,
  TimelineEvents,
  ViewEvents,
} from '../../www/js/core/EventRegistry.js';

describe('application/commands/viewCommands', () => {
  beforeEach(() => {
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('legacy branch delegates expansion command to state', () => {
    const state = { setExpansionState: vi.fn() };
    const commands = createLegacyViewCommands(state);

    commands.setExpansionState({ expandParentChild: true }, { suppressEvents: true });

    expect(state.setExpansionState).toHaveBeenCalledWith(
      { expandParentChild: true },
      { suppressEvents: true }
    );
  });

  it('legacy branch delegates view service updates', () => {
    const state = {
      _viewService: {
        setTimelineScale: vi.fn(),
        setCondensedCards: vi.fn(),
        setFeatureSortMode: vi.fn(),
        setCapacityViewMode: vi.fn(),
        setDisplayMode: vi.fn(),
        setShowDependencies: vi.fn(),
        setTypeVisibility: vi.fn(),
      },
    };
    const commands = createLegacyViewCommands(state);

    commands.setTimelineScale('quarters');
    commands.setCondensedCards(true);
    commands.setFeatureSortMode('date');
    commands.setCapacityViewMode('project');
    commands.setDisplayMode('packed');
    commands.setShowDependencies(true);
    commands.setTypeVisibility('feature', false, { suppressEvents: true });

    expect(state._viewService.setTimelineScale).toHaveBeenCalledWith('quarters');
    expect(state._viewService.setCondensedCards).toHaveBeenCalledWith(true);
    expect(state._viewService.setFeatureSortMode).toHaveBeenCalledWith('date');
    expect(state._viewService.setCapacityViewMode).toHaveBeenCalledWith('project');
    expect(state._viewService.setDisplayMode).toHaveBeenCalledWith('packed');
    expect(state._viewService.setShowDependencies).toHaveBeenCalledWith(true);
    expect(state._viewService.setTypeVisibility).toHaveBeenCalledWith(
      'feature',
      false,
      true
    );
  });

  it('store branch updates expansion slice and supports suppressEvents', () => {
    const bus = { emit: vi.fn() };
    const commands = createViewCommands(store, bus);

    commands.setExpansionState(
      {
        expandParentChild: true,
        expandRelations: true,
      },
      { suppressEvents: true }
    );

    expect(store.getState().view.expansion).toEqual({
      parentChild: true,
      relations: true,
      teamAllocated: false,
    });
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('store branch updates view options and hidden types', () => {
    const bus = { emit: vi.fn() };
    const commands = createViewCommands(store, bus);

    commands.setTimelineScale('weeks');
    commands.setCondensedCards(true);
    commands.setFeatureSortMode('date');
    commands.setCapacityViewMode('project');
    commands.setDisplayMode('packed');
    commands.setShowDependencies(true);
    commands.setTypeVisibility('feature', false);
    commands.setTypeVisibility('feature', true);

    expect(store.getState().view.options).toMatchObject({
      timelineScale: 'weeks',
      condensedCards: true,
      featureSortMode: 'date',
      capacityViewMode: 'project',
      displayMode: 'packed',
      packedMode: true,
      showDependencies: true,
      hiddenTypes: [],
    });
    expect(bus.emit).toHaveBeenCalled();
    expect(bus.emit.mock.calls.some(([event]) => event === TimelineEvents.SCALE_CHANGED)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === ViewEvents.DISPLAY_MODE)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === ViewEvents.CONDENSED)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === ViewEvents.SORT_MODE)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === ViewEvents.CAPACITY_MODE)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === ViewEvents.DEPENDENCIES)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === FilterEvents.CHANGED)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === FeatureEvents.UPDATED)).toBe(true);
  });

  it('store branch maps displayMode to condensedCards and packedMode', () => {
    const bus = { emit: vi.fn() };
    const commands = createViewCommands(store, bus);

    commands.setDisplayMode('compact');
    expect(store.getState().view.options).toMatchObject({
      displayMode: 'compact',
      condensedCards: true,
      packedMode: false,
    });

    commands.setDisplayMode('packed');
    expect(store.getState().view.options).toMatchObject({
      displayMode: 'packed',
      condensedCards: true,
      packedMode: true,
    });

    commands.setDisplayMode('normal');
    expect(store.getState().view.options).toMatchObject({
      displayMode: 'normal',
      condensedCards: false,
      packedMode: false,
    });
  });
});
