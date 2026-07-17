import { expect } from '@esm-bundle/chai';

import {
  selectEffectiveSelectedProjectIds,
  selectExpandedFeatureIds,
  selectExpandedFeatureSet,
  selectParentChildClosure,
  selectTeamAllocationExpansionFeatures,
  selectTeamAllocatedFeatureIds,
} from '../../www/js/application/selectors/expansionSelectors.js';

const features = [
  { id: 'root', project: 'p1' },
  {
    id: 'selected',
    project: 'p1',
    parentId: 'root',
    relations: [{ id: 'related' }],
  },
  { id: 'descendant', project: 'p1', parentId: 'selected' },
  { id: 'sibling', project: 'p2', parentId: 'root' },
  { id: 'related', project: 'p2' },
  { id: 'team-allocated', project: 'p3', capacity: [{ team: 't1', capacity: 25 }] },
  { id: 'zero-allocation', project: 'p4', capacity: [{ team: 't1', capacity: 0 }] },
];

const childrenByParent = new Map([
  ['root', ['selected', 'sibling']],
  ['selected', ['descendant']],
]);

describe('expansion selectors', () => {
  it('includes ancestors and true descendants without traversing into ancestor siblings', () => {
    const expandedIds = selectParentChildClosure(
      features,
      childrenByParent,
      new Set(['selected'])
    );

    expect([...expandedIds].sort()).to.deep.equal(['descendant', 'root', 'selected']);
  });

  it('combines independent modes and reports additions by mode', () => {
    const result = selectExpandedFeatureSet({
      features,
      childrenByParent,
      selectedFeatureIds: new Set(['selected']),
      expansion: {
        parentChild: true,
        relations: true,
        teamAllocated: true,
      },
      selectedTeamIds: ['t1'],
    });

    expect([...result.expandedIds].sort()).to.deep.equal([
      'descendant',
      'related',
      'root',
      'selected',
      'team-allocated',
    ]);
    expect(result.counts).to.deep.equal({
      parentChild: 2,
      relations: 1,
      teamAllocated: 1,
    });
  });

  it('expands selected project IDs with positive allocations to selected teams only', () => {
    const projectIds = selectEffectiveSelectedProjectIds({
      projects: [
        { id: 'p1', selected: true },
        { id: 'p2', selected: false },
        { id: 'p3', selected: false },
        { id: 'p4', selected: false },
      ],
      teams: [{ id: 't1', selected: true }],
      features,
      expandTeamAllocated: true,
    });

    expect(projectIds).to.deep.equal(['p1', 'p3']);
    expect([...selectTeamAllocatedFeatureIds(features, ['t1'])]).to.deep.equal([
      'team-allocated',
    ]);
  });

  it('builds expanded IDs from selected projects when no expansion is enabled', () => {
    const expandedIds = selectExpandedFeatureIds({
      projects: [
        { id: 'p1', selected: true },
        { id: 'p2', selected: false },
      ],
      teams: [{ id: 't1', selected: true }],
      features,
      childrenByParent,
      expansion: {},
    });

    expect([...expandedIds].sort()).to.deep.equal(['descendant', 'root', 'selected']);
  });

  it('returns expansion features only when team-allocation mode is active with selected teams', () => {
    expect(
      selectTeamAllocationExpansionFeatures({
        features,
        selectedTeamIds: ['t1'],
        expandTeamAllocated: true,
      })
    ).to.deep.equal(features);

    expect(
      selectTeamAllocationExpansionFeatures({
        features,
        selectedTeamIds: [],
        expandTeamAllocated: true,
      })
    ).to.deep.equal([]);
  });

  it('matches team-allocation expansion when selected team IDs are strings and capacity team IDs are numbers', () => {
    const numericCapacityFeatures = [
      { id: 'f-1', project: 'p1', capacity: [{ team: 42, capacity: 10 }] },
    ];

    const teamAllocated = selectTeamAllocatedFeatureIds(numericCapacityFeatures, ['42']);
    expect([...teamAllocated]).to.deep.equal(['f-1']);

    const expandedIds = selectExpandedFeatureIds({
      projects: [{ id: 'p1', selected: false }],
      teams: [{ id: '42', selected: true }],
      features: numericCapacityFeatures,
      expansion: { teamAllocated: true },
    });
    expect([...expandedIds]).to.deep.equal(['f-1']);
  });

  it('expands from empty selection when only team-allocation expansion is active', () => {
    const crossPlanFeatures = [
      { id: 'a', project: 'p1', capacity: [{ team: 't1', capacity: 1 }] },
      { id: 'b', project: 'p2', capacity: [{ team: 't1', capacity: 2 }] },
      { id: 'c', project: 'p3', capacity: [{ team: 't2', capacity: 5 }] },
    ];

    const expandedIds = selectExpandedFeatureIds({
      projects: [
        { id: 'p1', selected: false },
        { id: 'p2', selected: false },
        { id: 'p3', selected: false },
      ],
      teams: [
        { id: 't1', selected: true },
        { id: 't2', selected: false },
      ],
      features: crossPlanFeatures,
      expansion: { teamAllocated: true },
    });

    expect([...expandedIds].sort()).to.deep.equal(['a', 'b']);
  });

  it('returns empty expanded IDs when no projects are selected and no expansion mode is active', () => {
    const expandedIds = selectExpandedFeatureIds({
      projects: [{ id: 'p1', selected: false }],
      teams: [{ id: 't1', selected: true }],
      features: [{ id: 'a', project: 'p1', capacity: [{ team: 't1', capacity: 1 }] }],
      expansion: { teamAllocated: false, parentChild: false, relations: false },
    });

    expect([...expandedIds]).to.deep.equal([]);
  });
});
