import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createDataCommands,
  DataCommandEvents,
} from '../../www/js/application/commands/dataCommands.js';
import { featureFlags } from '../../www/js/config.js';
import { DataEvents, StateFilterEvents } from '../../www/js/core/EventRegistry.js';

function makeDataServiceMock(overrides = {}) {
  const getColorMappings = vi.fn(async () => ({ projectColors: {}, teamColors: {} }));
  return {
    callRestResult: vi.fn(async (methodName) => {
      const map = {
        getProjects: { ok: true, data: [] },
        getTeams: { ok: true, data: [] },
        getFeatures: { ok: true, data: [] },
        getIterationsConfig: { ok: true, data: { iterationSetsById: {} } },
        loadAllScenarios: { ok: true, data: [] },
      };
      return methodName in overrides ? overrides[methodName] : map[methodName];
    }),
    getColorMappings,
  };
}

describe('application/commands/dataCommands', () => {
  beforeEach(() => {
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('keeps organization capacity independent of the legacy selected-plan graph flag', () => {
    const dataService = makeDataServiceMock();
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);
    const originalGraphOnlySelectedPlans = featureFlags.GRAPH_ONLY_SELECTED_PLANS;
    featureFlags.GRAPH_ONLY_SELECTED_PLANS = true;
    store.setState((state) => ({
      ...state,
      baseline: {
        ...state.baseline,
        teams: [{ id: 't1' }, { id: 't2' }],
        projects: [{ id: 'p1' }, { id: 'p2' }],
        features: [
          {
            id: 'f1', project: 'p1', state: 'Active', start: '2025-01-01',
            end: '2025-01-01', capacity: [{ team: 't1', capacity: 20 }],
          },
          {
            id: 'f2', project: 'p2', state: 'Active', start: '2025-01-01',
            end: '2025-01-01', capacity: [{ team: 't2', capacity: 80 }],
          },
        ],
      },
      selection: {
        ...state.selection,
        projectIds: ['p1'],
        featureStateNames: ['Active'],
      },
    }), false, 'test.setCapacityBaseline');

    commands.recomputeCapacity();

    expect(store.getState().capacity.organizationDaily).toEqual([100]);
    expect(store.getState().capacity.organizationDailyPerTeamAverage).toEqual([50]);
    featureFlags.GRAPH_ONLY_SELECTED_PLANS = originalGraphOnlySelectedPlans;
  });

  it('keeps full-organization totals stable when presentation filters hide allocations', () => {
    const dataService = makeDataServiceMock();
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);
    store.setState((state) => ({
      ...state,
      baseline: {
        ...state.baseline,
        teams: [{ id: 't1' }, { id: 't2' }],
        projects: [{ id: 'p1', type: 'project' }, { id: 'p2', type: 'project' }],
        features: [
          {
            id: 'visible', project: 'p1', state: 'Active', type: 'Feature',
            start: '2025-01-01', end: '2025-01-01', capacity: [{ team: 't1', capacity: 20 }],
          },
          {
            id: 'hidden-context', project: 'p2', state: 'Done', type: 'Bug',
            start: '2025-01-01', end: '2025-01-01', capacity: [{ team: 't2', capacity: 110 }],
          },
        ],
      },
      selection: {
        ...state.selection,
        projectIds: ['p1'],
        teamIds: ['t1'],
        featureStateNames: ['Active'],
        taskFilters: { type: { Feature: true, Bug: false } },
      },
      view: {
        ...state.view,
        context: { parent: false, child: false, dependency: false, otherAllocations: false },
      },
    }), false, 'test.setPresentationFilteredCapacityBaseline');

    commands.recomputeCapacity();
    const before = structuredClone(store.getState().capacity);

    store.setState((state) => ({
      ...state,
      selection: {
        ...state.selection,
        teamIds: ['t2'],
        taskFilters: { type: { Feature: false, Bug: true } },
      },
      view: {
        ...state.view,
        context: { parent: true, child: true, dependency: true, otherAllocations: true },
      },
    }), false, 'test.changePresentationFilters');
    commands.recomputeCapacity();

    const after = store.getState().capacity;
    expect(before.organizationDaily).toEqual([130]);
    expect(before.organizationDailyPerTeamAverage).toEqual([65]);
    expect(before.teamDailyMap[0]).toEqual({ t1: 20, t2: 110 });
    expect(after.organizationDaily).toEqual(before.organizationDaily);
    expect(after.organizationDailyPerTeamAverage).toEqual(before.organizationDailyPerTeamAverage);
    expect(after.teamDailyMap).toEqual(before.teamDailyMap);
  });

  it('hydrateBaseline sets baseline slice and emits loaded events', async () => {
    const dataService = makeDataServiceMock({
      getProjects: {
        ok: true,
        data: [{ id: 'p1', state_display_sequence: [] }, { id: 'p2', state_display_sequence: [] }],
      },
      getTeams: { ok: true, data: [{ id: 't1' }, { id: 't2' }] },
      getFeatures: {
        ok: true,
        data: [
          {
            id: 'f1',
            project: 'p1',
            state: 'In Progress',
            start: '2025-01-01',
            end: '2025-01-05',
            capacity: [{ team: 't1', capacity: 4 }],
          },
          {
            id: 'f2',
            project: 'p2',
            state: 'Done',
            start: '2025-01-03',
            end: '2025-01-08',
            capacity: [{ team: 't2', capacity: 3 }],
          },
        ],
      },
      getIterationsConfig: {
        ok: true,
        data: { iterationSetsById: { p1: [{ id: 'iter-1' }] } },
      },
    });
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const result = await commands.hydrateBaseline();

    expect(result.ok).toBe(true);
    expect(store.getState().baseline.projects).toEqual([
      { id: 'p1', color: '#3498db', state_display_sequence: [] },
      { id: 'p2', color: '#2980b9', state_display_sequence: [] },
    ]);
    expect(store.getState().baseline.teams).toEqual([
      { id: 't1', color: '#3498db' },
      { id: 't2', color: '#2980b9' },
    ]);
    expect(store.getState().baseline.features).toEqual([
      {
        id: 'f1',
        project: 'p1',
        state: 'In Progress',
        start: '2025-01-01',
        end: '2025-01-05',
        capacity: [{ team: 't1', capacity: 4 }],
        originalRank: 0,
      },
      {
        id: 'f2',
        project: 'p2',
        state: 'Done',
        start: '2025-01-03',
        end: '2025-01-08',
        capacity: [{ team: 't2', capacity: 3 }],
        originalRank: 1,
      },
    ]);
    expect(store.getState().baseline.iterationsByProject).toEqual({
      p1: [{ id: 'iter-1' }],
    });
    expect(store.getState().capacity.projectDaily instanceof Array).toBe(true);
    expect(store.getState().selection.projectIds).toEqual([]);
    expect(store.getState().selection.teamIds).toEqual([]);
    expect(store.getState().groups.byPlanId).toEqual({
      p1: [],
      p2: [],
    });

    expect(bus.emit).toHaveBeenCalledWith(DataEvents.LOADED);
    expect(bus.emit).toHaveBeenCalledWith(StateFilterEvents.CHANGED);
    expect(bus.emit).toHaveBeenCalledWith(
      DataCommandEvents.BASELINE_HYDRATED,
      expect.objectContaining({ revision: expect.any(Number) })
    );
  });

  it('hydrateBaseline respects project-configured state_display_sequence order', async () => {
    const dataService = makeDataServiceMock({
      getProjects: {
        ok: true,
        data: [{
          id: 'p1',
          display_states: ['Closed', 'New', 'Resolved', 'Active', 'Defined'],
          state_display_sequence: [
            { types: ['New'] },
            { types: ['Defined'] },
            { types: ['Active'] },
            { types: ['Resolved'] },
            { types: ['Closed'] },
          ],
        }],
      },
      getTeams: { ok: true, data: [] },
      getFeatures: {
        ok: true,
        data: [
          { id: 'f1', project: 'p1', state: 'Closed' },
          { id: 'f2', project: 'p1', state: 'New' },
          { id: 'f3', project: 'p1', state: 'Resolved' },
          { id: 'f4', project: 'p1', state: 'Defined' },
          { id: 'f5', project: 'p1', state: 'Active' },
        ],
      },
      getIterationsConfig: { ok: true, data: { iterationSetsById: {} } },
    });
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const result = await commands.hydrateBaseline();

    expect(result.ok).toBe(true);
    expect(store.getState().selection.featureStateNames).toEqual([
      'New',
      'Defined',
      'Active',
      'Resolved',
      'Closed',
    ]);
    expect(bus.emit).toHaveBeenCalledWith(DataEvents.LOADED);
  });

  it('hydrateBaseline fails fast on non-ok Result and does not mutate baseline', async () => {
    const dataService = makeDataServiceMock({
      getFeatures: {
        ok: false,
        error: { message: 'backend_unavailable', status: 503, code: 'upstream_down' },
      },
    });
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const before = store.getState().baseline;
    const result = await commands.hydrateBaseline();

    expect(result.ok).toBe(false);
    expect(result.error).toEqual(
      expect.objectContaining({
        methodName: 'getFeatures',
        message: 'backend_unavailable',
        status: 503,
        code: 'upstream_down',
      })
    );
    expect(store.getState().baseline).toEqual(before);
    expect(bus.emit).toHaveBeenCalledWith(
      DataCommandEvents.HYDRATION_FAILED,
      expect.objectContaining({ phase: 'baseline' })
    );
  });

  it('hydrateScenarioData writes scenarios and emits hydrated event', async () => {
    const dataService = makeDataServiceMock({
      loadAllScenarios: {
        ok: true,
        data: [
          { id: 's1', name: 'S1', overrides: {}, filters: {}, view: {}, groupOverrides: {}, scenarioGroups: [] },
          { id: 's2', name: 'S2', overrides: {}, filters: {}, view: {}, groupOverrides: {}, scenarioGroups: [] },
        ],
      },
    });
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const result = await commands.hydrateScenarioData();

    expect(result.ok).toBe(true);
    expect(store.getState().scenarios.items).toEqual([
      {
        id: 'baseline',
        name: 'Baseline',
        readonly: true,
        overrides: {},
        groupOverrides: {},
        scenarioGroups: [],
      },
      {
        id: 's1',
        name: 'S1',
        overrides: {},
        filters: {},
        view: {},
        groupOverrides: {},
        scenarioGroups: [],
      },
      {
        id: 's2',
        name: 'S2',
        overrides: {},
        filters: {},
        view: {},
        groupOverrides: {},
        scenarioGroups: [],
      },
    ]);
    expect(store.getState().scenarios.changedIds).toEqual([]);
    expect(bus.emit).toHaveBeenCalledWith(DataCommandEvents.SCENARIOS_HYDRATED, {
      count: 2,
    });
  });

  it('hydrateScenarioData normalizes missing scenario metadata to the canonical shape', async () => {
    const dataService = makeDataServiceMock({
      loadAllScenarios: {
        ok: true,
        data: [{ id: 's1', name: 'S1', overrides: {}, filters: {}, view: {}, groupOverrides: {}, scenarioGroups: [] }],
      },
    });
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const result = await commands.hydrateScenarioData();

    expect(result.ok).toBe(true);
    expect(store.getState().scenarios.items[1]).toMatchObject({
      id: 's1',
      name: 'S1',
      overrides: {},
      filters: {},
      view: {},
      groupOverrides: {},
      scenarioGroups: [],
    });
    expect(store.getState().scenarios.changedIds).toEqual([]);
  });

  it('hydrateScenarioData accepts canonical scenario metadata from server', async () => {
    const dataService = makeDataServiceMock({
      loadAllScenarios: {
        ok: true,
        data: [{ id: 's1', name: 'S1', overrides: {}, filters: {}, view: {}, groupOverrides: {}, scenarioGroups: [] }],
      },
    });
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const result = await commands.hydrateScenarioData();

    expect(result.ok).toBe(true);
    expect(store.getState().scenarios.items[1]).toMatchObject({
      id: 's1',
      name: 'S1',
      overrides: {},
      filters: {},
      view: {},
      groupOverrides: {},
      scenarioGroups: [],
    });
    expect(store.getState().scenarios.changedIds).toEqual([]);
  });

  it('hydrateScenarioData fails fast on non-ok Result', async () => {
    const dataService = makeDataServiceMock({
      loadAllScenarios: { ok: false, error: { message: 'unauthorized', status: 401 } },
    });
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const result = await commands.hydrateScenarioData();

    expect(result.ok).toBe(false);
    expect(result.error).toEqual(
      expect.objectContaining({ methodName: 'loadAllScenarios', status: 401 })
    );
    expect(bus.emit).toHaveBeenCalledWith(
      DataCommandEvents.HYDRATION_FAILED,
      expect.objectContaining({ phase: 'scenarios' })
    );
  });

  it('hydrateBaseline accepts preloaded payloads without calling dataService', async () => {
    const dataService = makeDataServiceMock();
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const result = await commands.hydrateBaseline({
      preloaded: {
        projects: [{ id: 'p10', state_display_sequence: [] }],
        teams: [{ id: 't10' }],
        features: [{ id: 'f10' }],
        iterationsByProject: { p10: [{ id: 'iter-10' }] },
      },
    });

    expect(result.ok).toBe(true);
    expect(dataService.callRestResult).not.toHaveBeenCalled();
    expect(store.getState().baseline.projects).toEqual([
      { id: 'p10', color: expect.any(String), state_display_sequence: [] },
    ]);
    expect(store.getState().baseline.features).toEqual([{ id: 'f10', originalRank: 0 }]);
  });

  it('hydrateScenarioData accepts preloaded items without calling dataService', async () => {
    const dataService = makeDataServiceMock();
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const result = await commands.hydrateScenarioData({
      preloadedItems: [{ id: 's10', name: 'S10', overrides: {}, filters: {}, view: {}, groupOverrides: {}, scenarioGroups: [] }],
      activeId: 's10',
    });

    expect(result.ok).toBe(true);
    expect(dataService.callRestResult).not.toHaveBeenCalled();
    expect(store.getState().scenarios.items).toEqual([
      {
        id: 'baseline',
        name: 'Baseline',
        readonly: true,
        overrides: {},
        groupOverrides: {},
        scenarioGroups: [],
      },
      {
        id: 's10',
        name: 'S10',
        overrides: {},
        filters: {},
        view: {},
        groupOverrides: {},
        scenarioGroups: [],
      },
    ]);
    expect(store.getState().scenarios.activeId).toBe('s10');
  });

  it('hydrateBaseline fails loudly on ok Result with invalid projects shape and does not mutate state', async () => {
    const dataService = makeDataServiceMock({
      getProjects: { ok: true, data: { id: 'not-an-array' } },
    });
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const beforeBaseline = structuredClone(store.getState().baseline);
    const beforeLifecycle = structuredClone(store.getState().lifecycle);
    const result = await commands.hydrateBaseline();

    expect(result.ok).toBe(false);
    expect(result.error).toEqual(
      expect.objectContaining({
        code: 'invalid_payload_shape',
        methodName: 'getProjects',
      })
    );
    expect(store.getState().baseline).toEqual(beforeBaseline);
    expect(store.getState().lifecycle).toEqual(beforeLifecycle);
    expect(bus.emit).toHaveBeenCalledWith(
      DataCommandEvents.HYDRATION_FAILED,
      expect.objectContaining({ phase: 'baseline' })
    );
  });

  it('hydrateBaseline fails on invalid preloaded shape and does not mutate state', async () => {
    const dataService = makeDataServiceMock();
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const beforeBaseline = structuredClone(store.getState().baseline);
    const beforeLifecycle = structuredClone(store.getState().lifecycle);
    const result = await commands.hydrateBaseline({
      preloaded: {
        projects: [{ id: 'p10', state_display_sequence: [] }],
        teams: [{ id: 't10' }],
        features: [{ id: 'f10' }],
        iterationSetsById: null,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toEqual(
      expect.objectContaining({
        code: 'invalid_payload_shape',
      })
    );
    expect(store.getState().baseline).toEqual(beforeBaseline);
    expect(store.getState().lifecycle).toEqual(beforeLifecycle);
    expect(dataService.callRestResult).not.toHaveBeenCalled();
    expect(bus.emit).toHaveBeenCalledWith(
      DataCommandEvents.HYDRATION_FAILED,
      expect.objectContaining({ phase: 'baseline' })
    );
  });

  it('hydrateScenarioData accepts preloaded items without calling dataService', async () => {
    const dataService = makeDataServiceMock();
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const result = await commands.hydrateScenarioData({
      preloadedItems: [{ id: 's10', name: undefined, overrides: {}, filters: {}, view: {}, groupOverrides: {}, scenarioGroups: [] }],
      activeId: 's10',
    });

    expect(result.ok).toBe(true);
    expect(dataService.callRestResult).not.toHaveBeenCalled();
    expect(store.getState().scenarios.items).toEqual([
      {
        id: 'baseline',
        name: 'Baseline',
        readonly: true,
        overrides: {},
        groupOverrides: {},
        scenarioGroups: [],
      },
      {
        id: 's10',
        name: undefined,
        overrides: {},
        filters: {},
        view: {},
        groupOverrides: {},
        scenarioGroups: [],
      },
    ]);
    expect(store.getState().scenarios.changedIds).toEqual([]);
    expect(store.getState().scenarios.activeId).toBe('s10');
  });

  it('hydrateScenarioData fails loudly on ok Result with invalid scenarios shape', async () => {
    const dataService = makeDataServiceMock({
      loadAllScenarios: { ok: true, data: { id: 'not-an-array' } },
    });
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    const beforeScenarios = structuredClone(store.getState().scenarios);
    const result = await commands.hydrateScenarioData();

    expect(result.ok).toBe(false);
    expect(result.error).toEqual(
      expect.objectContaining({
        code: 'invalid_payload_shape',
        methodName: 'loadAllScenarios',
      })
    );
    expect(store.getState().scenarios).toEqual(beforeScenarios);
    expect(bus.emit).toHaveBeenCalledWith(
      DataCommandEvents.HYDRATION_FAILED,
      expect.objectContaining({ phase: 'scenarios' })
    );
  });

  it('hydrateScenarioData allows explicit activeId clearing via null', async () => {
    const dataService = makeDataServiceMock();
    const bus = { emit: vi.fn() };
    const commands = createDataCommands(store, bus, dataService);

    store.setState((state) => ({
      ...state,
      scenarios: {
        ...state.scenarios,
        activeId: 'existing',
      },
    }), false, 'test.seedActiveScenario');

    const result = await commands.hydrateScenarioData({
      preloadedItems: [],
      activeId: null,
    });

    expect(result.ok).toBe(true);
    expect(store.getState().scenarios.activeId).toBe(null);
  });

});
