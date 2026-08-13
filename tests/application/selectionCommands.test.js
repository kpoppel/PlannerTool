import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacySelectionCommands,
  createSelectionCommands,
} from '../../www/js/application/commands/selectionCommands.js';

describe('application/commands/selectionCommands', () => {
  beforeEach(() => {
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('setProjectSelected updates state-store projectIds', () => {
    const bus = { emit: vi.fn() };
    const commands = createSelectionCommands(store, bus);

    commands.setProjectSelected('p1', true);
    commands.setProjectSelected('p2', true);
    commands.setProjectSelected('p1', false);

    expect(store.getState().selection.projectIds).toEqual(['p2']);
    expect(bus.emit).toHaveBeenCalled();
  });

  it('setTeamSelected updates state-store teamIds', () => {
    const bus = { emit: vi.fn() };
    const commands = createSelectionCommands(store, bus);

    commands.setTeamSelected('t1', true);
    commands.setTeamSelected('t2', true);
    commands.setTeamSelected('t2', false);

    expect(store.getState().selection.teamIds).toEqual(['t1']);
    expect(bus.emit).toHaveBeenCalled();
  });

  it('bulk project/team updates replace id arrays from truthy selections', () => {
    const commands = createSelectionCommands(store, { emit: vi.fn() });

    commands.setProjectsSelectedBulk({ p1: true, p2: false, p3: 1 });
    commands.setTeamsSelectedBulk({ t1: false, t2: true });

    expect(store.getState().selection.projectIds).toEqual(['p1', 'p3']);
    expect(store.getState().selection.teamIds).toEqual(['t2']);
  });

  it('respects suppressEvents option for bulk updates', () => {
    const bus = { emit: vi.fn() };
    const commands = createSelectionCommands(store, bus);

    commands.setProjectsSelectedBulk({ p1: true }, { suppressEvents: true });
    commands.setTeamsSelectedBulk({ t1: true }, { suppressEvents: true });

    expect(store.getState().selection.projectIds).toEqual(['p1']);
    expect(store.getState().selection.teamIds).toEqual(['t1']);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('respects suppressEvents option for single updates', () => {
    const bus = { emit: vi.fn() };
    const commands = createSelectionCommands(store, bus);

    commands.setProjectSelected('p1', true, { suppressEvents: true });
    commands.setTeamSelected('t1', true, { suppressEvents: true });

    expect(store.getState().selection.projectIds).toEqual(['p1']);
    expect(store.getState().selection.teamIds).toEqual(['t1']);
    expect(bus.emit).not.toHaveBeenCalled();
  });

});
