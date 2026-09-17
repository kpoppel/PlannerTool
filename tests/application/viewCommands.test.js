import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createViewCommands } from '../../www/js/application/commands/viewCommands.js';
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

  it('does not expose legacy compatibility adapters', async () => {
    const mod = await import('../../www/js/application/commands/viewCommands.js');
    expect(mod.createLegacyViewCommands).toBeUndefined();
  });

  it('store branch updates view options and hidden types', () => {
    const bus = { emit: vi.fn() };
    const commands = createViewCommands(store, bus);

    commands.setTimelineScale('weeks');
    commands.setCondensedCards(true);
    commands.setFeatureSortMode('date');
    commands.setCapacityViewMode('project');
    commands.setDisplayMode('packed');
    commands.setTypeVisibility('feature', false);
    commands.setTypeVisibility('feature', true);

    expect(store.getState().view.options).toMatchObject({
      timelineScale: 'weeks',
      condensedCards: true,
      featureSortMode: 'date',
      capacityViewMode: 'project',
      displayMode: 'packed',
      packedMode: true,
      hiddenTypes: [],
    });
    expect(bus.emit).toHaveBeenCalled();
    expect(bus.emit.mock.calls.some(([event]) => event === TimelineEvents.SCALE_CHANGED)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === ViewEvents.DISPLAY_MODE)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === ViewEvents.CONDENSED)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === ViewEvents.SORT_MODE)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === ViewEvents.CAPACITY_MODE)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === FilterEvents.CHANGED)).toBe(true);
    expect(bus.emit.mock.calls.some(([event]) => event === FeatureEvents.UPDATED)).toBe(true);
  });

  it('setTimelineScale is a no-op when the requested scale is already active', () => {
    const bus = { emit: vi.fn() };
    const commands = createViewCommands(store, bus);

    commands.setTimelineScale('weeks');
    bus.emit.mockClear();

    commands.setTimelineScale('weeks');

    expect(store.getState().view.options.timelineScale).toBe('weeks');
    expect(bus.emit).not.toHaveBeenCalled();
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
