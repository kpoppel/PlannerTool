import { displayFixture } from '../../helpers/workItemDisplay.js';
import { describe, it, expect } from 'vitest';
import { createFilterSelectors } from '../../../www/js/application/selectors/filterSelectors.js';
import { ColorService } from '../../../www/js/services/ColorService.js';
import { createInitialAppState } from '../../../www/js/application/createInitialAppState.js';
import { taskTypeKey } from '../../../www/js/application/shared/workItemDisplay.js';

describe('application/selectors/filterSelectors', () => {
  it('limits state choices to explicitly selected and visible qualified types', () => {
    const state = createInitialAppState();
    state.baseline.projects = [{ work_item_display: [{ process_id: 'process',
      process_name: 'Process', tiers: [[
        { name: 'Feature', states: [{ name: 'Active', category: 'InProgress' }] },
        { name: 'Bug', states: [{ name: 'Open', category: 'Proposed' }] },
      ]] }] }];
    state.baseline.features = ['Feature', 'Bug'].map((type) => ({
      id: type, process_id: 'process', type,
    }));
    state.selection.taskTypeNames = [taskTypeKey('process', 'Bug')];
    const selectors = createFilterSelectors({ getState: () => state });
    expect(selectors.getAvailableFeatureStates()).toEqual(['Open']);
    state.view.options.hiddenTypes = [taskTypeKey('process', 'Bug')];
    expect(selectors.getAvailableFeatureStates()).toEqual([]);
  });

  it('offers ancestor card types while keeping hidden descendant types out of menus', () => {
    const state = createInitialAppState();
    state.baseline.features = [
      { process_id: 'process', id: 'seed', type: 'Feature', presentationPlanIds: ['plan-a'] },
      { process_id: 'process', id: 'ancestor', type: 'Epic', presentationPlanIds: [], ancestorOnly: true },
      { process_id: 'process', id: 'hidden', type: 'Requirement', presentationPlanIds: [] },
    ];
    const selectors = createFilterSelectors({ getState: () => state });
    expect(selectors.getSelectedTaskTypeNames()).toEqual(['Feature', 'Epic'].map((name) => taskTypeKey('process', name)));
  });

  it('treats historical anchor presentations as planned without changing task dates', () => {
    const state = createInitialAppState();
    state.selection.taskFilters.schedule = { planned: true, unplanned: false };
    const selectors = createFilterSelectors({ getState: () => state });
    const anchor = {
      id: 'closed-unscheduled',
      state: 'Closed',
      start: null,
      end: null,
      capacity: [],
      relations: [],
      presentation: { renderType: 'anchor', date: '2026-05-19', sourceState: 'Closed' },
    };
    const unplanned = { ...anchor, id: 'truly-unplanned', presentation: undefined };

    expect(selectors.getTaskFilterExclusion(anchor)).toBe(null);
    expect(selectors.getTaskFilterExclusion(unplanned)).toBe('schedule');
    expect(anchor.start).toBe(null);
    expect(anchor.end).toBe(null);
  });

  it('does not offer context-only types in ordinary task menus', () => {
    const state = createInitialAppState();
    state.baseline.features = [
      { process_id: 'process', id: 'seed', type: 'Epic', presentationPlanIds: ['plan-a'] },
      { process_id: 'process', id: 'linked', type: 'Requirement', presentationPlanIds: [] },
      { process_id: 'process', id: 'visible', type: 'Feature', presentationPlanIds: ['plan-a'] },
    ];
    const selectors = createFilterSelectors({ getState: () => state });

    expect(selectors.getSelectedTaskTypeNames()).toEqual(['Epic', 'Feature'].map((name) => taskTypeKey('process', name)));
    expect(state.baseline.features).toHaveLength(3);
  });

  it('projects visible types and unions packed restrictions with plugin restrictions', () => {
    const state = createInitialAppState();
    state.baseline.features = [{ process_id: 'process', id: 'a', type: 'Epic' }, { process_id: 'process', id: 'b', type: 'Task' }];
    state.view.options.hiddenTypes = ["[\"process\",\"epic\"]"];
    state.view.options.displayMode = 'packed';
    const pluginRestrictions = { taskFilters: { schedule: ['planned'] }, states: ['Done'] };
    state.selection.sidebarDisabled = pluginRestrictions;
    const selectors = createFilterSelectors({ getState: () => state });
    expect(selectors.getSelectedTaskTypeNames()).toEqual([taskTypeKey('process', 'Task')]);
    expect(selectors.isSidebarControlDisabled('taskFilter', 'schedule', 'planned')).toBe(true);
    expect(selectors.isSidebarControlDisabled('taskFilter', 'schedule', 'unplanned')).toBe(true);
    expect(selectors.isSidebarControlDisabled('state', 'Done')).toBe(true);
    state.view.options.displayMode = 'normal';
    expect(selectors.isSidebarControlDisabled('taskFilter', 'schedule', 'unplanned')).toBe(false);
    expect(selectors.isSidebarControlDisabled('taskFilter', 'schedule', 'planned')).toBe(true);
    expect(state.selection.sidebarDisabled).toBe(pluginRestrictions);
  });

  it('store selectors read selected states from selection slice', () => {
    const store = {
      getState: () => ({
        view: { options: { hiddenTypes: [] } },
        selection: {
          taskTypeNames: [],
          featureStateNames: ['Open', 'Closed'],
          taskFilters: {
            schedule: { planned: true, unplanned: true },
            allocation: { allocated: true, unallocated: true },
            hierarchy: { hasParent: true, noParent: true },
            relations: { hasLinks: true, noLinks: true },
          },
        },
        baseline: {
          features: [],
          projects: [],
        },
        filter: {
          availableFeatureStates: [],
        },
      }),
    };

    const selectors = createFilterSelectors(store);
    expect(Array.from(selectors.getSelectedFeatureStateSet())).toEqual(['Open', 'Closed']);
    expect(selectors.getSelectedFeatureStateNames()).toEqual(['Open', 'Closed']);
  });

  it('store selectors derive available states from normalized type metadata', () => {
    const store = {
      getState: () => ({
        view: { options: { hiddenTypes: [] } },
        selection: {
          taskTypeNames: [],
          featureStateNames: [],
          taskFilters: {
            schedule: { planned: true, unplanned: true },
            allocation: { allocated: true, unallocated: true },
            hierarchy: { hasParent: true, noParent: true },
            relations: { hasLinks: true, noLinks: true },
          },
        },
        baseline: {
          features: [
            { process_id: 'process', type: 'Feature', id: 'f1', state: 'Todo' },
            { process_id: 'process', type: 'Feature', id: 'f2', state: 'Doing' },
            { process_id: 'process', type: 'Feature', id: 'f3', state: 'Todo' },
          ],
          projects: [{ work_item_display: displayFixture([['Feature']], { Todo: 'Proposed', Doing: 'InProgress' }) }],
        },
        filter: {
          availableFeatureStates: [],
        },
      }),
    };

    const selectors = createFilterSelectors(store);
    expect(selectors.getAvailableFeatureStates()).toEqual(['Todo', 'Doing']);
  });

  it('store selectors tolerate a missing filter slice and still derive states from baseline data', () => {
    const store = {
      getState: () => ({
        view: { options: { hiddenTypes: [] } },
        selection: {
          taskTypeNames: [],
          featureStateNames: [],
          taskFilters: {
            schedule: { planned: true, unplanned: true },
            allocation: { allocated: true, unallocated: true },
            hierarchy: { hasParent: true, noParent: true },
            relations: { hasLinks: true, noLinks: true },
          },
        },
        baseline: {
          features: [
            { process_id: 'process', type: 'Feature', id: 'f1', state: 'Todo' },
            { process_id: 'process', type: 'Feature', id: 'f2', state: 'Blocked' },
            { process_id: 'process', type: 'Feature', id: 'f3', state: 'Todo' },
          ],
          projects: [{ work_item_display: displayFixture([['Feature']], { Todo: 'Proposed', Blocked: 'InProgress' }) }],
        },
      }),
    };

    const selectors = createFilterSelectors(store);
    expect(selectors.getAvailableFeatureStates()).toEqual(['Todo', 'Blocked']);
  });

  it('store selectors respect normalized type state ordering', () => {
    const store = {
      getState: () => ({
        view: { options: { hiddenTypes: [] } },
        selection: {
          taskTypeNames: [],
          featureStateNames: [],
          taskFilters: {
            schedule: { planned: true, unplanned: true },
            allocation: { allocated: true, unallocated: true },
            hierarchy: { hasParent: true, noParent: true },
            relations: { hasLinks: true, noLinks: true },
          },
        },
        baseline: {
          features: [
            { process_id: 'process', type: 'Feature', id: 'f1', state: 'Closed' },
            { process_id: 'process', type: 'Feature', id: 'f2', state: 'New' },
            { process_id: 'process', type: 'Feature', id: 'f3', state: 'Resolved' },
            { process_id: 'process', type: 'Feature', id: 'f4', state: 'Defined' },
            { process_id: 'process', type: 'Feature', id: 'f5', state: 'Active' },
          ],
          projects: [
            {
              work_item_display: displayFixture(undefined, undefined, ['New', 'Defined', 'Active', 'Resolved', 'Closed']),
            },
          ],
        },
        filter: {
          availableFeatureStates: [],
        },
      }),
    };

    const selectors = createFilterSelectors(store);
    expect(selectors.getAvailableFeatureStates()).toEqual([
      'New',
      'Defined',
      'Active',
      'Resolved',
      'Closed',
    ]);
    expect(selectors.compareFeatureStates('Resolved', 'Defined')).toBeGreaterThan(0);
  });

  it('store selectors prefer project configuration over stale explicit state order', () => {
    const store = {
      getState: () => ({
        view: { options: { hiddenTypes: [] } },
        selection: {
          taskTypeNames: [],
          featureStateNames: [],
          taskFilters: {
            schedule: { planned: true, unplanned: true },
            allocation: { allocated: true, unallocated: true },
            hierarchy: { hasParent: true, noParent: true },
            relations: { hasLinks: true, noLinks: true },
          },
        },
        filter: { availableFeatureStates: ['Closed', 'New', 'Resolved', 'Active', 'Defined'] },
        baseline: {
          features: [
            { process_id: 'process', type: 'Feature', id: 'f1', state: 'Closed' },
            { process_id: 'process', type: 'Feature', id: 'f2', state: 'New' },
            { process_id: 'process', type: 'Feature', id: 'f3', state: 'Resolved' },
            { process_id: 'process', type: 'Feature', id: 'f4', state: 'Defined' },
            { process_id: 'process', type: 'Feature', id: 'f5', state: 'Active' },
          ],
          projects: [
            {
              work_item_display: displayFixture(undefined, undefined, ['New', 'Defined', 'Active', 'Resolved', 'Closed']),
            },
          ],
        },
      }),
    };

    const selectors = createFilterSelectors(store);
    expect(selectors.getAvailableFeatureStates()).toEqual([
      'New',
      'Defined',
      'Active',
      'Resolved',
      'Closed',
    ]);
  });

  it('store selectors ignore legacy state and resolve metadata from the store only', () => {
    const legacyState = new Proxy(
      {},
      {
        get(target, prop) {
          throw new Error(`legacy state should not be accessed: ${String(prop)}`);
        },
      }
    );

    const store = {
      getState: () => ({
        view: { options: { hiddenTypes: [] } },
        selection: {
          taskTypeNames: [],
          featureStateNames: [],
          taskFilters: {
            schedule: { planned: true, unplanned: true },
            allocation: { allocated: true, unallocated: true },
            hierarchy: { hasParent: true, noParent: true },
            relations: { hasLinks: true, noLinks: true },
          },
        },
        baseline: {
          features: [{ process_id: 'process', type: 'Feature', id: 'f1', state: 'Todo' }, { process_id: 'process', type: 'Feature', id: 'f2', state: 'Doing' }],
          projects: [
            {
              work_item_display: displayFixture(undefined, { Todo: 'Proposed', Doing: 'InProgress' }, ['Todo', 'Doing']),
            },
          ],
        },
        filter: {
          availableFeatureStates: [],
        },
      }),
    };

    const selectors = createFilterSelectors(store, legacyState);
    const colors = selectors.getFeatureStateColors();
    const expected = new ColorService().getFeatureStateColors(['Todo', 'Doing']);

    expect(Object.keys(colors)).toEqual(['Todo', 'Doing']);
    expect(colors).toEqual(expected);
    expect(selectors.getFeatureStateCategory({ process_id: 'process', type: 'Feature', state: 'Todo' })).toBe('Proposed');
    expect(selectors.compareFeatureStates('Doing', 'Todo')).toBeGreaterThan(0);
  });

  it('hides every task when neither option in a task-filter dimension is selected', () => {
    const disabledDimensions = [
      ['schedule', { planned: false, unplanned: false }],
      ['allocation', { allocated: false, unallocated: false }],
      ['hierarchy', { hasParent: false, noParent: false }],
      ['relations', { hasLinks: false, noLinks: false }],
    ];
    const tasks = [
      {
        id: 'fully-populated',
        start: '2026-01-01',
        end: '2026-01-02',
        capacity: [{ team: 'A' }],
        parentId: 'parent-1',
        relations: [{ id: 'link-1' }],
      },
      {
        id: 'empty',
        capacity: [],
        relations: [],
      },
    ];

    for (const [dimension, options] of disabledDimensions) {
      const store = {
        getState: () => ({
        view: { options: { hiddenTypes: [] } },
          selection: {
            featureStateNames: [],
            taskFilters: {
              schedule: { planned: true, unplanned: true },
              allocation: { allocated: true, unallocated: true },
              hierarchy: { hasParent: true, noParent: true },
              relations: { hasLinks: true, noLinks: true },
              [dimension]: options,
            },
          },
          baseline: { features: [], projects: [] },
          filter: { availableFeatureStates: [] },
        }),
      };

      const selectors = createFilterSelectors(store);
      expect(tasks.filter((task) => selectors.featurePassesFilters(task))).toEqual([]);
    }
  });
});
