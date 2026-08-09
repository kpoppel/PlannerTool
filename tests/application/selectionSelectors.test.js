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

  it('state-store selectors preserve legacy object fields while applying store selection ids', () => {
    const store = {
      getState: () => ({
        selection: {
          projectIds: ['p2'],
          teamIds: ['t1'],
        },
        baseline: {
          projects: [{ id: 'p1', color: '#111111' }],
          teams: [{ id: 't1', color: '#222222' }],
        },
      }),
    };
    const legacyState = {
      projects: [
        { id: 'p1', name: 'Alpha', color: '#00AA00', selected: true },
        { id: 'p2', name: 'Beta', color: '#AA0000', selected: false },
      ],
      teams: [
        { id: 't1', name: 'Core', color: '#0044CC', selected: false },
        { id: 't2', name: 'API', color: '#AA00AA', selected: true },
      ],
    };

    const selectors = createSelectionSelectors(store, legacyState);
    expect(selectors.getProjects()).toEqual([
      { id: 'p1', name: 'Alpha', color: '#00AA00', selected: false },
      { id: 'p2', name: 'Beta', color: '#AA0000', selected: true },
    ]);
    expect(selectors.getTeams()).toEqual([
      { id: 't1', name: 'Core', color: '#0044CC', selected: true },
      { id: 't2', name: 'API', color: '#AA00AA', selected: false },
    ]);
  });

  it('state-store selectors fall back to legacy selected flags or default-all when ids are empty', () => {
    const store = {
      getState: () => ({
        selection: {
          projectIds: [],
          teamIds: [],
        },
        baseline: {
          projects: [{ id: 'bp1' }],
          teams: [{ id: 'bt1' }],
        },
      }),
    };
    const legacyState = {
      projects: [
        { id: 'p1', selected: true },
        { id: 'p2', selected: false },
      ],
      teams: [{ id: 't1' }, { id: 't2' }],
    };

    const selectors = createSelectionSelectors(store, legacyState);
    expect(selectors.getSelectedProjectIds()).toEqual(['p1']);
    expect(selectors.getSelectedTeamIds()).toEqual(['t1', 't2']);
    expect(selectors.getSelectedProjects().map((project) => project.id)).toEqual(['p1']);
    expect(selectors.getSelectedTeams().map((team) => team.id)).toEqual(['t1', 't2']);
  });
});
