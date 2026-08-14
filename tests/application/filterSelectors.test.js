import { describe, it, expect } from 'vitest';
import { createFilterSelectors } from '../../www/js/application/selectors/filterSelectors.js';
import { ColorService } from '../../www/js/services/ColorService.js';

describe('application/selectors/filterSelectors', () => {
  it('store selectors read selected states from selection slice', () => {
    const store = {
      getState: () => ({
        selection: {
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

  it('store selectors derive available states from baseline features when explicit list is absent', () => {
    const store = {
      getState: () => ({
        selection: {
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
            { id: 'f1', state: 'Todo' },
            { id: 'f2', state: 'Doing' },
            { id: 'f3', state: 'Todo' },
          ],
          projects: [],
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
        selection: {
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
            { id: 'f1', state: 'Todo' },
            { id: 'f2', state: 'Blocked' },
            { id: 'f3', state: 'Todo' },
          ],
          projects: [],
        },
      }),
    };

    const selectors = createFilterSelectors(store);
    expect(selectors.getAvailableFeatureStates()).toEqual(['Todo', 'Blocked']);
  });

  it('store selectors respect configured state_display_sequence ordering', () => {
    const store = {
      getState: () => ({
        selection: {
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
            { id: 'f1', state: 'Closed' },
            { id: 'f2', state: 'New' },
            { id: 'f3', state: 'Resolved' },
            { id: 'f4', state: 'Defined' },
            { id: 'f5', state: 'Active' },
          ],
          projects: [
            {
              state_display_sequence: [
                { types: ['New'] },
                { types: ['Defined'] },
                { types: ['Active'] },
                { types: ['Resolved'] },
                { types: ['Closed'] },
              ],
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
        selection: {
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
            { id: 'f1', state: 'Closed' },
            { id: 'f2', state: 'New' },
            { id: 'f3', state: 'Resolved' },
            { id: 'f4', state: 'Defined' },
            { id: 'f5', state: 'Active' },
          ],
          projects: [
            {
              state_display_sequence: [
                { types: ['New'] },
                { types: ['Defined'] },
                { types: ['Active'] },
                { types: ['Resolved'] },
                { types: ['Closed'] },
              ],
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
        selection: {
          featureStateNames: [],
          taskFilters: {
            schedule: { planned: true, unplanned: true },
            allocation: { allocated: true, unallocated: true },
            hierarchy: { hasParent: true, noParent: true },
            relations: { hasLinks: true, noLinks: true },
          },
        },
        baseline: {
          features: [{ id: 'f1', state: 'Todo' }, { id: 'f2', state: 'Doing' }],
          projects: [
            {
              state_categories: { Todo: 'Proposed', Doing: 'InProgress' },
              state_display_sequence: [{ types: ['Todo', 'Doing'] }],
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
    expect(selectors.getFeatureStateCategory('Todo')).toBe('Proposed');
    expect(selectors.compareFeatureStates('Doing', 'Todo')).toBeGreaterThan(0);
  });
});
