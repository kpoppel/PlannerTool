import {
  DataEvents,
  CapacityEvents,
  StateFilterEvents,
} from '../../core/EventRegistry.js';
import { CapacityCalculator } from '../../services/CapacityCalculator.js';
import { ColorService, PALETTE } from '../../services/ColorService.js';
import { featureFlags } from '../../config.js';
import {
  buildChildrenByParentMap,
  deriveEffectiveFeatures,
} from '../shared/featureProjection.js';
import { deriveOrderedFeatureStateNames } from '../shared/stateDerivations.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */
/** @typedef {import('../types.js').AppState} AppState */

// Passed as bus to the store-owned CapacityCalculator so it never double-emits.
const NO_OP_BUS = { emit: () => {}, on: () => {}, off: () => {} };

export const DataCommandEvents = {
  BASELINE_HYDRATED: Symbol('data-command:baseline-hydrated'),
  SCENARIOS_HYDRATED: Symbol('data-command:scenarios-hydrated'),
  HYDRATION_FAILED: Symbol('data-command:hydration-failed'),
};

function toError(result, methodName) {
  const message = result.error.message === undefined ? `Hydration failed at ${methodName}` : result.error.message;
  return {
    message,
    methodName,
    code: result.error.code === undefined ? null : result.error.code,
    status: result.error.status === undefined ? null : result.error.status,
  };
}

function shapeError({ phase, methodName, field, expected, value }) {
  const actual = value instanceof Array ? 'array' : (value === null ? 'null' : typeof value);
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
  return value !== null && typeof value === 'object' && !(value instanceof Array);
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
  if (!result.ok) {
    return { ok: false, error: toError(result, methodName) };
  }
  return { ok: true, data: result.data };
}

function derivePaletteColor(item, mappedColor, fallbackIndex) {
  if (item.color) return item.color;
  if (mappedColor) return mappedColor;
  const color = PALETTE[fallbackIndex % PALETTE.length];
  if (color === undefined) return '#3498db';
  return color;
}

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 * @param {any} dataService
 * @returns {object}
 */
export function createDataCommands(store, bus, dataService) {
  const capacityCalculator = new CapacityCalculator(NO_OP_BUS);

  const commands = {
    recomputeCapacity(changedFeatureIds = null) {
      const state = store.getState();
      const features = deriveEffectiveFeatures(state, { includeDirtyMetadata: false });
      const teams = state.baseline.teams;
      const projects = state.baseline.projects;
      const selectedProjectIds = state.selection.projectIds.map((id) => String(id));
      const organizationTeamIds = teams.map((team) => String(team.id));
      const organizationStateIds = Array.from(
        new Set(features.map((feature) => String(feature.state)))
      );
      const projectsForFilter = projects.map((p) => String(p.id));

      capacityCalculator.setChildrenByParent(buildChildrenByParentMap(features));
      const result = capacityCalculator.calculate(
        features,
        { selectedProjects: projectsForFilter, selectedTeams: organizationTeamIds, selectedStates: organizationStateIds },
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
      const preloaded = options.preloaded;
      const hasPreloaded = preloaded !== undefined && preloaded !== null;

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

      if (!(projectsResult.data instanceof Array)) {
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
      if (!(teamsResult.data instanceof Array)) {
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
      if (!(featuresResult.data instanceof Array)) {
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

      const iterationSetsById = iterationsResult.data.iterationSetsById;
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

      const colorMappings = typeof dataService.getColorMappings === 'function'
        ? await dataService.getColorMappings()
        : { projectColors: {}, teamColors: {} };
      const projectColorMap = colorMappings.projectColors;
      const teamColorMap = colorMappings.teamColors;

      const hydratedProjects = projects.map((project, index) => ({
        ...project,
        color: derivePaletteColor(project, projectColorMap[String(project.id)], index),
      }));
      const hydratedTeams = teams.map((team, index) => ({
        ...team,
        color: derivePaletteColor(team, teamColorMap[String(team.id)], index),
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
        (state) => {
          const nextGroupsByPlanId = { ...state.groups.byPlanId };
          for (const project of hydratedProjects) {
            const planId = String(project.id);
            if (!Object.prototype.hasOwnProperty.call(nextGroupsByPlanId, planId)) {
              nextGroupsByPlanId[planId] = [];
            }
          }

          return {
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
            groups: {
              ...state.groups,
              byPlanId: nextGroupsByPlanId,
            },
            selection: {
              ...state.selection,
              projectIds: state.selection.projectIds,
              teamIds: state.selection.teamIds,
              featureStateNames: state.selection.featureStateNames instanceof Array &&
                state.selection.featureStateNames.length > 0
                ? state.selection.featureStateNames
                : defaultFeatureStateNames,
            },
          };
        },
        false,
        'data.hydrateBaseline'
      );

      commands.recomputeCapacity();

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
      const hasPreloadedItems = Object.prototype.hasOwnProperty.call(options, 'preloadedItems');
      const scenariosResult = hasPreloadedItems ?
        { ok: true, data: options.preloadedItems }
      : await callStrict(dataService, 'loadAllScenarios');
      if (!scenariosResult.ok) {
        return asFailure(bus, 'scenarios', scenariosResult.error);
      }
      if (!(scenariosResult.data instanceof Array)) {
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
      const hasActiveId = Object.prototype.hasOwnProperty.call(options, 'activeId');

      const normalisedScenarioItems = scenarioItems
        .filter((scenario) => scenario && typeof scenario === 'object' && scenario.id != null)
        .map((scenario) => ({
          ...scenario,
          overrides: scenario.overrides === undefined ? {} : scenario.overrides,
          filters: scenario.filters === undefined ? {} : scenario.filters,
          view: scenario.view === undefined ? {} : scenario.view,
          groupOverrides: scenario.groupOverrides === undefined ? {} : scenario.groupOverrides,
          scenarioGroups: scenario.scenarioGroups instanceof Array ? scenario.scenarioGroups : [],
          pluginData: isPlainObject(scenario.pluginData) ? scenario.pluginData : {},
        }));

      const baseline = {
        id: 'baseline',
        name: 'Baseline',
        readonly: true,
        overrides: {},
        groupOverrides: {},
        scenarioGroups: [],
        pluginData: {},
      };

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: [baseline, ...normalisedScenarioItems],
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

  return commands;
}
