import { describe, it, expect } from 'vitest';
import { createSelectionSelectors } from '../../www/js/application/selectors/selectionSelectors.js';

describe('application/selectors/selectionSelectors', () => {
  it('state-store selectors read from selection slice', () => {
    const store = {
      getState: () => ({
        selection: {
          projectIds: ['p10', 'p11'],
          teamIds: ['t10'],
        },
        baseline: {
          projects: [],
          teams: [],
          features: [],
        },
      }),
    };

    const selectors = createSelectionSelectors(store);
    expect(selectors.getEffectiveSelectedProjectIds()).toEqual(['p10', 'p11']);
    expect(selectors.getSelectedProjectIds()).toEqual(['p10', 'p11']);
    expect(selectors.getSelectedTeamIds()).toEqual(['t10']);
  });

  it('state-store effective project ids remain the explicit plan selection', () => {
    const store = {
      getState: () => ({
        selection: {
          projectIds: ['p1'],
          teamIds: ['t1'],
        },
        baseline: {
          projects: [],
          teams: [],
          features: [
            { id: 'f1', project: 'p1', capacity: [{ team: 't2', capacity: 4 }] },
            { id: 'f2', project: 'p2', capacity: [{ team: 't1', capacity: 6 }] },
            { id: 'f3', project: 'p3', capacity: [] },
          ],
        },
      }),
    };

    const selectors = createSelectionSelectors(store);
    expect(selectors.getEffectiveSelectedProjectIds()).toEqual(['p1']);
  });

  it('state-store selectors use canonical selection arrays and do not synthesize ids from legacy item flags', () => {
    const store = {
      getState: () => ({
        selection: {
          projectIds: [],
          teamIds: [],
        },
        baseline: {
          projects: [
            { id: 'p1', selected: true },
            { id: 'p2', selected: false },
          ],
          teams: [
            { id: 't1', selected: true },
            { id: 't2', selected: false },
          ],
          features: [],
        },
      }),
    };

    const selectors = createSelectionSelectors(store);
    expect(selectors.getSelectedProjectIds()).toEqual([]);
    expect(selectors.getSelectedTeamIds()).toEqual([]);
    expect(selectors.getProjects()).toEqual([
      { id: 'p1', selected: false },
      { id: 'p2', selected: false },
    ]);
    expect(selectors.getTeams()).toEqual([
      { id: 't1', selected: false },
      { id: 't2', selected: false },
    ]);
  });

});
