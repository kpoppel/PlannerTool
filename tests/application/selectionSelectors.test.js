import { describe, it, expect } from 'vitest';
import {
  createLegacySelectionSelectors,
  createSelectionSelectors,
} from '../../www/js/application/selectors/selectionSelectors.js';

describe('application/selectors/selectionSelectors', () => {
  it('legacy selectors read from state and delegate effective project ids', () => {
    const state = {
      projects: [
        { id: 'p1', selected: true },
        { id: 'p2', selected: false },
      ],
      teams: [
        { id: 't1', selected: false },
        { id: 't2', selected: true },
      ],
      getEffectiveSelectedProjectIds: () => ['p1'],
    };

    const selectors = createLegacySelectionSelectors(state);
    expect(selectors.getEffectiveSelectedProjectIds()).toEqual(['p1']);
    expect(selectors.getSelectedProjectIds()).toEqual(['p1']);
    expect(selectors.getSelectedTeamIds()).toEqual(['t2']);
  });

  it('state-store selectors read from selection slice', () => {
    const store = {
      getState: () => ({
        selection: {
          projectIds: ['p10', 'p11'],
          teamIds: ['t10'],
        },
      }),
    };

    const selectors = createSelectionSelectors(store);
    expect(selectors.getEffectiveSelectedProjectIds()).toEqual(['p10', 'p11']);
    expect(selectors.getSelectedProjectIds()).toEqual(['p10', 'p11']);
    expect(selectors.getSelectedTeamIds()).toEqual(['t10']);
  });

  it('state-store effective project ids preserve team-allocation expansion semantics', () => {
    const store = {
      getState: () => ({
        selection: {
          projectIds: ['p1'],
          teamIds: ['t1'],
        },
        view: {
          expansion: {
            teamAllocated: true,
          },
        },
        baseline: {
          features: [
            { id: 'f1', project: 'p1', capacity: [{ team: 't2', capacity: 4 }] },
            { id: 'f2', project: 'p2', capacity: [{ team: 't1', capacity: 6 }] },
            { id: 'f3', project: 'p3', capacity: [] },
          ],
        },
      }),
    };

    const selectors = createSelectionSelectors(store);
    expect(selectors.getEffectiveSelectedProjectIds()).toEqual(['p1', 'p2']);
  });

  it('state-store effective project ids fall back to selected project ids when team expansion is off', () => {
    const store = {
      getState: () => ({
        selection: {
          projectIds: ['p1'],
          teamIds: ['t1'],
        },
        view: {
          expansion: {
            teamAllocated: false,
          },
        },
        baseline: {
          features: [
            { id: 'f2', project: 'p2', capacity: [{ team: 't1', capacity: 6 }] },
          ],
        },
      }),
    };

    const selectors = createSelectionSelectors(store);
    expect(selectors.getEffectiveSelectedProjectIds()).toEqual(['p1']);
  });
});
