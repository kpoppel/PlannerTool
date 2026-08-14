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

function getExplicitOrDefaultSelectedIds(items) {
  const list = Array.isArray(items) ? items : [];
  const hasExplicitSelection = list.some((item) => typeof item?.selected === 'boolean');
  const allIds = list
    .filter((item) => item?.id !== null && item?.id !== undefined)
    .map((item) => String(item.id));

  if (!allIds.length) {
    return [];
  }

  if (!hasExplicitSelection) {
    return allIds;
  }

  const selectedIds = list
    .filter((item) => item?.selected === true && item?.id !== null && item?.id !== undefined)
    .map((item) => String(item.id));

  return selectedIds.length > 0 ? selectedIds : allIds;
}

function derivePaletteColor(item, mappedColor, fallbackIndex) {
  if (item?.color) return item.color;
  if (mappedColor) return mappedColor;
  return PALETTE[fallbackIndex % PALETTE.length] || '#3498db';
}

function deriveFeatureStateNames(source, baselineFeatures) {
  const selectedStates = Array.from(source?.selectedFeatureStateFilter || []).map((name) =>
    String(name)
  );
  if (selectedStates.length > 0) {
    return selectedStates;
  }

  const featureStates = new Set();
  for (const feature of baselineFeatures || []) {
    const stateName = feature?.state;
    if (!stateName) continue;
    featureStates.add(String(stateName));
  }
  return Array.from(featureStates);
}

export function createDataCommands(store, bus, dataService, legacyStateRef = null) {
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
            featureStateNames: state.selection.featureStateNames
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

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            // Baseline entry lives in items; preserve its overrides across server refreshes.
            items: [
              { ...(state.scenarios.items.find((s) => s.id === 'baseline') || { id: 'baseline', name: 'Baseline', overrides: {} }) },
              ...scenarioItems
                .filter((s) => s.id !== 'baseline')
                .map((scenario) => ({ ...scenario, isChanged: false })),
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

    async bootstrapFromLegacyState(legacyState = null) {
      const source = legacyState || legacyStateRef || null;
      if (!source) {
        return {
          ok: false,
          error: {
            code: 'missing_legacy_state',
            message: 'bootstrapFromLegacyState requires a legacy state object',
          },
        };
      }

      if (typeof source.initState === 'function') {
        await source.initState();
      }

      // Use working copies (source.projects/teams) which have colors applied by ColorService.
      // deriveItemsWithSelection overwrites the selected flag so stale selection is harmless.
      const baselineResult = await this.hydrateBaseline({
        preloaded: {
          projects: Array.isArray(source.projects) && source.projects.length > 0
            ? source.projects
            : Array.isArray(source.baselineProjects) ? source.baselineProjects : [],
          teams: Array.isArray(source.teams) && source.teams.length > 0
            ? source.teams
            : Array.isArray(source.baselineTeams) ? source.baselineTeams : [],
          features: Array.isArray(source.baselineFeatures) ? source.baselineFeatures : [],
          iterationSetsById: source.iterationSetsById || {},
        },
      });
      if (!baselineResult?.ok) return baselineResult;

      const scenariosResult = await this.hydrateScenarioData({
        preloadedItems: Array.isArray(source.scenarios) ? source.scenarios : [],
        activeId: source.activeScenarioId || 'baseline',
      });
      if (!scenariosResult?.ok) return scenariosResult;

      const sourceProjects = Array.isArray(source.projects) ? source.projects : [];
      const sourceTeams = Array.isArray(source.teams) ? source.teams : [];
      const sourceBaselineFeatures =
        Array.isArray(source.baselineFeatures) ? source.baselineFeatures : [];

      const projectIds = getExplicitOrDefaultSelectedIds(sourceProjects);
      const teamIds = getExplicitOrDefaultSelectedIds(sourceTeams);
      const featureStateNames = deriveFeatureStateNames(source, sourceBaselineFeatures);
      const taskTypeNames = (source.availableTaskTypes || []).filter(
        (typeName) => source?._viewService?.isTypeVisible?.(typeName) !== false
      );
      const hiddenTypes = (source.availableTaskTypes || []).filter(
        (typeName) => source?._viewService?.isTypeVisible?.(typeName) === false
      );
      const taskFilters =
        source?.taskFilterService?.getFilters?.() || {
          schedule: null,
          allocation: null,
          hierarchy: null,
          relations: null,
        };
      const viewService = source._viewService;
      const expansion = source.expansionState || {};

      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            projectIds,
            teamIds,
            featureStateNames,
            taskTypeNames,
            taskFilters,
            sidebarDisabled: source.getSidebarDisabledElements?.() || {},
          },
          view: {
            ...state.view,
            expansion: {
              ...state.view.expansion,
              parentChild: Boolean(expansion.expandParentChild),
              relations: Boolean(expansion.expandRelations),
              teamAllocated: Boolean(expansion.expandTeamAllocated),
            },
            options: {
              ...state.view.options,
              timelineScale: viewService?.timelineScale || 'months',
              displayMode: viewService?.displayMode || 'normal',
              condensedCards: (viewService?.displayMode || 'normal') !== 'normal',
              packedMode: viewService?.displayMode === 'packed',
              showDependencies: Boolean(viewService?.showDependencies),
              featureSortMode: viewService?.featureSortMode || 'rank',
              capacityViewMode: viewService?.capacityViewMode || 'team',
              hiddenTypes,
              showUnplannedWork: Boolean(viewService?.showUnplannedWork),
              showOnlyProjectHierarchy: Boolean(viewService?.showOnlyProjectHierarchy),
              showUnassignedCards: Boolean(viewService?.showUnassignedCards),
              highlightFeatureRelationMode: Boolean(viewService?.highlightFeatureRelationMode),
            },
          },
        }),
        false,
        'data.bootstrapFromLegacyState'
      );

      // Populate store.capacity so capacitySelectors reads store from the start.
      this.recomputeCapacity();

      return {
        ok: true,
      };
    },
  };
}
