import { describe, expect, it } from 'vitest';
import { computeExpandedFeatureSet } from '../../www/js/application/shared/featureExpansion.js';

describe('application/shared/featureExpansion', () => {
  it('expands parent-child closure from selected features', () => {
    const features = [
      { id: 'epic', parentId: null, project: 'p2', relations: [], capacity: [] },
      { id: 'story', parentId: 'epic', project: 'p1', relations: [], capacity: [] },
      { id: 'task', parentId: 'story', project: 'p1', relations: [], capacity: [] },
    ];

    const result = computeExpandedFeatureSet(features, ['story'], {
      expandParentChild: true,
      expandRelations: false,
      expandTeamAllocated: false,
      selectedTeamIds: [],
    });

    expect(result.counts.parentChild).toBe(2);
    expect(result.counts.relations).toBe(0);
    expect(result.counts.teamAllocated).toBe(0);
    expect(Array.from(result.expandedIds).sort()).toEqual(['epic', 'story', 'task']);
  });

  it('adds only non parent-child relations to relation counts', () => {
    const features = [
      {
        id: 'root',
        parentId: null,
        project: 'p1',
        relations: [
          { id: 'ignored-child', type: 'Child' },
          { id: 'depends-a', relationType: 'DependsOn' },
        ],
        capacity: [],
      },
      { id: 'ignored-child', parentId: null, project: 'p2', relations: [], capacity: [] },
      { id: 'depends-a', parentId: null, project: 'p2', relations: [{ id: 'depends-b', relationType: 'Blocks' }], capacity: [] },
      { id: 'depends-b', parentId: null, project: 'p3', relations: [], capacity: [] },
    ];

    const result = computeExpandedFeatureSet(features, ['root'], {
      expandParentChild: false,
      expandRelations: true,
      expandTeamAllocated: false,
      selectedTeamIds: [],
    });

    expect(result.counts.parentChild).toBe(0);
    expect(result.counts.relations).toBe(2);
    expect(Array.from(result.expandedIds).sort()).toEqual(['depends-a', 'depends-b', 'root']);
  });

  it('counts team-allocated additions against the base set', () => {
    const features = [
      { id: 'selected', project: 'p1', capacity: [{ team: 't1', capacity: 3 }], relations: [] },
      { id: 'outside-selected-project', project: 'p2', capacity: [{ team: 't1', capacity: 2 }], relations: [] },
      { id: 'other-team', project: 'p3', capacity: [{ team: 't2', capacity: 4 }], relations: [] },
    ];

    const result = computeExpandedFeatureSet(features, ['selected'], {
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: true,
      selectedTeamIds: ['t1'],
    });

    expect(result.counts.parentChild).toBe(0);
    expect(result.counts.relations).toBe(0);
    expect(result.counts.teamAllocated).toBe(1);
    expect(Array.from(result.expandedIds).sort()).toEqual(['outside-selected-project', 'selected']);
  });
});
