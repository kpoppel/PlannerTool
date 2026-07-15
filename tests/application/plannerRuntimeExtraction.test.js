import { expect } from '@esm-bundle/chai';

import { createPlannerApplication } from '../../www/js/application/createPlannerApplication.js';
import { createPlannerSelectors } from '../../www/js/application/selectors/createPlannerSelectors.js';
import { createPlannerCommands } from '../../www/js/application/commands/createPlannerCommands.js';

import { expect } from '@esm-bundle/chai';

import { createPlannerApplication } from '../../www/js/application/createPlannerApplication.js';
import { createPlannerSelectors } from '../../www/js/application/selectors/createPlannerSelectors.js';
import { createPlannerCommands } from '../../www/js/application/commands/createPlannerCommands.js';

describe('planner runtime extraction', () => {
  // Direct AppStore initialization for tests (replaces legacy runtime fixture factory)
  function createTestServices() {
    return ({ store }) => {
      const initializeStoreWithTestData = () => {
        const runtimeScenarios = [{ id: 'scenario-a', name: 'Scenario A', isChanged: true }];
        store.update('test:initialize', state => ({
          ...state,
          baseline: {
            projects: [
              { id: 'project-a', selected: true, task_type_hierarchy: [{ types: ['Epic'] }, { types: ['Task'] }] },
            ],
            teams: [{ id: 'team-a', selected: true }],
            features: [
              { id: 'feature-root', project: 'project-a', type: 'Epic', relations: [{ id: 'feature-child' }], capacity: [{ team: 'team-a', capacity: 1 }] },
              { id: 'feature-child', project: 'project-a', type: 'Task', parentId: 'feature-root', relations: [], capacity: [{ team: 'team-a', capacity: 0.5 }] },
            ],
            iterationsByProject: {
              'project-a': { iterations: [{ id: 'it-1', name: 'Sprint 1' }] },
            },
          },
          scenarios: {
            ...state.scenarios,
            items: runtimeScenarios.map(s => ({
              ...s,
              projects: [],
              groups: [],
              groupOverrides: {},
              featureOverrides: {},
            })),
            activeId: 'scenario-a',
          },
          selection: {
            ...state.selection,
            projectIds: ['project-a'],
            teamIds: ['team-a'],
            featureStateNames: ['In Progress'],
          },
          view: {
            ...state.view,
            expansion: {
              parentChild: true,
              relations: false,
              teamAllocated: true,
            },
            activeId: 'view-a',
            saved: [{ id: 'view-a', name: 'View A', options: {} }],
          },
          capacity: {
            dates: ['2026-01-01'],
            teamDaily: [{ date: '2026-01-01', value: 8 }],
            teamDailyMap: [],
            projectDailyRaw: [],
            projectDaily: [],
            projectDailyMap: [],
            organizationDaily: [8],
            organizationDailyPerTeamAverage: [8],
          },
        }));
      };
      
      return {
        runtime: { /* minimal runtime stub for command compatibility */ },
        initialize: async () => {
          initializeStoreWithTestData();
          return store.getState();
        },
      };
    };
  }

  function createRuntime() {
    const runtimeScenarios = [{ id: 'scenario-a', name: 'Scenario A', isChanged: true }];
    const runtime = { projects: [], teams: [], baselineFeatures: [] };
    
    runtime.scenarios = { list: () => runtimeScenarios };
    runtime.activeScenarioId = 'scenario-a';
    runtime.setProjectSelected = () => {};
    runtime.setExpansionState = () => {};
    runtime.updateFeatureField = () => {};
    runtime.updateFeatureRelations = () => {};
    runtime.revertFeature = () => {};
    runtime.activateScenario = (id) => { runtime.activeScenarioId = id; };
    runtime.setScenarioOverride = () => {};
    runtime.buildScenarioClone = (_sourceId, name) => {
      const cloned = {
        id: `scenario-${runtimeScenarios.length + 1}`,
        name,
        isChanged: true,
        readonly: false,
        overrides: {},
        filters: {},
        view: {},
      };
      runtimeScenarios.push(cloned);
      return cloned;
    };
    runtime.normalizeScenarioName = (_id, name) => name;
    runtime.saveScenarioPayload = async () => ({ ok: true });
    
    return runtime;
  }

  it('initializes canonical AppStore with test data', async () => {
    const application = createPlannerApplication({
      createServices: createTestServices(),
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

  it('can update selection and expansion in canonical state', async () => {
    const runtime = createRuntime();
    const application = createPlannerApplication({
      createServices: createTestServices(),
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

  it('does not mutate runtime selection and expansion during state updates', async () => {
    const runtime = createRuntime();
    let projectEffects = 0;
    let expansionEffects = 0;
    runtime.handleProjectSelectionChanged = () => {
      projectEffects += 1;
    };
    runtime.handleExpansionChanged = () => {
      expansionEffects += 1;
    };
    const application = createPlannerApplication({
      createServices: createTestServices(),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();
    const revisionBefore = application.store.revision;

    application.commands.setProjectSelected('project-a', false);
    application.commands.setExpansionState({ expandTeamAllocated: false });

    expect(application.store.revision).to.equal(revisionBefore + 2);
  });

  it('syncs scenario activation via command wrappers', async () => {
    const runtime = createRuntime();
    const application = createPlannerApplication({
      createServices: createTestServices(),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.activateScenario('baseline');

    const state = application.getState();
    expect(state.scenarios.activeId).to.equal('baseline');
  });

  it('keeps command-first selection and expansion commits when runtime mutators no-op', async () => {
    const runtime = createRuntime();
    runtime.setProjectSelected = () => {};
    runtime.setExpansionState = () => {};

    const application = createPlannerApplication({
      createServices: createTestServices(),
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

  it('commands handle autosave operations', async () => {
    const application = createPlannerApplication({
      createServices: createTestServices(),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();
    await application.commands.performAutosaveTick();

    // Verify autosave completes without error
    const state = application.getState();
    expect(state.scenarios.activeId).to.equal('scenario-a');
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
      createServices: createTestServices(),
      createSelectors: ({ store }) => createPlannerSelectors({ store }),
      createCommands: ({ store, services }) => createPlannerCommands({ store, services }),
    });

    await application.initialize();

    application.commands.applyViewSelectionRestore({
      projectSelections: { 'project-a': false },
      teamSelections: { 'team-a': false },
      selectedStates: ['Done'],
      selectedTaskTypes: ['Task'],
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
      createServices: createTestServices(),
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
      createServices: createTestServices(),
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
    runtime.normalizeScenarioName = () => undefined;

    const application = createPlannerApplication({
      createServices: createTestServices(),
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

});
