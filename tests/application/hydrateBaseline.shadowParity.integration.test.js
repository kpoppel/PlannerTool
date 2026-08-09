import { beforeEach, describe, expect, it, vi } from 'vitest';

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b))) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!(key in a) || !(key in b)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

describe('Phase 3 integration shadow parity', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('matches legacy init output when hydrating from the same payload snapshot', async () => {
    const fixtures = {
      projects: [{ id: 'p1', name: 'Plan 1', selected: true }],
      teams: [{ id: 't1', name: 'Team 1', selected: true }],
      features: [
        {
          id: 'f1',
          title: 'Feature 1',
          project: 'p1',
          team: 't1',
          relations: [],
          capacity: [{ team: 't1', capacity: 100 }],
          start: '2026-01-01',
          end: '2026-01-10',
        },
      ],
      iterationSetsById: { p1: [{ id: 'iter-1', name: 'I1' }] },
      scenarios: [{ id: 's1', name: 'Scenario 1', overrides: {}, readonly: false }],
    };

    const dataServiceMock = {
      init: vi.fn(async () => {}),
      getProjects: vi.fn(async () => fixtures.projects),
      getTeams: vi.fn(async () => fixtures.teams),
      getFeatures: vi.fn(async () => fixtures.features),
      getIterationsConfig: vi.fn(async () => ({ iterationSetsById: fixtures.iterationSetsById })),
      loadAllScenarios: vi.fn(async () => fixtures.scenarios),
      listViews: vi.fn(async () => []),
      getView: vi.fn(async () => null),
      getColorMappings: vi.fn(async () => ({ projectColors: {}, teamColors: {} })),
      getLocalPref: vi.fn(async () => null),
      setLocalPref: vi.fn(async () => true),
      callRestResult: vi.fn(async () => ({ ok: false, error: { message: 'unused' } })),
    };

    vi.doMock('../../www/js/services/dataService.js', () => ({
      dataService: dataServiceMock,
    }));

    const [{ state }, { store }, { createInitialAppState }, { createDataCommands }, { bus }] =
      await Promise.all([
        import('../../www/js/services/State.js'),
        import('../../www/js/application/store.js'),
        import('../../www/js/application/createInitialAppState.js'),
        import('../../www/js/application/commands/dataCommands.js'),
        import('../../www/js/core/EventBus.js'),
      ]);

    await state.initState();

    const legacySnapshot = {
      projects: structuredClone(state.baselineProjects),
      teams: structuredClone(state.baselineTeams),
      features: structuredClone(state.baselineFeatures),
      iterationsByProject: structuredClone(state._dataInitService.iterationSetsById || {}),
      activeScenarioId: state.activeScenarioId || null,
      scenarioItems: structuredClone((state.scenarios || []).filter((item) => !item?.readonly)),
    };

    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(createInitialAppState(), true, 'test.resetStore');
    const commands = createDataCommands(store, bus, dataServiceMock);

    const baselineResult = await commands.hydrateBaseline({
      preloaded: {
        projects: legacySnapshot.projects,
        teams: legacySnapshot.teams,
        features: legacySnapshot.features,
        iterationsByProject: legacySnapshot.iterationsByProject,
      },
    });
    const scenariosResult = await commands.hydrateScenarioData({
      preloadedItems: legacySnapshot.scenarioItems,
      activeId: legacySnapshot.activeScenarioId,
    });

    expect(baselineResult.ok).toBe(true);
    expect(scenariosResult.ok).toBe(true);

    // Preloaded mode must not perform strict REST calls.
    expect(dataServiceMock.callRestResult).not.toHaveBeenCalled();

    const current = store.getState();
    const expectedBaseline = {
      revision: current.baseline.revision,
      projects: legacySnapshot.projects,
      teams: legacySnapshot.teams,
      features: legacySnapshot.features,
      iterationsByProject: legacySnapshot.iterationsByProject,
    };
    const expectedScenarios = {
      activeId: legacySnapshot.activeScenarioId,
      items: legacySnapshot.scenarioItems,
    };

    expect(deepEqual(current.baseline, expectedBaseline)).toBe(true);
    expect(deepEqual(current.scenarios, expectedScenarios)).toBe(true);
  });

  it('fails fast on non-ok strict Result in hydration path', async () => {
    const dataServiceMock = {
      callRestResult: vi.fn(async (methodName) => {
        if (methodName === 'getProjects') {
          return { ok: false, error: { message: 'backend_unavailable', status: 503 } };
        }
        return { ok: true, data: [] };
      }),
    };

    const [{ store }, { createInitialAppState }, { createDataCommands }, { bus }] =
      await Promise.all([
        import('../../www/js/application/store.js'),
        import('../../www/js/application/createInitialAppState.js'),
        import('../../www/js/application/commands/dataCommands.js'),
        import('../../www/js/core/EventBus.js'),
      ]);

    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(createInitialAppState(), true, 'test.resetStore');
    const commands = createDataCommands(store, bus, dataServiceMock);

    const result = await commands.hydrateBaseline();

    expect(result.ok).toBe(false);
    expect(result.error).toEqual(
      expect.objectContaining({
        message: 'backend_unavailable',
        methodName: 'getProjects',
        status: 503,
      })
    );
  });

  it('hydrates baseline and scenarios on strict Result happy path', async () => {
    const dataServiceMock = {
      callRestResult: vi.fn(async (methodName) => {
        if (methodName === 'getProjects') return { ok: true, data: [{ id: 'p1' }] };
        if (methodName === 'getTeams') return { ok: true, data: [{ id: 't1' }] };
        if (methodName === 'getFeatures') return { ok: true, data: [{ id: 'f1' }] };
        if (methodName === 'getIterationsConfig') {
          return { ok: true, data: { iterationSetsById: { p1: [{ id: 'iter-1' }] } } };
        }
        if (methodName === 'loadAllScenarios') {
          return { ok: true, data: [{ id: 's1', name: 'Scenario 1' }] };
        }
        return { ok: false, error: { message: `unexpected ${methodName}` } };
      }),
    };

    const [{ store }, { createInitialAppState }, { createDataCommands }, { bus }] =
      await Promise.all([
        import('../../www/js/application/store.js'),
        import('../../www/js/application/createInitialAppState.js'),
        import('../../www/js/application/commands/dataCommands.js'),
        import('../../www/js/core/EventBus.js'),
      ]);

    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(createInitialAppState(), true, 'test.resetStore');
    const commands = createDataCommands(store, bus, dataServiceMock);

    const baseline = await commands.hydrateBaseline();
    const scenarios = await commands.hydrateScenarioData();

    expect(baseline.ok).toBe(true);
    expect(scenarios.ok).toBe(true);

    const state = store.getState();
    expect(state.baseline.projects).toEqual([{ id: 'p1' }]);
    expect(state.baseline.teams).toEqual([{ id: 't1' }]);
    expect(state.baseline.features).toEqual([{ id: 'f1', originalRank: 0 }]);
    expect(state.baseline.iterationsByProject).toEqual({ p1: [{ id: 'iter-1' }] });
    expect(state.scenarios.items).toEqual([{ id: 's1', name: 'Scenario 1' }]);
  });
});
