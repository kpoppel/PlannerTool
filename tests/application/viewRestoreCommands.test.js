import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../www/js/core/EventBus.js';
import {
  CapacityEvents,
  FilterEvents,
  ViewEvents,
} from '../../www/js/core/EventRegistry.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createViewRestoreCommands } from '../../www/js/application/commands/viewRestoreCommands.js';
import { store } from '../../www/js/application/store.js';

describe('application/commands/viewRestoreCommands', () => {
  beforeEach(() => {
    store.setState(createInitialAppState(), true, 'test.resetStore');
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
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      id: 'default',
      name: 'Default View',
      readonly: true,
    });
    expect(store.getState().view.saved[0]).toMatchObject({
      id: 'default',
      name: 'Default View',
      readonly: true,
    });
    await cmd.saveCurrentView('Two');
    await cmd.renameView('v2', 'Two Renamed');
    await cmd.deleteView('v2');

    expect(dataService.listViews).toHaveBeenCalled();
    expect(dataService.saveView).toHaveBeenCalled();
  });

  it('saveCurrentView captures full state from store (projects, teams, filters, expansion)', async () => {
    store.setState(
      (state) => ({
        ...state,
        selection: {
          ...state.selection,
          projectIds: ['p1', 'p3'],
          teamIds: ['t2'],
          featureStateNames: ['Doing', 'Done'],
          taskTypeNames: ['feature', 'epic'],
          taskFilters: { schedule: { planned: true, unplanned: false } },
        },
        view: {
          ...state.view,
          options: { timelineScale: 'weeks', displayMode: 'compact' },
          expansion: { parentChild: true, relations: false, teamAllocated: true },
        },
      }),
      false,
      'test.setup'
    );

    let captured;
    const dataService = {
      listViews: vi.fn(async () => [{ id: 'vNew', name: 'My View' }]),
      saveView: vi.fn(async (payload) => {
        captured = payload;
        return { id: 'vNew', name: 'My View' };
      }),
    };

    const cmd = createViewRestoreCommands(store, dataService);
    await cmd.saveCurrentView('My View');

    expect(captured.selectedProjects).toEqual({ p1: true, p3: true });
    expect(captured.selectedTeams).toEqual({ t2: true });
    expect(captured.viewOptions.timelineScale).toBe('weeks');
    expect(captured.viewOptions.selectedFeatureStates).toEqual(['Doing', 'Done']);
    expect(captured.viewOptions.selectedTaskTypes).toEqual(['feature', 'epic']);
    expect(captured.viewOptions.taskFilters).toMatchObject({ schedule: { planned: true, unplanned: false } });
    expect(captured.viewOptions.expandParentChild).toBe(true);
    expect(captured.viewOptions.expandRelations).toBe(false);
    expect(captured.viewOptions.expandTeamAllocated).toBe(true);
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
          taskFilters: { schedule: { planned: false, unplanned: true }, relations: { hasLinks: true, noLinks: false } },
          capacityViewMode: 'project',
          expandParentChild: true,
          expandRelations: false,
          expandTeamAllocated: true,
          pluginState: { 'plugin-cost': { mode: 'team' } },
        },
      })),
    };
    const pluginStateCommands = {
      restoreFromView: vi.fn(async () => {}),
    };

    const emitSpy = vi.spyOn(bus, 'emit');
    const cmd = createViewRestoreCommands(store, dataService, pluginStateCommands);
    await cmd.loadAndApplyView('v1');

    const snapshot = store.getState();
    expect(snapshot.view.activeId).toBe('v1');
    expect(snapshot.selection.projectIds).toEqual(['p1', 'p3']);
    expect(snapshot.selection.teamIds).toEqual(['t2']);
    expect(snapshot.selection.featureStateNames).toEqual(['Doing', 'Done']);
    expect(snapshot.selection.taskTypeNames).toEqual(['feature']);
    expect(snapshot.selection.taskFilters).toMatchObject({
      schedule: { planned: false, unplanned: true },
      relations: { hasLinks: true, noLinks: false },
    });
    expect(snapshot.view.options.timelineScale).toBe('weeks');
    expect(snapshot.view.options.capacityViewMode).toBe('project');
    expect(snapshot.view.expansion).toEqual({
      parentChild: true,
      relations: false,
      teamAllocated: true,
    });
    expect(pluginStateCommands.restoreFromView).toHaveBeenCalledWith({
      'plugin-cost': { mode: 'team' },
    });
    expect(emitSpy).toHaveBeenCalledWith(FilterEvents.CHANGED);
    expect(emitSpy).toHaveBeenCalledWith(ViewEvents.CAPACITY_MODE);
    expect(emitSpy).toHaveBeenCalledWith(CapacityEvents.UPDATED);
    emitSpy.mockRestore();
  });

  it('does not delegate to legacy view services when loading or applying store views', async () => {
    const pluginStateCommands = {
      restoreFromView: vi.fn(async () => {}),
      captureForView: vi.fn(() => ({})),
    };

    const dataService = {
      listViews: vi.fn(async () => [{ id: 'v1', name: 'One' }]),
      getView: vi.fn(async () => ({
        id: 'v1',
        selectedProjects: { p1: true },
        selectedTeams: { t1: true },
        viewOptions: { timelineScale: 'weeks', pluginState: {} },
      })),
      saveView: vi.fn(async () => ({ id: 'v-new' })),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
    };

    const cmd = createViewRestoreCommands(store, dataService, pluginStateCommands);
    await cmd.loadViews();
    await cmd.loadAndApplyView('v1');

    expect(store.getState().view.activeId).toBe('v1');
    expect(store.getState().selection.projectIds).toEqual(['p1']);
    expect(store.getState().view.options.timelineScale).toBe('weeks');
    expect(dataService.listViews).toHaveBeenCalled();
    expect(dataService.getView).toHaveBeenCalledWith('v1');
    expect(pluginStateCommands.restoreFromView).toHaveBeenCalledWith({});

    await cmd.saveCurrentView('Name');
    expect(dataService.saveView).toHaveBeenCalled();
    expect(pluginStateCommands.captureForView).toHaveBeenCalled();
  });

  it('does not expose legacy compatibility adapters', async () => {
    const mod = await import('../../www/js/application/commands/viewRestoreCommands.js');
    expect(mod.createLegacyViewRestoreCommands).toBeUndefined();
  });

  it('loadAndApplyView applies explicit empty selection maps from payload', async () => {
    const dataService = {
      listViews: vi.fn(async () => [{ id: 'v1', name: 'One' }]),
      getView: vi.fn(async () => ({
        id: 'v1',
        name: 'One',
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: { timelineScale: 'weeks', pluginState: {} },
      })),
      saveView: vi.fn(async () => ({ id: 'v1' })),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
    };

    const cmd = createViewRestoreCommands(store, dataService, {
      restoreFromView: vi.fn(async () => {}),
    });

    await expect(cmd.loadAndApplyView('v1')).resolves.toBe('v1');
    expect(store.getState().selection.projectIds).toEqual([]);
    expect(store.getState().selection.teamIds).toEqual([]);
    expect(store.getState().view.activeId).toBe('v1');
    expect(store.getState().view.options.timelineScale).toBe('weeks');
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
        viewOptions: { timelineScale: 'quarters', pluginState: {} },
      })),
      saveView: vi.fn(async () => ({})),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
    };

    const cmd = createViewRestoreCommands(store, dataService, {
      restoreFromView: vi.fn(async () => {}),
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

  it('normalizes backend default view to synthetic readonly default view', async () => {
    const dataService = {
      listViews: vi.fn(async () => [
        {
          id: 'default',
          name: 'Mutable Default',
          readonly: false,
          selectedProjects: { p9: true },
          selectedTeams: { t9: true },
          viewOptions: { timelineScale: 'weeks' },
        },
        { id: 'v1', name: 'One' },
      ]),
      saveView: vi.fn(async () => ({ id: 'v1' })),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
    };

    const cmd = createViewRestoreCommands(store, dataService);
    const views = await cmd.loadViews();
    const defaultView = views.find((view) => view.id === 'default');

    expect(defaultView).toMatchObject({
      id: 'default',
      name: 'Default View',
      readonly: true,
      selectedProjects: {},
      selectedTeams: {},
      viewOptions: {},
    });
  });

  it('applies default view as full reset baseline with all selectors enabled', async () => {
    store.setState(
      (state) => ({
        ...state,
        baseline: {
          ...state.baseline,
          projects: [{ id: 'p1' }, { id: 'p2' }],
          teams: [{ id: 't1' }, { id: 't2' }],
          features: [
            { id: 'f1', state: 'Doing', type: 'Feature' },
            { id: 'f2', state: 'Done', type: 'Epic' },
          ],
        },
        scenarios: {
          ...state.scenarios,
          activeId: 'scenario-123',
        },
        selection: {
          ...state.selection,
          projectIds: ['p2'],
          teamIds: ['t2'],
          featureStateNames: ['Doing'],
          taskTypeNames: ['Feature'],
          taskFilters: {
            schedule: { planned: true, unplanned: false },
            allocation: { allocated: false, unallocated: true },
            hierarchy: { hasParent: false, noParent: true },
            relations: { hasLinks: false, noLinks: true },
          },
        },
        view: {
          ...state.view,
          options: {
            timelineScale: 'weeks',
            capacityViewMode: 'project',
            featureSortMode: 'date',
            displayMode: 'packed',
            showDependencies: true,
            showUnassignedCards: false,
            showUnplannedWork: false,
            showOnlyProjectHierarchy: true,
            hiddenTypes: ['epic'],
            expandParentChild: true,
            expandRelations: true,
            expandTeamAllocated: true,
          },
          expansion: {
            parentChild: true,
            relations: true,
            teamAllocated: true,
          },
        },
      }),
      false,
      'test.setup.defaultReset'
    );

    const dataService = {
      listViews: vi.fn(async () => [{ id: 'v1', name: 'One' }]),
      getView: vi.fn(async () => ({
        id: 'default',
        name: 'Default View',
        readonly: true,
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {},
      })),
      saveView: vi.fn(async () => ({})),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
    };

    const cmd = createViewRestoreCommands(store, dataService, {
      restoreFromView: vi.fn(async () => {}),
    });

    await cmd.loadViews();
    await cmd.loadAndApplyView('default');

    const snapshot = store.getState();
    expect(snapshot.view.activeId).toBe('default');
    expect(snapshot.scenarios.activeId).toBe('baseline');
    expect(snapshot.selection.projectIds).toEqual(['p1', 'p2']);
    expect(snapshot.selection.teamIds).toEqual(['t1', 't2']);
    expect(snapshot.selection.featureStateNames).toEqual(['Doing', 'Done']);
    expect(snapshot.selection.taskTypeNames).toEqual(['Feature', 'Epic']);
    expect(snapshot.selection.taskFilters).toEqual({
      schedule: { planned: true, unplanned: true },
      allocation: { allocated: true, unallocated: true },
      hierarchy: { hasParent: true, noParent: true },
      relations: { hasLinks: true, noLinks: true },
    });
    expect(snapshot.view.options).toMatchObject({
      timelineScale: 'months',
      featureSortMode: 'rank',
      capacityViewMode: 'team',
      displayMode: 'normal',
      showDependencies: false,
      showUnassignedCards: true,
      showUnplannedWork: true,
      showOnlyProjectHierarchy: false,
      hiddenTypes: [],
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    });
    expect(snapshot.view.expansion).toEqual({
      parentChild: false,
      relations: false,
      teamAllocated: false,
    });
  });

  it('restores expansion state from payload in store without relying on legacy expanded ids', async () => {
    const pluginStateCommands = {
      restoreFromView: vi.fn(async () => {}),
    };

    const dataService = {
      listViews: vi.fn(async () => []),
      saveView: vi.fn(async () => ({ id: 'v1' })),
      renameView: vi.fn(async () => {}),
      deleteView: vi.fn(async () => {}),
      getView: vi.fn(async () => ({
        id: 'v1',
        selectedProjects: {},
        selectedTeams: { 'team-signal-processing': true },
        viewOptions: {
          expandParentChild: false,
          expandRelations: false,
          expandTeamAllocated: false,
          taskFilters: {
            schedule: { planned: true, unplanned: true },
            allocation: { allocated: true, unallocated: true },
            hierarchy: { hasParent: true, noParent: true },
            relations: { hasLinks: true, noLinks: true },
          },
          pluginState: {},
        },
      })),
    };

    const cmd = createViewRestoreCommands(store, dataService, pluginStateCommands);
    await cmd.loadAndApplyView('v1');

    expect(store.getState().view.expansion).toEqual({
      parentChild: false,
      relations: false,
      teamAllocated: false,
    });
    expect(pluginStateCommands.restoreFromView).toHaveBeenCalledWith({});
  });
});
