import { expect } from '@esm-bundle/chai';

import { createPlannerApplication } from '../../www/js/application/createPlannerApplication.js';
import { createPlannerSelectors } from '../../www/js/application/selectors/createPlannerSelectors.js';
import { createPlannerCommands } from '../../www/js/application/commands/createPlannerCommands.js';

describe('planner runtime extraction', () => {
  function createRuntime() {
    const runtimeScenarios = [{ id: 'scenario-a', name: 'Scenario A', isChanged: true }];

    const runtime = {
      projects: [
        {
          id: 'project-a',
          selected: true,
          task_type_hierarchy: [{ types: ['Epic'] }, { types: ['Task'] }],
        },
      ],
      teams: [{ id: 'team-a', selected: true }],
      baselineFeatures: [
        {
          id: 'feature-root',
          project: 'project-a',
          type: 'Epic',
          relations: [{ id: 'feature-child' }],
          capacity: [{ team: 'team-a', capacity: 1 }],
        },
        {
          id: 'feature-child',
          project: 'project-a',
          type: 'Task',
          parentId: 'feature-root',
          relations: [],
          capacity: [{ team: 'team-a', capacity: 0.5 }],
        },
      ],
      iterations: {
        'project-a': {
          iterations: [{ id: 'it-1', name: 'Sprint 1' }],
        },
      },
      selectedFeatureStateFilter: new Set(['In Progress']),
      taskFilterService: {
        getFilters: () => ({
          taskType: {
            Epic: true,
            Task: false,
          },
        }),
      },
      getSidebarDisabledElements: () => ({ taskTypes: ['Task'] }),
      expansionState: {
        expandParentChild: true,
        expandRelations: false,
        expandTeamAllocated: true,
      },
      scenarios: {
        list: () => runtimeScenarios,
      },
      activeScenarioId: 'scenario-a',
      views: {
        getActiveId: () => 'view-a',
        list: () => [{ id: 'view-a', name: 'View A' }],
      },
      displayMode: 'normal',
      condensedCards: false,
      showDependencies: true,
      showUnplannedWork: false,
      showUnallocatedCards: false,
      showOnlyProjectHierarchy: false,
      capacityViewMode: 'project',
      featureSortMode: 'rank',
      highlightFeatureRelationMode: 'none',
      capacityDates: ['2026-01-01'],
      teamDailyCapacity: [{ date: '2026-01-01', value: 8 }],
      teamDailyCapacityMap: [],
      projectDailyCapacityRaw: [],
      projectDailyCapacity: [],
      projectDailyCapacityMap: [],
      totalOrgDailyCapacity: [8],
      totalOrgDailyPerTeamAvg: [8],
    };

    runtime.setProjectSelected = (id, selected) => {
      const project = runtime.projects.find((item) => item.id === id);
      if (project) project.selected = !!selected;
    };

    runtime.setExpansionState = ({
      expandParentChild,
      expandRelations,
      expandTeamAllocated,
    }) => {
      if (expandParentChild !== undefined) {
        runtime.expansionState.expandParentChild = !!expandParentChild;
      }
      if (expandRelations !== undefined) {
        runtime.expansionState.expandRelations = !!expandRelations;
      }
      if (expandTeamAllocated !== undefined) {
        runtime.expansionState.expandTeamAllocated = !!expandTeamAllocated;
      }
    };

    runtime.updateFeatureField = (id, field, value) => {
      const feature = runtime.baselineFeatures.find((item) => item.id === id);
      if (feature) feature[field] = value;
    };

    runtime.updateFeatureRelations = (id, relations) => {
      const feature = runtime.baselineFeatures.find((item) => item.id === id);
      if (!feature) return false;
      feature.relations = relations;
      return true;
    };

    runtime.revertFeature = (id) => {
      const feature = runtime.baselineFeatures.find((item) => item.id === id);
      if (feature) {
        feature.start = undefined;
        feature.end = undefined;
      }
    };

    runtime.activateScenario = (id) => {
      runtime.activeScenarioId = id;
    };

    runtime.setScenarioOverride = (featureId, start, end) => {
      const feature = runtime.baselineFeatures.find((item) => item.id === featureId);
      if (!feature) return;
      feature.start = start;
      feature.end = end;
    };

    runtime.cloneScenario = (sourceId, name) => {
      const cloned = { id: `scenario-${runtimeScenarios.length + 1}`, name, isChanged: true };
      runtimeScenarios.push(cloned);
      return cloned;
    };

    runtime.renameScenario = (id, newName) => {
      const scenario = runtimeScenarios.find((item) => item.id === id);
      if (scenario) scenario.name = newName;
    };

    runtime.deleteScenario = (id) => {
      const index = runtimeScenarios.findIndex((item) => item.id === id);
      if (index !== -1) runtimeScenarios.splice(index, 1);
      if (runtime.activeScenarioId === id) {
        runtime.activeScenarioId = runtimeScenarios[0]?.id || null;
      }
    };

    runtime.saveScenario = async (id) => {
      const scenario = runtimeScenarios.find((item) => item.id === id);
      if (scenario) scenario.isChanged = false;
      return { ok: true };
    };

    return runtime;
  }

  it('hydrates canonical AppStore from the legacy runtime on initialize', async () => {
    const runtime = createRuntime();

    const application = createPlannerApplication({
      createServices: () => ({
        runtime,
      }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    const state = application.getState();
    expect(state.baseline.projects).to.have.length(1);
    expect(state.baseline.teams).to.have.length(1);
    expect(state.baseline.features).to.have.length(2);
    expect(state.scenarios.activeId).to.equal('scenario-a');
    expect(state.view.activeId).to.equal('view-a');
    expect(state.selection.projectIds).to.deep.equal(['project-a']);
    expect(state.selection.teamIds).to.deep.equal(['team-a']);

    expect(application.selectors.availableTaskTypes()).to.deep.equal(['Epic', 'Task']);
    expect(application.selectors.orderedTaskTypes()).to.deep.equal(['Epic', 'Task']);
    expect(Array.from(application.selectors.expandedFeatureIds())).to.include('feature-child');
    expect(application.selectors.effectiveSelectedProjectIds()).to.deep.equal(['project-a']);
    expect(application.selectors.activeScenario()?.id).to.equal('scenario-a');
    expect(application.selectors.activeWritableScenario()?.id).to.equal('scenario-a');
    expect(application.selectors.iterationsForProject('project-a')).to.deep.equal([
      { id: 'it-1', name: 'Sprint 1' },
    ]);
    expect(application.selectors.capacityEventPayload()).to.deep.equal({
      dates: ['2026-01-01'],
      teamDailyCapacity: [{ date: '2026-01-01', value: 8 }],
      teamDailyCapacityMap: [],
      projectDailyCapacityRaw: [],
      projectDailyCapacity: [],
      projectDailyCapacityMap: [],
      totalOrgDailyCapacity: [8],
      totalOrgDailyPerTeamAvg: [8],
    });
    expect(
      application.selectors.featureDirtyMetadata(
        {
          start: '2026-01-01',
          end: '2026-01-05',
          capacity: [{ team: 'team-a', capacity: 1 }],
        },
        {
          start: '2026-01-03',
          end: '2026-01-05',
          capacity: [{ team: 'team-a', capacity: 1 }],
        }
      )
    ).to.deep.equal({
      changedFields: ['start'],
      dirty: true,
    });
  });

  it('can resync from legacy runtime through command dispatch', async () => {
    const runtime = createRuntime();
    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    runtime.projects = [{ id: 'project-b', selected: true }];
    runtime.teams = [{ id: 'team-b', selected: true }];
    runtime.baselineFeatures = [{ id: 'feature-b', project: 'project-b', type: 'Task' }];

    application.commands.syncFromLegacyState();

    const state = application.getState();
    expect(state.baseline.projects[0].id).to.equal('project-b');
    expect(state.selection.projectIds).to.deep.equal(['project-b']);
    expect(state.selection.teamIds).to.deep.equal(['team-b']);
    expect(state.baseline.features.map((feature) => feature.id)).to.deep.equal(['feature-b']);
  });

  it('routes runtime mutations through command wrappers and syncs canonical state', async () => {
    const runtime = createRuntime();
    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.setProjectSelected('project-a', false);
    application.commands.setExpansionState({ expandTeamAllocated: false });

    const state = application.getState();
    expect(state.selection.projectIds).to.deep.equal([]);
    expect(state.view.expansion.teamAllocated).to.equal(false);
  });

  it('syncs feature and scenario changes via command wrappers', async () => {
    const runtime = createRuntime();
    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    const relationsUpdated = application.commands.updateFeatureRelations('feature-root', []);
    application.commands.updateFeatureField('feature-child', 'type', 'Story');
    application.commands.setScenarioOverride('feature-child', '2026-02-01', '2026-02-03');
    application.commands.activateScenario('baseline');

    const state = application.getState();
    expect(relationsUpdated).to.equal(true);
    expect(state.baseline.features.find((feature) => feature.id === 'feature-root')?.relations)
      .to.deep.equal([]);
    expect(state.baseline.features.find((feature) => feature.id === 'feature-child')?.type)
      .to.equal('Story');
    expect(state.baseline.features.find((feature) => feature.id === 'feature-child')?.start)
      .to.equal('2026-02-01');
    expect(state.scenarios.activeId).to.equal('baseline');
  });

  it('syncs scenario lifecycle command wrappers and preserves return values', async () => {
    const runtime = createRuntime();
    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    const cloned = application.commands.cloneScenario('scenario-a', 'Scenario B');
    application.commands.renameScenario(cloned.id, 'Scenario B Renamed');
    await application.commands.saveScenario(cloned.id);
    application.commands.deleteScenario('scenario-a');

    const state = application.getState();
    const clonedStateScenario = state.scenarios.items.find((item) => item.id === cloned.id);
    expect(cloned?.id).to.equal('scenario-2');
    expect(clonedStateScenario?.name).to.equal('Scenario B Renamed');
    expect(clonedStateScenario?.isChanged).to.equal(false);
    expect(state.scenarios.items.some((item) => item.id === 'scenario-a')).to.equal(false);
  });

  it('keeps command-first selection and expansion commits when runtime mutators no-op', async () => {
    const runtime = createRuntime();
    runtime.setProjectSelected = () => {};
    runtime.setExpansionState = () => {};

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.setProjectSelected('project-a', false);
    application.commands.setExpansionState({ expandTeamAllocated: false });

    const state = application.getState();
    expect(state.selection.projectIds).to.deep.equal([]);
    expect(state.view.expansion.teamAllocated).to.equal(false);
  });

  it('lets commands own feature-date capacity side-effect sequencing', async () => {
    const runtime = createRuntime();
    let capacitySideEffects = 0;

    runtime._shouldRunFeatureDateCapacitySideEffects = (updates) =>
      Array.isArray(updates) && updates.length > 0;

    runtime._applyFeatureDateCapacitySideEffectsLegacy = () => {
      capacitySideEffects += 1;
    };

    runtime._updateFeatureDatesLegacy = (updates, options = {}) => {
      if (!Array.isArray(updates) || updates.length === 0) return 0;
      const update = updates[0];
      const feature = runtime.baselineFeatures.find((item) => item.id === update.id);
      if (!feature) return 0;
      feature.start = update.start;
      feature.end = update.end;
      if (options.emitCapacitySideEffects !== false) {
        capacitySideEffects += 1;
      }
      return 1;
    };

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.updateFeatureDates([
      { id: 'feature-child', start: '2026-04-01', end: '2026-04-03' },
    ]);

    const state = application.getState();
    expect(state.baseline.features.find((feature) => feature.id === 'feature-child')?.start)
      .to.equal('2026-04-01');
    expect(capacitySideEffects).to.equal(1);
  });

  it('lets commands own feature-field and revert side-effect sequencing', async () => {
    const runtime = createRuntime();
    let capacitySideEffects = 0;
    let scenarioSideEffects = 0;

    runtime._shouldRunFeatureFieldCapacitySideEffects = (field, updated) =>
      !!updated && (field === 'start' || field === 'end' || field === 'capacity');

    runtime._applyFeatureFieldCapacitySideEffectsLegacy = () => {
      capacitySideEffects += 1;
    };

    runtime._emitFeatureFieldScenarioSideEffectsLegacy = () => {
      scenarioSideEffects += 1;
    };

    runtime._updateFeatureFieldLegacy = (id, field, value, options = {}) => {
      const feature = runtime.baselineFeatures.find((item) => item.id === id);
      if (!feature) return false;
      feature[field] = value;
      if (options.emitCapacitySideEffects !== false && (field === 'start' || field === 'end')) {
        capacitySideEffects += 1;
      }
      if (options.emitScenarioSideEffects !== false) {
        scenarioSideEffects += 1;
      }
      return true;
    };

    runtime._shouldRunFeatureRevertCapacitySideEffects = (reverted) => !!reverted;

    runtime._applyFeatureRevertCapacitySideEffectsLegacy = () => {
      capacitySideEffects += 1;
    };

    runtime._emitFeatureRevertScenarioSideEffectsLegacy = () => {
      scenarioSideEffects += 1;
    };

    runtime._revertFeatureLegacy = (id, options = {}) => {
      const feature = runtime.baselineFeatures.find((item) => item.id === id);
      if (!feature) return false;
      feature.start = undefined;
      feature.end = undefined;
      if (options.emitCapacitySideEffects !== false) {
        capacitySideEffects += 1;
      }
      if (options.emitScenarioSideEffects !== false) {
        scenarioSideEffects += 1;
      }
      return true;
    };

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.updateFeatureField('feature-child', 'start', '2026-05-01');
    application.commands.revertFeature('feature-child');

    const state = application.getState();
    expect(state.baseline.features.find((feature) => feature.id === 'feature-child')?.start)
      .to.equal(undefined);
    expect(capacitySideEffects).to.equal(2);
    expect(scenarioSideEffects).to.equal(2);
  });

  it('lets commands own autosave failure logging sequencing', async () => {
    const runtime = createRuntime();
    let legacySuppressed = false;
    const warnCalls = [];
    const originalWarn = console.warn;

    runtime.performAutosave = async (options = {}) => {
      legacySuppressed = options.logFailures === false;
      return [{ scenarioId: 'scenario-a', ok: false, errorMessage: 'save failed' }];
    };

    console.warn = (...args) => {
      warnCalls.push(args);
    };

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    try {
      await application.initialize();
      await application.commands.performAutosaveTick();
    } finally {
      console.warn = originalWarn;
    }

    expect(legacySuppressed).to.equal(true);
    expect(warnCalls.length).to.equal(1);
    expect(warnCalls[0][0]).to.equal('Autosave scenario failed');
    expect(warnCalls[0][1]).to.equal('scenario-a');
  });

  it('routes view restore selection/filter orchestration through command wrapper', async () => {
    const runtime = createRuntime();
    let filters = {
      taskType: {
        Epic: true,
        Task: false,
      },
    };

    runtime.taskFilterService = {
      getFilters: () => filters,
      restoreFilters: (next) => {
        filters = next;
      },
      resetFilters: () => {
        filters = { taskType: {} };
      },
    };

    runtime.applyViewSelectionRestore = (payload = {}) => {
      if (payload.projectSelections) {
        for (const project of runtime.projects) {
          project.selected = !!payload.projectSelections[project.id];
        }
      }
      if (payload.teamSelections) {
        for (const team of runtime.teams) {
          team.selected = !!payload.teamSelections[team.id];
        }
      }
      if (Array.isArray(payload.selectedStates)) {
        runtime.selectedFeatureStateFilter = new Set(payload.selectedStates);
      }
      if (payload.resetTaskFilters) {
        runtime.taskFilterService.resetFilters();
      } else if (payload.taskFilters) {
        runtime.taskFilterService.restoreFilters(payload.taskFilters);
      }
    };

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.applyViewSelectionRestore({
      projectSelections: { 'project-a': false },
      teamSelections: { 'team-a': false },
      selectedStates: ['Done'],
      taskFilters: {
        taskType: {
          Epic: false,
          Task: true,
        },
      },
    });

    const state = application.getState();
    expect(state.selection.projectIds).to.deep.equal([]);
    expect(state.selection.teamIds).to.deep.equal([]);
    expect(state.selection.featureStateNames).to.deep.equal(['Done']);
    expect(state.selection.taskTypeNames).to.deep.equal(['Task']);
  });

  it('routes view option and expansion orchestration through command wrapper', async () => {
    const runtime = createRuntime();
    let filters = {
      taskType: {
        Epic: true,
        Task: false,
      },
    };

    runtime.taskFilterService = {
      getFilters: () => filters,
      restoreFilters: (next) => {
        filters = next;
      },
      resetFilters: () => {
        filters = { taskType: {} };
      },
    };

    runtime.applyViewOptionsRestore = (payload = {}) => {
      if (payload.viewOptions) {
        runtime.displayMode = payload.viewOptions.displayMode || runtime.displayMode;
      }
      if (payload.graphType) {
        runtime.capacityViewMode = payload.graphType;
      }
      if (Array.isArray(payload.selectedTaskTypes)) {
        filters = {
          taskType: Object.fromEntries(payload.selectedTaskTypes.map((type) => [type, true])),
        };
      }
      if (payload.expansion) {
        runtime.expansionState = {
          ...runtime.expansionState,
          ...payload.expansion,
        };
      }
    };

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.applyViewOptionsRestore({
      viewOptions: { displayMode: 'compact' },
      graphType: 'team',
      selectedTaskTypes: ['Task'],
      expansion: {
        expandParentChild: false,
        expandRelations: true,
        expandTeamAllocated: false,
      },
      emitExpansionFilterChange: true,
    });

    const state = application.getState();
    expect(state.view.options.displayMode).to.equal('compact');
    expect(state.view.options.capacityViewMode).to.equal('team');
    expect(state.selection.taskTypeNames).to.deep.equal(['Task']);
    expect(state.view.expansion).to.deep.equal({
      parentChild: false,
      relations: true,
      teamAllocated: false,
    });
  });

  it('routes plugin-state restore orchestration through command wrapper', async () => {
    const runtime = createRuntime();
    let restoredPluginState = null;

    runtime.applyViewPluginStateRestore = async (payload = {}) => {
      restoredPluginState = payload.pluginState || {};
      return true;
    };

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    const restored = await application.commands.applyViewPluginStateRestore({
      pluginState: { 'plugin-cost': { startDate: '2026-06-01' } },
    });

    expect(restored).to.equal(true);
    expect(restoredPluginState).to.deep.equal({
      'plugin-cost': { startDate: '2026-06-01' },
    });
  });

  it('returns planned view restore UI effects through command wrapper', async () => {
    const runtime = createRuntime();
    runtime.planViewRestoreUiEffects = (payload = {}) => {
      const effects = [];
      if (payload.selectedTaskTypes) {
        effects.push({ type: 'setSelectedTaskTypes', selectedTaskTypes: payload.selectedTaskTypes });
      }
      if (payload.graphType) {
        effects.push({ type: 'setGraphType', graphType: payload.graphType });
      }
      effects.push({ type: 'requestSidebarUpdate' });
      return effects;
    };

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    const effects = application.commands.planViewRestoreUiEffects({
      selectedTaskTypes: ['Epic'],
      graphType: 'team',
    });

    expect(effects).to.deep.equal([
      { type: 'setSelectedTaskTypes', selectedTaskTypes: ['Epic'] },
      { type: 'setGraphType', graphType: 'team' },
      { type: 'requestSidebarUpdate' },
    ]);
  });

  it('keeps command-first scenario lifecycle commits when runtime lifecycle mutators no-op', async () => {
    const runtime = createRuntime();
    runtime.activateScenario = () => {};
    runtime.renameScenario = () => {};
    runtime.deleteScenario = () => {};
    runtime.saveScenario = async () => ({ ok: true });

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.activateScenario('baseline');
    application.commands.renameScenario('scenario-a', 'Scenario A Renamed');
    await application.commands.saveScenario('scenario-a');
    application.commands.deleteScenario('scenario-a');

    const state = application.getState();
    expect(state.scenarios.activeId).to.equal('baseline');
    expect(state.scenarios.items.some((item) => item.id === 'scenario-a')).to.equal(false);
  });

  it('keeps command-first feature commits when runtime feature mutators no-op', async () => {
    const runtime = createRuntime();
    runtime.updateFeatureField = () => {};
    runtime.updateFeatureRelations = () => true;
    runtime.revertFeature = () => {};
    runtime.setScenarioOverride = () => {};

    const application = createPlannerApplication({
      createServices: () => ({ runtime }),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.updateFeatureField('feature-child', 'type', 'Story');
    const relationsUpdated = application.commands.updateFeatureRelations('feature-root', []);
    application.commands.setScenarioOverride('feature-child', '2026-03-01', '2026-03-03');
    application.commands.revertFeature('feature-child');

    const state = application.getState();
    expect(relationsUpdated).to.equal(true);
    expect(state.baseline.features.find((feature) => feature.id === 'feature-child')?.type)
      .to.equal('Story');
    expect(state.baseline.features.find((feature) => feature.id === 'feature-root')?.relations)
      .to.deep.equal([]);
    expect(state.baseline.features.find((feature) => feature.id === 'feature-child')?.start)
      .to.equal(undefined);
  });
});
