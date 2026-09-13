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
    expect(selectors.getFunnel()).toEqual({ tasksVisible: 3, teamsInView: 1 });
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
    expect(selectors.getFunnel()).toEqual({ tasksVisible: 0, teamsInView: 0 });
  });

  it('does not mutate resolved features when display filters narrow visibility', () => {
    const state = baseState();
    state.selection.taskTypeNames = [];
    const selectors = createScopeSelectors(createStore(state));
    const resolved = selectors.getResolvedFeatures();

    expect(selectors.getVisibleFeatures().map((feature) => feature.id)).toEqual(['own']);
    state.selection.teamIds = ['team-b'];
    state.view.context.otherAllocations = true;
    expect(selectors.getResolvedFeatures()).toEqual(resolved);
  });
});