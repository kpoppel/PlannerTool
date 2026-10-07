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
  it('shows the scoped tree in plan overview and bounded hierarchy relevance in team focus', () => {
    const state = baseState({
      selection: { taskTypeNames: [], teamIds: ['team-a'] },
      view: { context: { parent: true, child: true }, options: { taskViewMode: 'plan' } },
    });
    state.baseline.features = [
      { id: 'purpose', project: 'parent', parentId: null, capacity: [] },
      { id: 'feature', project: 'selected', parentId: 'purpose', capacity: [{ team: 'team-a' }] },
      { id: 'story', project: 'child', parentId: 'feature', capacity: [] },
      { id: 'detail', project: 'child', parentId: 'story', capacity: [] },
      { id: 'other-team', project: 'child', parentId: 'feature', capacity: [{ team: 'team-b' }] },
      { id: 'other-story', project: 'child', parentId: 'other-team', capacity: [] },
      { id: 'unrelated', project: 'selected', parentId: null, capacity: [] },
    ].map((feature) => ({ ...feature, type: 'Feature', state: 'Active', relations: [] }));
    const store = createStore(state);
    const selectors = createScopeSelectors(store);
    const assignments = createFeatureSelectors(store).getCountsForTeam('team-a');
    const allocations = state.baseline.features.map((feature) => structuredClone(feature.capacity));
    const overview = state.baseline.features.map((feature) => feature.id);
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(overview);
    state.selection.teamIds = [];
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(overview);

    state.selection.teamIds = ['team-a'];
    state.view.options = { ...state.view.options, taskViewMode: 'team' };
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'purpose', 'feature', 'story', 'detail',
    ]);
    expect(selectors.getBoardBreakdown().teamExcludedTasks).toBe(3);
    expect(state.baseline.features.map((feature) => feature.capacity)).toEqual(allocations);
    expect(createFeatureSelectors(store).getCountsForTeam('team-a')).toEqual(assignments);

    state.view.context.child = false;
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['purpose', 'feature']);
    state.view.context.parent = false;
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['feature']);
    state.selection.teamIds = [];
    expect(selectors.getVisibleFeatures()).toEqual([]);
  });

  it('keeps a connecting other-team ancestor but not its unrelated descendants', () => {
    const state = baseState({
      view: { context: { parent: true, child: true }, options: { taskViewMode: 'team' } },
      selection: { teamIds: ['team-a'], taskTypeNames: [] },
    });
    state.baseline.features = [
      { id: 'root', project: 'selected', parentId: null, capacity: [] },
      { id: 'other-team', project: 'child', parentId: 'root', capacity: [{ team: 'team-b' }] },
      { id: 'selected-team', project: 'child', parentId: 'other-team', capacity: [{ team: 'team-a' }] },
      { id: 'story', project: 'child', parentId: 'selected-team', capacity: [] },
      { id: 'sibling', project: 'child', parentId: 'other-team', capacity: [] },
    ].map((feature) => ({ ...feature, type: 'Feature', state: 'Active', relations: [] }));
    const selectors = createScopeSelectors(createStore(state));
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'root', 'other-team', 'selected-team', 'story',
    ]);
    state.baseline.features = state.baseline.features.map((feature) =>
      feature.id === 'selected-team' ? { ...feature, excludedChildIds: ['story'] } : feature
    );
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'root', 'other-team', 'selected-team',
    ]);
  });

  it('reconciles selected-plan pool, scope, presentation, filters and team focus', () => {
    const state = baseState({
      selection: { teamIds: ['team-a'] },
      view: { context: { child: true }, options: { taskViewMode: 'team' } },
    });
    state.baseline.features = state.baseline.features.map((feature) => ({ ...feature,
      sourcePlanIds: feature.id === 'parent-task' ? ['selected'] : [feature.project],
      presentationPlanIds: feature.id === 'hidden-type' ? [] : [feature.project],
    }));
    state.baseline.features.push({
      id: 'filtered', project: 'selected', type: 'Bug', state: 'Active',
      parentId: null, relations: [], capacity: [],
      sourcePlanIds: ['selected'], presentationPlanIds: ['selected'],
    });
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getBoardBreakdown()).toEqual({
      selectedPlanTasks: 2,
      sharedPlanTasks: 0,
      scopeAddedTasks: 1,
      scopeExcludedTasks: 0,
      displayableTasks: 3,
      taskFilterExcludedTasks: 1,
      filterExclusions: { schedule: 0, allocation: 0, hierarchy: 0, relations: 0, state: 0, taskTypes: 1 },
      teamExcludedTasks: 1,
      tasksVisible: 1,
      teamsInScope: 2,
    });
    state.view.context.child = false;
    const counts = selectors.getBoardBreakdown();
    expect(counts.scopeAddedTasks).toBe(0);
    expect(counts.selectedPlanTasks - counts.sharedPlanTasks + counts.scopeAddedTasks
      - counts.scopeExcludedTasks - counts.taskFilterExcludedTasks
      - counts.teamExcludedTasks).toBe(selectors.getVisibleFeatures().length);
    state.selection.projectIds = [];
    const emptyCounts = selectors.getBoardBreakdown();
    expect(emptyCounts.selectedPlanTasks).toBe(0);
    expect(emptyCounts.tasksVisible).toBe(0);
    expect(Object.values(emptyCounts.filterExclusions).every((count) => count === 0)).toBe(true);
  });

  it('accounts for sidebar filters in order without counting overlapping exclusions twice', () => {
    const state = baseState();
    state.selection.taskFilters = {
      schedule: { planned: true, unplanned: false },
      allocation: { allocated: true, unallocated: false },
      hierarchy: { hasParent: true, noParent: false },
      relations: { hasLinks: true, noLinks: false },
    };
    state.baseline.features = Array.from({ length: 7 }, (_, index) => ({
      id: String(index), project: 'selected', type: index === 0 || index === 5 ? 'Bug' : 'Feature',
      state: index === 4 ? 'Closed' : 'Active',
      start: index === 0 ? null : '2026-10-01', end: '2026-10-31',
      parentId: index === 2 ? null : '6',
      relations: index === 3 ? [] : [{ id: '6', type: 'Related' }],
      capacity: index === 1 ? [] : [{ team: 'team-a' }],
    }));
    const selectors = createScopeSelectors(createStore(state));
    const counts = selectors.getBoardBreakdown();
    expect(counts.filterExclusions).toEqual({
      schedule: 1, allocation: 1, hierarchy: 1, relations: 1, state: 1, taskTypes: 1,
    });
    expect(counts.displayableTasks).toBe(7);
    expect(counts.taskFilterExcludedTasks).toBe(6);
    expect(counts.tasksVisible).toBe(1);
    expect(counts.displayableTasks - Object.values(counts.filterExclusions)
      .reduce((sum, count) => sum + count, 0) - counts.teamExcludedTasks)
      .toBe(selectors.getVisibleFeatures().length);
  });

  it('starts with the exact Plan menu total rather than hidden imported context', () => {
    const state = baseState({ view: { context: { child: true } } });
    state.baseline.features = Array.from({ length: 320 }, (_, index) => ({
      id: String(index), project: index < 313 ? 'selected' : 'child',
      sourcePlanIds: [index < 313 ? 'selected' : 'child'],
      presentationPlanIds: index >= 213 && index < 313 ? [] : [index < 313 ? 'selected' : 'child'],
      parentId: index >= 313 ? '0' : null,
      type: 'Feature', state: 'Active', relations: [], capacity: [{ team: 'team-a' }],
    }));
    const store = createStore(state);
    const planCounts = createFeatureSelectors(store).getCountsForProject('selected');
    const counts = createScopeSelectors(store).getBoardBreakdown();
    expect(counts.selectedPlanTasks).toBe([...planCounts.values()].reduce((sum, count) => sum + count, 0));
    expect(counts.selectedPlanTasks).toBe(213);
    expect(counts.scopeAddedTasks).toBe(7);
    expect(counts.displayableTasks).toBe(220);
    expect(counts.tasksVisible).toBe(220);
  });

  it('deduplicates shared Plan menu counts and removes work outside current board scope', () => {
    const state = baseState({ selection: { projectIds: ['selected', 'child'] } });
    state.baseline.features = state.baseline.features.filter((feature) =>
      feature.id === 'own' || feature.id === 'parent-task'
    ).map((feature) => ({ ...feature,
      sourcePlanIds: ['selected', 'child'], presentationPlanIds: ['selected', 'child'],
    }));
    const selectors = createScopeSelectors(createStore(state));
    const counts = selectors.getBoardBreakdown();
    expect(counts.selectedPlanTasks).toBe(4);
    expect(counts.sharedPlanTasks).toBe(2);
    expect(counts.scopeExcludedTasks).toBe(1);
    expect(counts.displayableTasks).toBe(1);
    state.view.context.parent = true;
    expect(selectors.getBoardBreakdown().scopeExcludedTasks).toBe(0);
    expect(selectors.getBoardBreakdown().displayableTasks).toBe(2);
  });

  it('orders count columns by configured hierarchy levels and type positions', () => {
    const state = baseState();
    state.baseline.projects = [{ id: 'selected', task_type_hierarchy: [
      { types: ['Epic', 'Initiative'] },
      { types: ['Feature', 'Change Request'] },
      { types: ['User Story', 'Bug'] },
      { types: ['Task'] },
    ] }];
    state.baseline.features = ['Zebra', 'Bug', 'Task', 'Change Request', 'Initiative',
      'User Story', 'Feature', 'Epic', 'Alpha'].map((type) => ({ type }));
    const selectors = createFeatureSelectors(createStore(state));

    expect(selectors.getAvailableTaskTypesOrdered()).toEqual([
      'Epic', 'Initiative', 'Feature', 'Change Request', 'User Story', 'Bug', 'Task',
      'Alpha', 'Zebra',
    ]);
    state.baseline.projects[0].task_type_hierarchy[1].types = ['Change Request', 'Feature'];
    expect(selectors.getAvailableTaskTypesOrdered().slice(2, 4)).toEqual([
      'Change Request', 'Feature',
    ]);
  });

  it('honors admin display states for owned and ancestor context without changing resolved work', () => {
    const state = baseState({ view: { context: { parent: true } } });
    state.baseline.projects = state.baseline.projects.map((project) => ({ ...project,
      display_states: project.id === 'selected' ? ['Active'] : ['New'],
    }));
    state.baseline.features = state.baseline.features.map((feature) => ({ ...feature,
      ancestorOnly: feature.id === 'parent-task',
      presentationPlanIds: feature.id === 'parent-task' ? [] : [feature.project],
      state: feature.id === 'hidden-type' ? 'Closed' : feature.state,
    }));
    state.selection.featureStateNames = ['Active', 'Closed'];
    state.selection.taskTypeNames = [];
    const selectors = createScopeSelectors(createStore(state));

    expect(selectors.getPresentableContextFeatures().map((feature) => feature.id)).toEqual(['own']);
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['own']);
    expect(selectors.getResolvedFeatures()).toHaveLength(6);
    expect(selectors.getContextOptionCounts().parent).toBe(0);

    state.baseline.projects = state.baseline.projects.map((project) => ({ ...project,
      display_states: ['Active', 'Closed'],
    }));
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual([
      'own', 'parent-task', 'hidden-type',
    ]);
    expect(selectors.getContextOptionCounts().parent).toBe(1);
  });

  it('previews ancestor-only cards symmetrically when enabling and disabling Ancestors', () => {
    const state = baseState();
    state.baseline.features = state.baseline.features.map((feature) => ({ ...feature,
      ancestorOnly: feature.id === 'parent-task',
      presentationPlanIds: feature.id === 'parent-task' ? [] : [feature.project],
    }));
    const selectors = createScopeSelectors(createStore(state));
    const before = selectors.getVisibleFeatures().length;
    const additions = selectors.getContextOptionCounts().parent;
    expect(additions).toBe(1);
    expect(state.view.context.parent).toBe(false);

    state.view.context.parent = true;
    const after = selectors.getVisibleFeatures().length;
    expect(after - before).toBe(additions);
    expect(selectors.getContextOptionCounts().parent).toBe(additions);

    state.view.context.parent = false;
    expect(selectors.getContextOptionCounts().parent).toBe(additions);
    expect(selectors.getVisibleFeatures()).toHaveLength(before);
  });

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
      parent: 1, child: 2, dependency: 1, otherAllocations: 1,
    });
    state.view.context.parent = true;
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['ancestor']);
    expect(selectors.getContextOptionCounts().parent).toBe(1);
    state.view.context.parent = false;
    state.view.context.child = true;
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['child', 'unallocated-child']);
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
      view: { context: { parent: true, child: true, dependency: true, otherAllocations: true },
        options: { taskViewMode: 'team' } },
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

  it('shows child-context tasks in overview even when no teams are selected', () => {
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
      'child-task',
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
      'child-task',
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
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['own']);
    expect(selectors.getContextOptionCounts()).toEqual(clearFocusCounts);
    state.view.context.child = true;
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['own', 'child-task']);
    expect(selectors.getContextOptionCounts().child).toBe(1);
    state.selection.teamIds = [];
    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['own', 'child-task']);
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

  it('keeps all allocated and unallocated scoped tasks in plan overview', () => {
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
      'own-team-b',
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
      'team-b-leaf',
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
      view: { context: { parent: true, child: false, dependency: false, otherAllocations: false },
        options: { taskViewMode: 'team' } },
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
    ]);
  });

  it('keeps Other allocations visible in plan overview when Team Drill-down is clear', () => {
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
      'dependency-task',
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