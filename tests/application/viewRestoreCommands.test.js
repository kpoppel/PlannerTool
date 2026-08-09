import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyViewRestoreCommands,
  createViewRestoreCommands,
} from '../../www/js/application/commands/viewRestoreCommands.js';
import { store } from '../../www/js/application/store.js';

describe('application/commands/viewRestoreCommands', () => {
  beforeEach(() => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('legacy adapter delegates to viewManagementService', async () => {
    const state = {
      viewManagementService: {
        loadAndApplyView: vi.fn(async () => {}),
        saveCurrentView: vi.fn(async () => ({ id: 'v1' })),
        renameView: vi.fn(async () => {}),
        deleteView: vi.fn(async () => {}),
        loadViews: vi.fn(async () => []),
        restoreLastView: vi.fn(async () => {}),
      },
      captureCurrentView: vi.fn(() => ({ timelineScale: 'months' })),
    };

    const cmd = createLegacyViewRestoreCommands(state);
    await cmd.loadAndApplyView('v1');
    await cmd.saveCurrentView('Name', 'v1');
    await cmd.renameView('v1', 'Renamed');
    await cmd.deleteView('v1');
    await cmd.loadViews();
    await cmd.restoreLastView();
    expect(cmd.captureCurrentView()).toEqual({ timelineScale: 'months' });

    expect(state.viewManagementService.loadAndApplyView).toHaveBeenCalledWith('v1');
    expect(state.captureCurrentView).toHaveBeenCalledOnce();
  });

  it('store commands load and save views through dataService', async () => {
    const dataService = {
      listViews: vi.fn(async () => [{ id: 'v1', name: 'One' }]),
      saveView: vi.fn(async () => ({ id: 'v2', name: 'Two' })),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
    };

    const cmd = createViewRestoreCommands(store, dataService);
    const views = await cmd.loadViews();
    expect(views).toHaveLength(1);
    await cmd.saveCurrentView('Two');
    await cmd.renameView('v2', 'Two Renamed');
    await cmd.deleteView('v2');

    expect(dataService.listViews).toHaveBeenCalled();
    expect(dataService.saveView).toHaveBeenCalled();
  });

  it('loadAndApplyView applies stored view payload (selection/filter/options)', async () => {
    const dataService = {
      listViews: vi.fn(async () => []),
      saveView: vi.fn(async () => ({ id: 'v1' })),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
      getView: vi.fn(async () => ({
        id: 'v1',
        selectedProjects: { p1: true, p2: false, p3: true },
        selectedTeams: { t1: false, t2: true },
        viewOptions: {
          timelineScale: 'weeks',
          selectedFeatureStates: ['Doing', 'Done'],
          selectedTaskTypes: ['feature'],
          taskFilters: { schedule: 'planned', relations: 'all' },
          expandParentChild: true,
          expandRelations: false,
          expandTeamAllocated: true,
          pluginState: { 'plugin-cost': { mode: 'team' } },
        },
      })),
    };
    const legacyState = {
      restorePluginStateFromView: vi.fn(async () => {}),
    };

    const cmd = createViewRestoreCommands(store, dataService, legacyState);
    await cmd.loadAndApplyView('v1');

    const snapshot = store.getState();
    expect(snapshot.view.activeId).toBe('v1');
    expect(snapshot.selection.projectIds).toEqual(['p1', 'p3']);
    expect(snapshot.selection.teamIds).toEqual(['t2']);
    expect(snapshot.selection.featureStateNames).toEqual(['Doing', 'Done']);
    expect(snapshot.selection.taskTypeNames).toEqual(['feature']);
    expect(snapshot.selection.taskFilters).toMatchObject({
      schedule: 'planned',
      relations: 'all',
    });
    expect(snapshot.view.options.timelineScale).toBe('weeks');
    expect(snapshot.view.expansion).toEqual({
      parentChild: true,
      relations: false,
      teamAllocated: true,
    });
    expect(legacyState.restorePluginStateFromView).toHaveBeenCalledWith({
      'plugin-cost': { mode: 'team' },
    });
  });

  it('prefers legacy viewManagementService for loadAndApplyView and syncs store', async () => {
    const legacyState = {
      projects: [{ id: 'p1', selected: true }, { id: 'p2', selected: false }],
      teams: [{ id: 't1', selected: true }],
      scenarios: [{ id: 's1', name: 'Scenario 1' }],
      activeScenarioId: 's1',
      availableTaskTypes: ['epic', 'feature'],
      selectedFeatureStateFilter: new Set(['Doing']),
      expansionState: {
        expandParentChild: true,
        expandRelations: false,
        expandTeamAllocated: true,
      },
      taskFilterService: {
        getFilters: () => ({ schedule: { planned: true, unplanned: false } }),
      },
      _viewService: {
        isTypeVisible: (typeName) => typeName !== 'epic',
      },
      captureCurrentView: () => ({ timelineScale: 'weeks', displayMode: 'compact' }),
      getSidebarDisabledElements: () => ({ states: ['Done'] }),
      viewManagementService: {
        loadAndApplyView: vi.fn(async () => 'v-legacy'),
        getViews: () => [{ id: 'default', name: 'Default View' }, { id: 'v-legacy', name: 'Legacy' }],
        getActiveViewId: () => 'v-legacy',
      },
    };

    const dataService = {
      listViews: vi.fn(async () => []),
      getView: vi.fn(async () => null),
      saveView: vi.fn(async () => ({})),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
    };

    const cmd = createViewRestoreCommands(store, dataService, legacyState);
    await cmd.loadAndApplyView('v-legacy');

    const snapshot = store.getState();
    expect(legacyState.viewManagementService.loadAndApplyView).toHaveBeenCalledWith('v-legacy');
    expect(snapshot.selection.projectIds).toEqual(['p1']);
    expect(snapshot.selection.teamIds).toEqual(['t1']);
    expect(snapshot.selection.featureStateNames).toEqual(['Doing']);
    expect(snapshot.selection.taskTypeNames).toEqual(['feature']);
    expect(snapshot.scenarios.activeId).toBe('s1');
    expect(snapshot.view.activeId).toBe('v-legacy');
    expect(snapshot.view.saved.map((v) => v.id)).toEqual(['default', 'v-legacy']);
    expect(snapshot.view.options.timelineScale).toBe('weeks');
    expect(snapshot.view.options.displayMode).toBe('compact');
    expect(snapshot.view.options.hiddenTypes).toEqual(['epic']);
    expect(snapshot.view.expansion).toEqual({
      parentChild: true,
      relations: false,
      teamAllocated: true,
    });
  });

  it('restoreLastView restores last active view payload and falls back to default', async () => {
    const localStorageMock = {
      _value: 'v9',
      getItem: vi.fn(() => localStorageMock._value),
      setItem: vi.fn((_, value) => {
        localStorageMock._value = value;
      }),
      removeItem: vi.fn(() => {
        localStorageMock._value = null;
      }),
    };
    vi.stubGlobal('localStorage', localStorageMock);

    const dataService = {
      listViews: vi.fn(async () => [
        { id: 'v1', name: 'One' },
        { id: 'v2', name: 'Two' },
      ]),
      getView: vi.fn(async (id) => ({
        id,
        selectedProjects: { p7: true },
        selectedTeams: { t7: true },
        viewOptions: { timelineScale: 'quarters' },
      })),
      saveView: vi.fn(async () => ({})),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
    };

    const cmd = createViewRestoreCommands(store, dataService, {
      restorePluginStateFromView: vi.fn(async () => {}),
    });

    await cmd.restoreLastView();
    expect(store.getState().view.activeId).toBe('default');

    localStorageMock._value = 'v2';
    await cmd.restoreLastView();
    expect(dataService.getView).toHaveBeenCalledWith('v2');
    expect(store.getState().view.activeId).toBe('v2');
    expect(store.getState().selection.projectIds).toEqual(['p7']);

    vi.unstubAllGlobals();
  });
});
