import { DataEvents } from '../../core/EventRegistry.js';

export const DataCommandEvents = {
  BASELINE_HYDRATED: Symbol('data-command:baseline-hydrated'),
  SCENARIOS_HYDRATED: Symbol('data-command:scenarios-hydrated'),
  HYDRATION_FAILED: Symbol('data-command:hydration-failed'),
};

function toError(result, methodName) {
  const message = result?.error?.message || `Hydration failed at ${methodName}`;
  return {
    message,
    methodName,
    code: result?.error?.code || null,
    status: result?.error?.status || null,
  };
}

function shapeError({ phase, methodName, field, expected, value }) {
  const actual = Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value);
  return {
    message: `Invalid hydration payload for ${field}: expected ${expected}, got ${actual}`,
    methodName,
    code: 'invalid_payload_shape',
    status: null,
    details: {
      phase,
      field,
      expected,
      actual,
    },
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asFailure(bus, phase, error) {
  const failure = { ok: false, error };
  bus.emit(DataCommandEvents.HYDRATION_FAILED, {
    phase,
    error,
  });
  return failure;
}

async function callStrict(dataService, methodName, ...args) {
  const result = await dataService.callRestResult(methodName, ...args);
  if (!result?.ok) {
    return { ok: false, error: toError(result, methodName) };
  }
  return { ok: true, data: result.data };
}

export function createDataCommands(store, bus, dataService) {
  return {
    async hydrateBaseline(options = {}) {
      const preloaded = options?.preloaded || null;
      const hasPreloaded = preloaded && typeof preloaded === 'object';

      const projectsResult = hasPreloaded ?
        { ok: true, data: preloaded.projects }
      : await callStrict(dataService, 'getProjects');
      if (!projectsResult.ok) return asFailure(bus, 'baseline', projectsResult.error);

      const teamsResult = hasPreloaded ?
        { ok: true, data: preloaded.teams }
      : await callStrict(dataService, 'getTeams');
      if (!teamsResult.ok) return asFailure(bus, 'baseline', teamsResult.error);

      const featuresResult = hasPreloaded ?
        { ok: true, data: preloaded.features }
      : await callStrict(dataService, 'getFeatures');
      if (!featuresResult.ok) return asFailure(bus, 'baseline', featuresResult.error);

      const iterationsResult = hasPreloaded ?
        {
          ok: true,
          data: {
            iterationSetsById:
              preloaded.iterationSetsById !== undefined ?
                preloaded.iterationSetsById
              : preloaded.iterationsByProject,
          },
        }
      : await callStrict(dataService, 'getIterationsConfig');
      if (!iterationsResult.ok) return asFailure(bus, 'baseline', iterationsResult.error);

      if (!Array.isArray(projectsResult.data)) {
        return asFailure(
          bus,
          'baseline',
          shapeError({
            phase: 'baseline',
            methodName: hasPreloaded ? 'preloaded.projects' : 'getProjects',
            field: 'projects',
            expected: 'array',
            value: projectsResult.data,
          })
        );
      }
      if (!Array.isArray(teamsResult.data)) {
        return asFailure(
          bus,
          'baseline',
          shapeError({
            phase: 'baseline',
            methodName: hasPreloaded ? 'preloaded.teams' : 'getTeams',
            field: 'teams',
            expected: 'array',
            value: teamsResult.data,
          })
        );
      }
      if (!Array.isArray(featuresResult.data)) {
        return asFailure(
          bus,
          'baseline',
          shapeError({
            phase: 'baseline',
            methodName: hasPreloaded ? 'preloaded.features' : 'getFeatures',
            field: 'features',
            expected: 'array',
            value: featuresResult.data,
          })
        );
      }

      const iterationSetsById = iterationsResult.data?.iterationSetsById;
      if (!isPlainObject(iterationSetsById)) {
        return asFailure(
          bus,
          'baseline',
          shapeError({
            phase: 'baseline',
            methodName: hasPreloaded ? 'preloaded.iterationSetsById' : 'getIterationsConfig',
            field: 'iterationSetsById',
            expected: 'object',
            value: iterationSetsById,
          })
        );
      }

      const projects = projectsResult.data;
      const teams = teamsResult.data;
      const features = featuresResult.data;

      const featuresWithRank = features.map((feature, index) => ({
        ...feature,
        originalRank: index,
      }));

      const revision = Date.now();
      store.setState(
        (state) => ({
          ...state,
          lifecycle: {
            ...state.lifecycle,
            status: 'ready',
            error: null,
          },
          baseline: {
            ...state.baseline,
            revision,
            projects,
            teams,
            features: featuresWithRank,
            iterationsByProject: iterationSetsById,
          },
        }),
        false,
        'data.hydrateBaseline'
      );

      bus.emit(DataEvents.LOADED, {
        phase: 'baseline',
        revision,
        counts: {
          projects: projects.length,
          teams: teams.length,
          features: featuresWithRank.length,
        },
      });
      bus.emit(DataCommandEvents.BASELINE_HYDRATED, { revision });

      return {
        ok: true,
        data: {
          revision,
          projects,
          teams,
          features: featuresWithRank,
          iterationsByProject: iterationSetsById,
        },
      };
    },

    async hydrateScenarioData(options = {}) {
      const hasPreloadedItems = Object.prototype.hasOwnProperty.call(options || {}, 'preloadedItems');
      const scenariosResult = hasPreloadedItems ?
        { ok: true, data: options.preloadedItems }
      : await callStrict(dataService, 'loadAllScenarios');
      if (!scenariosResult.ok) {
        return asFailure(bus, 'scenarios', scenariosResult.error);
      }
      if (!Array.isArray(scenariosResult.data)) {
        return asFailure(
          bus,
          'scenarios',
          shapeError({
            phase: 'scenarios',
            methodName: hasPreloadedItems ? 'preloadedItems' : 'loadAllScenarios',
            field: 'scenarios',
            expected: 'array',
            value: scenariosResult.data,
          })
        );
      }

      const scenarioItems = scenariosResult.data;
      const hasActiveId = Object.prototype.hasOwnProperty.call(options || {}, 'activeId');

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: scenarioItems,
            // Preserve current activeId only when the caller does not provide one.
            activeId: hasActiveId ? options.activeId : state.scenarios.activeId,
          },
        }),
        false,
        'data.hydrateScenarioData'
      );

      bus.emit(DataCommandEvents.SCENARIOS_HYDRATED, {
        count: scenarioItems.length,
      });

      return {
        ok: true,
        data: {
          count: scenarioItems.length,
          items: scenarioItems,
        },
      };
    },
  };
}
