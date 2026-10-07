import { describe, expect, it } from 'vitest';
import { createScopeSelectors } from '../../../www/js/application/selectors/scopeSelectors.js';
import { createFeatureSelectors } from '../../../www/js/application/selectors/featureSelectors.js';
import { createSelectionSelectors } from '../../../www/js/application/selectors/selectionSelectors.js';

function createStore(state) {
  return { getState: () => state };
}

function baseState(overrides = {}) {
  const state = {
    baseline: {
      projects: [{ id: 'selected' }, { id: 'parent' }, { id: 'child' }, { id: 'other' }],
      teams: [{ id: 'team-a' }, { id: 'team-b' }],
      features: [
        { id: 'own', project: 'selected', parentId: 'parent-task', type: 'Feature', state: 'Active', relations: [], capacity: [{ team: 'team-a' }] },
        { id: 'parent-task', project: 'parent', parentId: null, type: 'Feature', state: 'Active', relations: [], capacity: [{ team: 'team-a' }] },
        { id: 'child-task', project: 'child', parentId: 'own', type: 'Feature', state: 'Active', relations: [], capacity: [{ team: 'team-b' }] },
        { id: 'dependency-task', project: 'other', parentId: null, type: 'Feature', state: 'Active', relations: [], capacity: [{ team: 'team-a' }] },
        { id: 'unrelated', project: 'other', parentId: null, type: 'Bug', state: 'Active', relations: [], capacity: [{ team: 'team-b' }] },
        { id: 'hidden-type', project: 'selected', parentId: null, type: 'Bug', state: 'Active', relations: [], capacity: [] },
      ],
    },
    scenarios: {
      activeId: 'baseline',
      items: [{ id: 'baseline', overrides: {} }],
    },
    selection: {
      projectIds: ['selected'],
      teamIds: ['team-a', 'team-b'],
      featureStateNames: ['Active'],
      taskFilters: { schedule: {}, allocation: {}, hierarchy: {}, relations: {} },
      taskTypeNames: ['Feature'],
    },
    view: {
      options: { hiddenTypes: [], showUnplannedWork: true },
      context: { parent: false, child: false, dependency: false, otherAllocations: false },
    },
  };
  const {
    selection = {},
    view = {},
    ...rootOverrides
  } = overrides;
  const {
    options = {},
    context = {},
    ...viewOverrides
  } = view;
  return {
    ...state,
    ...rootOverrides,
    selection: { ...state.selection, ...selection },
    view: {
      ...state.view,
      ...viewOverrides,
      options: { ...state.view.options, ...options },
      context: { ...state.view.context, ...context },
    },
  };
}

describe('application/selectors/scopeSelectors', () => {
  it('indexes relationships once for scope counts instead of rescanning every selected task', () => {
    const state = baseState();
    const taskCount = 5800;
    let relationReads = 0;
    state.baseline.features = Array.from({ length: taskCount }, (_, index) => ({
      id: String(index), project: index < 200 ? 'selected' : 'other',
      parentId: index >= 200 ? '0' : null, type: 'Feature', state: 'Active',
      capacity: [{ team: 'team-a', capacity: 10 }],
      relations: [{
        id: String((index + 1) % taskCount),
        get type() { relationReads += 1; return 'Related'; },
      }],
    }));
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getContextOptionCounts()).toEqual({
      parent: 0, child: 5600, dependency: 2, otherAllocations: 0,
    });
    expect(relationReads).toBeLessThan(taskCount * 4);
    const initialReads = relationReads;
    selectors.getContextOptionCounts();
    expect(relationReads).toBe(initialReads);
  });

  it('reuses counts for team drill-down but invalidates them for plans, filters and scenario edits', () => {
    const state = baseState();
    const selectors = createScopeSelectors(createStore(state));
    const originalCounts = selectors.getContextOptionCounts();
    expect(originalCounts).toEqual({ parent: 1, child: 1, dependency: 0, otherAllocations: 1 });
    state.selection.teamIds = ['team-b'];
    expect(selectors.getContextOptionCounts()).toBe(originalCounts);

    state.selection.taskTypeNames = ['Bug'];
    expect(selectors.getContextOptionCounts()).toEqual({
      parent: 0, child: 0, dependency: 0, otherAllocations: 0,
    });
    state.selection.taskTypeNames = ['Feature'];
    state.selection.projectIds = ['child'];
    expect(selectors.getContextOptionCounts().parent).toBe(2);

    state.selection.projectIds = ['selected'];
    state.scenarios.items = [{ id: 'baseline', overrides: { 'child-task': { parentId: null } } }];
    expect(selectors.getContextOptionCounts().child).toBe(0);
    state.baseline.features = [...state.baseline.features, {
      id: 'new-child', project: 'other', parentId: 'own', type: 'Feature', state: 'Active',
      capacity: [{ team: 'team-a', capacity: 10 }], relations: [],
    }];
    expect(selectors.getContextOptionCounts().child).toBe(1);
    state.view.context.child = true;
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toContain('new-child');
    expect(selectors.getContextOptionCounts().child).toBe(1);
  });

  it('indexes only eligible hierarchy edges and terminates on cyclic parent references', () => {
    const state = baseState();
    state.baseline.features[0].parentId = 'child-task';
    state.view.context.parent = true;
    state.view.context.child = true;
    const selectors = createScopeSelectors(createStore(state));
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual([
      'own', 'child-task', 'hidden-type',
    ]);

    state.baseline.features = state.baseline.features.map((feature) =>
      feature.id === 'own' ? { ...feature, excludedChildIds: ['child-task'] } : feature
    );
    state.view.context.parent = false;
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual(['own', 'hidden-type']);
    state.baseline.features = state.baseline.features.map((feature) =>
      feature.id === 'own' ? { ...feature, parentId: 'parent-task', traversalBoundary: true } : feature
    );
    state.view.context.parent = true;
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual(['own', 'hidden-type']);
  });

  it('counts eligible card additions without counting hidden context descendants', () => {
    const state = baseState();
    state.baseline.features = [
      { id: 'root', project: 'selected', type: 'Epic', parentId: 'ancestor',
        state: 'Active', relations: [{ id: 'dependency', type: 'Successor' }], capacity: [{ team: 'team-a' }],
        sourcePlanIds: ['selected'], presentationPlanIds: ['selected'] },
      { id: 'ancestor', project: 'parent', type: 'Feature', parentId: null,
        state: 'Active', relations: [], capacity: [],
        sourcePlanIds: ['parent'], presentationPlanIds: ['parent'] },
      { id: 'child', project: 'child', type: 'Feature', parentId: 'root',
        state: 'Active', relations: [], capacity: [{ team: 'team-a' }],
        sourcePlanIds: ['selected', 'child'], presentationPlanIds: ['selected', 'child'] },
      { id: 'grandchild', project: 'child', type: 'Task', parentId: 'child',
        state: 'Active', relations: [], capacity: [{ team: 'team-a' }],
        sourcePlanIds: ['selected', 'child'], presentationPlanIds: [] },
      { id: 'unallocated-child', project: 'child', type: 'Feature', parentId: 'root',
        state: 'Active', relations: [], capacity: [],
        sourcePlanIds: ['selected', 'child'], presentationPlanIds: ['selected'] },
      { id: 'dependency', project: 'other', type: 'Feature', parentId: null,
        state: 'Active', relations: [], capacity: [{ team: 'team-a' }],
        sourcePlanIds: ['other'], presentationPlanIds: ['other'] },
      { id: 'other-work', project: 'other', type: 'Feature', parentId: null,
        state: 'Active', relations: [], capacity: [{ team: 'team-a' }],
        sourcePlanIds: ['other'], presentationPlanIds: ['other'] },
    ];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual(['root']);
    expect(selectors.getContextOptionCounts()).toEqual({
      parent: 1, child: 1, dependency: 1, otherAllocations: 1,
    });
    state.view.context.parent = true;
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['ancestor']);
    expect(selectors.getContextOptionCounts().parent).toBe(1);
    state.view.context.parent = false;
    state.view.context.child = true;
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['child']);
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual([
      'root', 'child', 'grandchild', 'unallocated-child',
    ]);
    state.selection.taskTypeNames = ['Epic'];
    expect(selectors.getContextOptionCounts().child).toBe(0);
    state.selection.taskTypeNames = ['Feature'];
    state.selection.featureStateNames = [];
    expect(selectors.getContextOptionCounts().child).toBe(0);
  });

  it('presents ancestor-only cards through parent context without importing their plan', () => {
    const state = baseState({ selection: { teamIds: [], taskTypeNames: [] } });
    state.baseline.features = [
      { id: 'seed', project: 'selected', type: 'Feature', state: 'Active',
        sourcePlanIds: ['selected'], presentationPlanIds: ['selected'],
        parentId: 'ancestor', relations: [], capacity: [] },
      { id: 'ancestor', project: 'internal-owner', type: 'Epic', state: 'Active',
        sourcePlanIds: [], presentationPlanIds: [], ancestorOnly: true, childrenComplete: false,
        parentId: null, relations: [], capacity: [] },
    ];
    const selectors = createScopeSelectors(createStore(state));
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['seed']);
    state.view.context.parent = true;
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['seed', 'ancestor']);
    expect(selectors.getContextOptionCounts().parent).toBe(1);
    state.selection.teamIds = ['team-a'];
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['seed', 'ancestor']);
    state.selection.projectIds = ['internal-owner'];
    expect(selectors.getContextFeatures()).toEqual([]);
  });

  it('keeps imported context inspectable but presents only configured types', () => {
    const state = baseState({ selection: { teamIds: ['team-a'] } });
    state.baseline.features = [
      { id: 'seed', project: 'selected', type: 'Epic', state: 'Active',
        sourcePlanIds: ['selected'], presentationPlanIds: ['selected'],
        parentId: null, relations: [], capacity: [] },
      { id: 'linked', project: 'internal-owner', type: 'Requirement', state: 'Active',
        sourcePlanIds: ['selected', 'other'], presentationPlanIds: [],
        parentId: 'seed', relations: [], capacity: [{ team: 'team-a', capacity: 50 }] },
      { id: 'shared', project: 'internal-owner', type: 'Feature', state: 'Active',
        sourcePlanIds: ['selected', 'other'], presentationPlanIds: ['selected', 'other'],
        parentId: 'linked', relations: [], capacity: [{ team: 'team-a', capacity: 10 }] },
    ];
    state.selection.taskTypeNames = [];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getResolvedFeatures().map((feature) => feature.id)).toEqual([
      'seed', 'linked', 'shared',
    ]);
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual(['seed']);
    state.view.context.child = true;
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual([
      'seed', 'linked', 'shared',
    ]);
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['seed', 'shared']);
    const featureSelectors = createFeatureSelectors(createStore(state));
    expect(featureSelectors.getAvailableTaskTypes()).toEqual(['Epic', 'Feature']);
    expect(featureSelectors.getCountsForProject('selected')).toEqual(
      new Map([['epic', 1], ['feature', 1]])
    );
    expect(createSelectionSelectors(createStore(state)).getProjects()
      .some((plan) => plan.id === 'internal-owner')).toBe(false);

    state.selection.projectIds = ['other'];
    expect(selectors.getContextFeatures()).toEqual([]);
    expect(selectors.getVisibleFeatures()).toEqual([]);

    state.selection.projectIds = ['child'];
    state.view.context.child = true;
    state.view.context.parent = true;
    state.view.context.otherAllocations = true;
    expect(selectors.getContextFeatures()).toEqual([]);
    expect(selectors.getResolvedFeatures()).toHaveLength(3);
    state.baseline.features = [...state.baseline.features, {
      id: 'unrelated-seed', project: 'child', type: 'Feature', state: 'Active',
      sourcePlanIds: ['child'], presentationPlanIds: ['child'],
      parentId: null, relations: [], capacity: [{ team: 'team-a', capacity: 10 }],
    }];
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual([
      'linked', 'shared', 'unrelated-seed',
    ]);
    state.view.context.otherAllocations = false;
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual(['unrelated-seed']);
  });

  it('applies plan, context, team, and task filters in that order', () => {
    const state = baseState({
      view: { context: { parent: true, child: true, dependency: true, otherAllocations: true } },
      selection: {
        projectIds: ['selected'],
        teamIds: ['team-a'],
        taskFilters: { schedule: {}, allocation: {}, hierarchy: {}, relations: {} },
        taskTypeNames: ['Feature'],
      },
    });
    state.baseline.features[3].relations = [{ id: 'own', relationType: 'DependsOn' }];
    state.baseline.features[4].type = 'Bug';

    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'parent-task',
      'dependency-task',
    ]);
    expect(selectors.getFunnel()).toEqual({
      baseTasks: 2,
      relatedTasks: 3,
      tasksInScope: 5,
      teamsInScope: 2,
      tasksVisible: 3,
      teamsInView: 1,
    });
  });

  it('returns empty visible scope without a selected plan', () => {
    const state = baseState({
      selection: {
        projectIds: [],
        teamIds: ['team-a', 'team-b'],
        taskFilters: { schedule: {}, allocation: {}, hierarchy: {}, relations: {} },
        taskTypeNames: [],
      },
    });
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getResolvedFeatures()).toHaveLength(6);
    expect(selectors.getVisibleFeatures()).toEqual([]);
    expect(selectors.getFunnel()).toEqual({
      baseTasks: 0,
      relatedTasks: 0,
      tasksInScope: 0,
      teamsInScope: 0,
      tasksVisible: 0,
      teamsInView: 0,
    });
  });

  it('preserves an empty Team Drill-down as an empty selection', () => {
    const state = baseState({ selection: { teamIds: [] } });
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getTeamDrilldownIds()).toEqual([]);
  });

  it('matches lowercase saved task type selections to canonical task types', () => {
    const state = baseState();
    state.selection.taskTypeNames = ['feature'];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
    ]);
  });

  it('does not include related work until its Context flag is enabled', () => {
    const state = baseState();
    state.selection.teamIds = ['team-a', 'team-b'];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'hidden-type',
    ]);
    state.view.context.child = true;
    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'child-task',
      'hidden-type',
    ]);
  });

  it('hides child-context tasks when Team Drill-down has no selected teams', () => {
    const state = baseState({
      view: { context: { parent: false, child: true, dependency: false, otherAllocations: false } },
    });
    state.selection.teamIds = [];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'child-task',
      'hidden-type',
    ]);
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
    ]);
  });

  it('keeps matching child-context tasks and their ancestors visible', () => {
    const state = baseState({
      view: { context: { parent: false, child: true, dependency: false, otherAllocations: false } },
    });
    state.baseline.features[2].capacity = [{ team: 'team-a' }, { team: 'team-b' }];
    state.selection.teamIds = ['team-b'];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'child-task',
    ]);

    state.selection.teamIds = [];

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
    ]);
  });

  it('keeps added-scope counts independent of Team Drill-down while filtering the board', () => {
    const state = baseState({
      view: { context: { parent: false, child: false, dependency: false, otherAllocations: false } },
    });
    state.baseline.features[0].relations = [{ id: 'dependency-task', type: 'Successor' }];
    state.baseline.features[4].capacity = [{ team: 'team-a' }];
    state.baseline.features[4].type = 'Feature';
    state.selection.teamIds = [];
    const selectors = createScopeSelectors(createStore(state));
    const clearFocusCounts = selectors.getContextOptionCounts();

    state.selection.teamIds = ['team-a'];
    const focusedCounts = selectors.getContextOptionCounts();

    expect(clearFocusCounts).toEqual({ parent: 1, child: 1, dependency: 1, otherAllocations: 1 });
    expect(focusedCounts).toEqual(clearFocusCounts);
    state.selection.teamIds = ['team-b'];
    expect(selectors.getVisibleFeatures()).toEqual([]);
    expect(selectors.getContextOptionCounts()).toEqual(clearFocusCounts);
    state.view.context.child = true;
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['own', 'child-task']);
    expect(selectors.getContextOptionCounts().child).toBe(1);
    state.selection.teamIds = [];
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['own']);
    expect(selectors.getContextOptionCounts().child).toBe(1);
    state.view.options = { ...state.view.options, taskViewMode: 'team' };
    expect(selectors.getVisibleFeatures()).toEqual([]);
    expect(selectors.getContextOptionCounts().child).toBe(1);
  });

  it('does not count Parent or Child relations as dependency scope', () => {
    const state = baseState();
    state.baseline.features[0].relations = [{ id: 'dependency-task', type: 'Child' }];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getContextOptionCounts().dependency).to.equal(0);
  });

  it('includes parent tasks when Parent context is enabled', () => {
    const state = baseState({
      view: { context: { parent: true, child: false, dependency: false, otherAllocations: false } },
    });
    state.selection.teamIds = ['team-a'];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'parent-task',
      'hidden-type',
    ]);
  });

  it('keeps an unallocated parent visible for an unallocated task in a selected plan', () => {
    const state = baseState({
      view: { context: { parent: true, child: false, dependency: false, otherAllocations: false } },
      selection: { teamIds: ['team-a'] },
    });
    state.baseline.features[0].capacity = [];
    state.baseline.features[1].capacity = [];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'parent-task',
    ]);
  });

  it('filters allocated selected-plan and contextual tasks by Team Drill-down', () => {
    const state = baseState();
    state.view.context.parent = true;
    state.baseline.features.push({
      id: 'own-team-b',
      project: 'selected',
      parentId: null,
      type: 'Feature',
      state: 'Active',
      relations: [],
      capacity: [{ team: 'team-b' }],
    });
    state.baseline.features.push({
      id: 'own-unallocated',
      project: 'selected',
      parentId: null,
      type: 'Feature',
      state: 'Active',
      relations: [],
      capacity: [],
    });
    state.selection.teamIds = ['team-a'];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'parent-task',
      'own-unallocated',
    ]);
  });

  it('focuses on selected team work and its parents without unrelated plan tasks', () => {
    const state = baseState({
      selection: { teamIds: ['team-a'], taskTypeNames: [] },
      view: { options: { taskViewMode: 'plan' } },
    });
    state.baseline.features.push(
      { id: 'relevant-parent', project: 'selected', parentId: null, type: 'Feature', state: 'Active', relations: [], capacity: [] },
      { id: 'team-leaf', project: 'selected', parentId: 'relevant-parent', type: 'Feature', state: 'Active', relations: [], capacity: [{ team: 'team-a' }] },
      { id: 'unrelated-parent', project: 'selected', parentId: null, type: 'Feature', state: 'Active', relations: [], capacity: [] },
      { id: 'unrelated-leaf', project: 'selected', parentId: 'unrelated-parent', type: 'Feature', state: 'Active', relations: [], capacity: [] },
      { id: 'team-b-leaf', project: 'selected', parentId: 'relevant-parent', type: 'Feature', state: 'Active', relations: [], capacity: [{ team: 'team-b' }] },
    );
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own', 'hidden-type', 'relevant-parent', 'team-leaf', 'unrelated-parent', 'unrelated-leaf',
    ]);

    state.view.options = { ...state.view.options, taskViewMode: 'team' };
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own', 'relevant-parent', 'team-leaf',
    ]);

    state.selection.teamIds = ['team-a', 'team-b'];
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own', 'relevant-parent', 'team-leaf', 'team-b-leaf',
    ]);

    state.selection.teamIds = [];
    expect(selectors.getVisibleFeatures()).toEqual([]);
  });

  it('keeps ancestor context for matching team work while hiding unrelated allocations', () => {
    const state = baseState({
      view: { context: { parent: true, child: false, dependency: false, otherAllocations: false } },
    });
    state.baseline.features[1].capacity = [{ team: 'team-b' }];
    state.baseline.features.push({
      id: 'own-team-b',
      project: 'selected',
      parentId: null,
      type: 'Feature',
      state: 'Active',
      relations: [],
      capacity: [{ team: 'team-b' }],
    });
    state.baseline.features.push({
      id: 'own-unallocated',
      project: 'selected',
      parentId: null,
      type: 'Feature',
      state: 'Active',
      relations: [],
      capacity: [],
    });
    state.selection.teamIds = ['team-a'];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'parent-task',
      'own-unallocated',
    ]);
  });

  it('keeps Other allocations in scope but hides them when Team Drill-down is clear', () => {
    const state = baseState({
      view: { context: { parent: false, child: false, dependency: false, otherAllocations: true } },
    });
    state.selection.teamIds = [];
    state.selection.taskTypeNames = [];
    state.baseline.features.push({
      id: 'other-team-a',
      project: 'other',
      parentId: null,
      type: 'Feature',
      relations: [],
      capacity: [{ team: 'team-a' }],
    });
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getContextFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'dependency-task',
      'hidden-type',
      'other-team-a',
    ]);
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'hidden-type',
    ]);
  });

  it('does not mutate resolved features when display filters narrow visibility', () => {
    const state = baseState();
    state.selection.taskTypeNames = [];
    const selectors = createScopeSelectors(createStore(state));
    const resolved = selectors.getResolvedFeatures();

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own',
      'hidden-type',
    ]);
    state.selection.teamIds = ['team-b'];
    state.view.context.otherAllocations = true;
    expect(selectors.getResolvedFeatures()).toEqual(resolved);
  });

  it('reuses derived scopes while store inputs are unchanged', () => {
    const state = baseState();
    const selectors = createScopeSelectors(createStore(state));
    const firstResolved = selectors.getResolvedFeatures();
    const secondResolved = selectors.getResolvedFeatures();
    const firstVisible = selectors.getVisibleFeatures();
    const secondVisible = selectors.getVisibleFeatures();

    expect(secondResolved).to.equal(firstResolved);
    expect(secondVisible).to.equal(firstVisible);
  });
});