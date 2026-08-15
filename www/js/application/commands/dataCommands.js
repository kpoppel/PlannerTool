import {
  DataEvents,
  CapacityEvents,
  StateFilterEvents,
} from '../../core/EventRegistry.js';
import { CapacityCalculator } from '../../services/CapacityCalculator.js';
import { ColorService, PALETTE } from '../../services/ColorService.js';
import { featureFlags } from '../../config.js';

// Passed as bus to the store-owned CapacityCalculator so it never double-emits.
const NO_OP_BUS = { emit: () => {}, on: () => {}, off: () => {} };

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

function derivePaletteColor(item, mappedColor, fallbackIndex) {
  if (item?.color) return item.color;
  if (mappedColor) return mappedColor;
  return PALETTE[fallbackIndex % PALETTE.length] || '#3498db';
}

function deriveOrderedFeatureStateNames(projects, features) {
  const featureStates = new Set();
  for (const feature of features || []) {
    const stateName = feature?.state;
    if (!stateName) continue;
    featureStates.add(String(stateName));
  }

  const ordered = [];
  const seen = new Set();

  for (const project of projects || []) {
    const raw = project?.state_display_sequence || project?.stateDisplaySequence || [];
    if (!Array.isArray(raw)) continue;

    for (const item of raw) {
      if (!item || typeof item !== 'object' || !Array.isArray(item.types)) continue;
      for (const stateName of item.types) {
        const value = String(stateName || '').trim();
        if (!value || !featureStates.has(value) || seen.has(value)) continue;
        seen.add(value);
        ordered.push(value);
      }
    }
  }

  for (const stateName of featureStates) {
    if (seen.has(stateName)) continue;
    ordered.push(stateName);
  }

  return ordered;
}

export function createDataCommands(store, bus, dataService) {
  const capacityCalculator = new CapacityCalculator(NO_OP_BUS);

  function deriveEffectiveFeaturesFromState(state) {
    const baseline = Array.isArray(state?.baseline?.features) ? state.baseline.features : [];
    const activeId = state?.scenarios?.activeId ?? 'baseline';
    const scenario = (state?.scenarios?.items || []).find((s) => s.id === activeId);
    const overrides = scenario?.overrides || {};
    return baseline.map((f) => {
      const override = overrides[String(f?.id ?? '')];
      return override ? { ...f, ...override } : { ...f };
    });
  }

  function buildChildrenByParentMap(features) {
    const map = new Map();
    for (const f of Array.isArray(features) ? features : []) {
      if (!f?.parentId) continue;
      const key = String(f.parentId);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(String(f.id));
    }
    return map;
  }

  return {
    recomputeCapacity(changedFeatureIds = null) {
      const state = store.getState();
      const features = deriveEffectiveFeaturesFromState(state);
      const teams = Array.isArray(state?.baseline?.teams) ? state.baseline.teams : [];
      const projects = Array.isArray(state?.baseline?.projects) ? state.baseline.projects : [];
      const selectedProjectIds = (state?.selection?.projectIds || []).map((id) => String(id));
      const selectedTeamIds = (state?.selection?.teamIds || []).map((id) => String(id));
      const selectedStateIds = (state?.selection?.featureStateNames || []).map((s) => String(s));
      // When GRAPH_ONLY_SELECTED_PLANS is off (default), graph always shows all plans.
      const projectsForFilter =
        featureFlags.GRAPH_ONLY_SELECTED_PLANS ?
          selectedProjectIds
        : projects.map((p) => String(p.id));

      capacityCalculator.setChildrenByParent(buildChildrenByParentMap(features));
      const result = capacityCalculator.calculate(
        features,
        { selectedProjects: projectsForFilter, selectedTeams: selectedTeamIds, selectedStates: selectedStateIds },
        teams,
        projects,
        changedFeatureIds
      );

      store.setState(
        (s) => ({
          ...s,
          capacity: {
            dates: result.dates,
            teamDaily: result.teamDailyCapacity,
            teamDailyMap: result.teamDailyCapacityMap,
            projectDailyRaw: result.projectDailyCapacityRaw,
            projectDaily: result.projectDailyCapacity,
            projectDailyMap: result.projectDailyCapacityMap,
            organizationDaily: result.totalOrgDailyCapacity,
            organizationDailyPerTeamAverage: result.totalOrgDailyPerTeamAvg,
          },
        }),
        false,
        'data.recomputeCapacity'
      );
      bus.emit(CapacityEvents.UPDATED);
    },

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

      const projects = Array.isArray(projectsResult.data) ? projectsResult.data : [];
      const teams = Array.isArray(teamsResult.data) ? teamsResult.data : [];
      const features = Array.isArray(featuresResult.data) ? featuresResult.data : [];

      const colorMappings = typeof dataService?.getColorMappings === 'function'
        ? await dataService.getColorMappings()
        : { projectColors: {}, teamColors: {} };
      const projectColorMap = colorMappings?.projectColors || {};
      const teamColorMap = colorMappings?.teamColors || {};

      const hydratedProjects = projects.map((project, index) => ({
        ...project,
        color: derivePaletteColor(project, projectColorMap[String(project?.id)], index),
      }));
      const hydratedTeams = teams.map((team, index) => ({
        ...team,
        color: derivePaletteColor(team, teamColorMap[String(team?.id)], index),
      }));

      const featuresWithRank = features.map((feature, index) => ({
        ...feature,
        originalRank: index,
      }));

      const revision = Date.now();
      const defaultFeatureStateNames = deriveOrderedFeatureStateNames(
        hydratedProjects,
        featuresWithRank
      );

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
            projects: hydratedProjects,
            teams: hydratedTeams,
            features: featuresWithRank,
            iterationsByProject: iterationSetsById,
          },
          selection: {
            ...state.selection,
            projectIds: state.selection.projectIds,
            teamIds: state.selection.teamIds,
            featureStateNames: Array.isArray(state.selection.featureStateNames) &&
              state.selection.featureStateNames.length > 0
              ? state.selection.featureStateNames
              : defaultFeatureStateNames,
          },
        }),
        false,
        'data.hydrateBaseline'
      );

      this.recomputeCapacity();

      bus.emit(StateFilterEvents.CHANGED);
      bus.emit(DataEvents.LOADED);
      bus.emit(DataCommandEvents.BASELINE_HYDRATED, { revision });

      return {
        ok: true,
        data: {
          revision,
          projects: hydratedProjects,
          teams: hydratedTeams,
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

      const baseline = {
        id: 'baseline',
        name: 'Baseline',
        readonly: true,
        overrides: {},
        groupOverrides: {},
        scenarioGroups: [],
      };

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: [
              baseline,
              ...scenarioItems.filter((scenario) => scenario && typeof scenario === 'object' && scenario.id != null),
            ],
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
