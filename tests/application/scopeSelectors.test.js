import { describe, expect, it } from 'vitest';
import { createScopeSelectors } from '../../www/js/application/selectors/scopeSelectors.js';

function createStore(state) {
  return { getState: () => state };
}

function baseState(overrides = {}) {
  return {
    baseline: {
      projects: [{ id: 'selected' }, { id: 'parent' }, { id: 'child' }, { id: 'other' }],
      teams: [{ id: 'team-a' }, { id: 'team-b' }],
      features: [
        { id: 'own', project: 'selected', parentId: 'parent-task', type: 'Feature', relations: [], capacity: [{ team: 'team-a' }] },
        { id: 'parent-task', project: 'parent', parentId: null, type: 'Feature', relations: [], capacity: [{ team: 'team-a' }] },
        { id: 'child-task', project: 'child', parentId: 'own', type: 'Feature', relations: [], capacity: [{ team: 'team-b' }] },
        { id: 'dependency-task', project: 'other', parentId: null, type: 'Feature', relations: [], capacity: [{ team: 'team-a' }] },
        { id: 'unrelated', project: 'other', parentId: null, type: 'Bug', relations: [], capacity: [{ team: 'team-b' }] },
        { id: 'hidden-type', project: 'selected', parentId: null, type: 'Bug', relations: [], capacity: [] },
      ],
    },
    scenarios: {
      activeId: 'baseline',
      items: [{ id: 'baseline', overrides: {} }],
    },
    selection: {
      projectIds: ['selected'],
      teamIds: ['team-a', 'team-b'],
      taskFilters: { schedule: {}, allocation: {}, hierarchy: {}, relations: {} },
      taskTypeNames: ['Feature'],
    },
    view: {
      context: { parent: false, child: false, dependency: false, otherAllocations: false },
    },
    ...overrides,
  };
}

describe('application/selectors/scopeSelectors', () => {
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

  it('derives related scope counts from base-plan participants, not Team Drill-down focus', () => {
    const state = baseState({
      view: { context: { parent: false, child: false, dependency: false, otherAllocations: false } },
    });
    state.selection.teamIds = [];
    const selectors = createScopeSelectors(createStore(state));
    const clearFocusCounts = selectors.getContextOptionCounts();

    state.selection.teamIds = ['team-a'];
    const focusedCounts = selectors.getContextOptionCounts();

    expect(focusedCounts).toEqual(clearFocusCounts);
    expect(clearFocusCounts.child).to.equal(1);
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

  it('filters allocated selected-plan and contextual tasks by Team Drill-down', () => {
    const state = baseState();
    state.view.context.parent = true;
    state.baseline.features.push({
      id: 'own-team-b',
      project: 'selected',
      parentId: null,
      type: 'Feature',
      relations: [],
      capacity: [{ team: 'team-b' }],
    });
    state.baseline.features.push({
      id: 'own-unallocated',
      project: 'selected',
      parentId: null,
      type: 'Feature',
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
      relations: [],
      capacity: [{ team: 'team-b' }],
    });
    state.baseline.features.push({
      id: 'own-unallocated',
      project: 'selected',
      parentId: null,
      type: 'Feature',
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