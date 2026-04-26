/**
 * Tests for SwimlaneService — pure swimlane grouping logic.
 * No DOM or Lit dependencies; runs cleanly in Vitest/jsdom.
 */
import { describe, it, expect } from 'vitest';
import {
  isSwimlaneMode,
  buildSwimlaneList,
  assignFeatureToSwimlane,
} from '../www/js/services/SwimlaneService.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mkProject = (id, name, selected, color = '#aaa', type = 'project') => ({
  id,
  name,
  color,
  selected,
  type,
});

const mkTeam = (id, name, selected, color = '#bbb') => ({ id, name, color, selected });

/**
 * @param {string} id
 * @param {string} projectId
 * @param {string|null} parentId
 * @param {Array<[string, number]>} teamCapacities  [[teamId, capacity], ...]
 */
const mkFeature = (id, projectId, parentId = null, teamCapacities = []) => ({
  id,
  project: projectId,
  parentId,
  capacity: teamCapacities.map(([team, capacity]) => ({ team, capacity })),
});

const noExpansion = {
  expandParentChild: false,
  expandRelations: false,
  expandTeamAllocated: false,
};

// ---------------------------------------------------------------------------
// isSwimlaneMode
// ---------------------------------------------------------------------------

describe('isSwimlaneMode', () => {
  it('returns false with 0 selected projects and no expansion', () => {
    const projects = [mkProject('a', 'A', false), mkProject('b', 'B', false)];
    expect(isSwimlaneMode(projects, noExpansion)).toBe(false);
  });

  it('returns false with 1 selected project and no expansion', () => {
    const projects = [mkProject('a', 'A', true), mkProject('b', 'B', false)];
    expect(isSwimlaneMode(projects, noExpansion)).toBe(false);
  });

  it('returns true with exactly 2 selected projects', () => {
    const projects = [mkProject('a', 'A', true), mkProject('b', 'B', true)];
    expect(isSwimlaneMode(projects, noExpansion)).toBe(true);
  });

  it('returns true with 3+ selected projects', () => {
    const projects = [
      mkProject('a', 'A', true),
      mkProject('b', 'B', true),
      mkProject('c', 'C', true),
    ];
    expect(isSwimlaneMode(projects, noExpansion)).toBe(true);
  });

  it('returns true with expandTeamAllocated and 0 projects', () => {
    expect(isSwimlaneMode([], { ...noExpansion, expandTeamAllocated: true })).toBe(true);
  });

  it('returns true with expandTeamAllocated and 1 selected project', () => {
    const projects = [mkProject('a', 'A', true)];
    expect(isSwimlaneMode(projects, { ...noExpansion, expandTeamAllocated: true })).toBe(
      true
    );
  });

  it('returns false when expandTeamAllocated is false, even with 1 project', () => {
    const projects = [mkProject('a', 'A', true)];
    expect(isSwimlaneMode(projects, noExpansion)).toBe(false);
  });

  it('handles null/undefined gracefully', () => {
    expect(isSwimlaneMode(null, null)).toBe(false);
    expect(isSwimlaneMode(undefined, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSwimlaneList
// ---------------------------------------------------------------------------

describe('buildSwimlaneList', () => {
  const projects = [
    mkProject('p1', 'Alpha', true, '#ff0000'),
    mkProject('p2', 'Beta', true, '#00ff00'),
    mkProject('p3', 'Gamma', false, '#0000ff'),
  ];
  const teams = [
    mkTeam('t1', 'Team One', true, '#111111'),
    mkTeam('t2', 'Team Two', false, '#222222'),
    mkTeam('t3', 'Team Three', true, '#333333'),
  ];

  it('returns plan swimlanes for selected projects only', () => {
    const list = buildSwimlaneList(projects, teams, noExpansion, []);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'p1', name: 'Alpha', type: 'plan' });
    expect(list[1]).toMatchObject({ id: 'p2', name: 'Beta', type: 'plan' });
  });

  it('preserves project order', () => {
    const list = buildSwimlaneList(projects, teams, noExpansion, []);
    expect(list.map((s) => s.id)).toEqual(['p1', 'p2']);
  });

  it('includes plan color in swimlane descriptor', () => {
    const list = buildSwimlaneList(projects, teams, noExpansion, []);
    expect(list[0].color).toBe('#ff0000');
    expect(list[1].color).toBe('#00ff00');
  });

  it('adds expanded-plan swimlane for unselected project when expandParentChild on', () => {
    const visibleFeatures = [mkFeature('f1', 'p1'), mkFeature('f2', 'p3')];
    const list = buildSwimlaneList(
      projects,
      teams,
      { ...noExpansion, expandParentChild: true },
      visibleFeatures
    );
    const p3Lane = list.find((s) => s.id === 'p3');
    expect(p3Lane).toBeTruthy();
    expect(p3Lane.type).toBe('expanded-plan');
  });

  it('adds expanded-plan swimlane for unselected project when expandRelations on', () => {
    const visibleFeatures = [mkFeature('f1', 'p1'), mkFeature('f2', 'p3')];
    const list = buildSwimlaneList(
      projects,
      teams,
      { ...noExpansion, expandRelations: true },
      visibleFeatures
    );
    expect(list.find((s) => s.id === 'p3')).toBeTruthy();
  });

  it('does not add expanded-plan when no expansion flag is active', () => {
    const visibleFeatures = [mkFeature('f1', 'p1'), mkFeature('f2', 'p3')];
    const list = buildSwimlaneList(projects, teams, noExpansion, visibleFeatures);
    expect(list.find((s) => s.id === 'p3')).toBeFalsy();
  });

  it('does not duplicate a selected project as expanded-plan', () => {
    const visibleFeatures = [mkFeature('f1', 'p1'), mkFeature('f2', 'p2')];
    const list = buildSwimlaneList(
      projects,
      teams,
      { ...noExpansion, expandParentChild: true },
      visibleFeatures
    );
    // p1 and p2 are selected → plan type; should not appear twice
    const p1Lanes = list.filter((s) => s.id === 'p1');
    const p2Lanes = list.filter((s) => s.id === 'p2');
    expect(p1Lanes).toHaveLength(1);
    expect(p2Lanes).toHaveLength(1);
    expect(p1Lanes[0].type).toBe('plan');
    expect(p2Lanes[0].type).toBe('plan');
  });

  it('adds team swimlanes for selected teams when expandTeamAllocated on', () => {
    const list = buildSwimlaneList(
      projects,
      teams,
      { ...noExpansion, expandTeamAllocated: true },
      []
    );
    const teamLanes = list.filter((s) => s.type === 'team');
    expect(teamLanes).toHaveLength(2); // t1 and t3 are selected
    expect(teamLanes.map((s) => s.id)).toContain('t1');
    expect(teamLanes.map((s) => s.id)).toContain('t3');
    expect(teamLanes.map((s) => s.id)).not.toContain('t2');
  });

  it('places team swimlanes after plan swimlanes', () => {
    const list = buildSwimlaneList(
      projects,
      teams,
      { ...noExpansion, expandTeamAllocated: true },
      []
    );
    const lastPlanIdx = list.map((s) => s.type).lastIndexOf('plan');
    const firstTeamIdx = list.map((s) => s.type).indexOf('team');
    expect(firstTeamIdx).toBeGreaterThan(lastPlanIdx);
  });

  it('returns only team swimlanes when no projects selected and expandTeamAllocated on', () => {
    const noProjects = [];
    const list = buildSwimlaneList(
      noProjects,
      teams,
      { ...noExpansion, expandTeamAllocated: true },
      []
    );
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => s.type === 'team')).toBe(true);
  });

  it('returns empty list when nothing selected and no expansion', () => {
    const list = buildSwimlaneList(
      [mkProject('p1', 'Alpha', false)],
      [mkTeam('t1', 'Team', false)],
      noExpansion,
      []
    );
    expect(list).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// assignFeatureToSwimlane
// ---------------------------------------------------------------------------

describe('assignFeatureToSwimlane', () => {
  const swimlanes = [
    { id: 'p1', name: 'Alpha', color: '#f00', type: 'plan' },
    { id: 'p2', name: 'Beta', color: '#0f0', type: 'plan' },
    { id: 'p3', name: 'Gamma', color: '#00f', type: 'expanded-plan' },
    { id: 't1', name: 'Team One', color: '#111', type: 'team' },
  ];

  const selectedProjectIds = new Set(['p1', 'p2']);
  const selectedTeamIds = new Set(['t1']);

  it('assigns feature to its own plan swimlane (p1)', () => {
    const feature = mkFeature('f1', 'p1');
    expect(
      assignFeatureToSwimlane(
        feature,
        swimlanes,
        new Map(),
        noExpansion,
        selectedProjectIds,
        selectedTeamIds
      )
    ).toBe('p1');
  });

  it('assigns feature to its own plan swimlane (p2)', () => {
    const feature = mkFeature('f2', 'p2');
    expect(
      assignFeatureToSwimlane(
        feature,
        swimlanes,
        new Map(),
        noExpansion,
        selectedProjectIds,
        selectedTeamIds
      )
    ).toBe('p2');
  });

  describe('parent chain walking (expandParentChild)', () => {
    it('moves B-plan child to A-plan swimlane when parent is in A-plan', () => {
      const features = [
        mkFeature('epic1', 'p1'),           // A-plan parent (plan swimlane)
        mkFeature('task1', 'p2', 'epic1'),  // B-plan child, parent is A-plan epic
      ];
      const allFeaturesById = new Map(features.map((f) => [String(f.id), f]));

      expect(
        assignFeatureToSwimlane(
          features[1],
          swimlanes,
          allFeaturesById,
          { ...noExpansion, expandParentChild: true },
          selectedProjectIds,
          selectedTeamIds
        )
      ).toBe('p1'); // follows parent to A's swimlane
    });

    it('does not follow parent when expandParentChild is off', () => {
      const features = [
        mkFeature('epic1', 'p1'),
        mkFeature('task1', 'p2', 'epic1'),
      ];
      const allFeaturesById = new Map(features.map((f) => [String(f.id), f]));

      expect(
        assignFeatureToSwimlane(
          features[1],
          swimlanes,
          allFeaturesById,
          noExpansion,
          selectedProjectIds,
          selectedTeamIds
        )
      ).toBe('p2'); // stays in own plan swimlane
    });

    it('handles multi-level parent chains (grandchild follows root ancestor)', () => {
      const features = [
        mkFeature('root', 'p1'),             // A-plan root
        mkFeature('mid', 'p3', 'root'),      // expanded plan child of root
        mkFeature('leaf', 'p3', 'mid'),      // expanded plan grandchild
      ];
      const allFeaturesById = new Map(features.map((f) => [String(f.id), f]));

      expect(
        assignFeatureToSwimlane(
          features[2], // leaf (p3)
          swimlanes,
          allFeaturesById,
          { ...noExpansion, expandParentChild: true },
          selectedProjectIds,
          selectedTeamIds
        )
      ).toBe('p1'); // walks up mid→root, finds p1 plan swimlane
    });

    it('does not follow parent when parent is in expanded-plan (not plan) swimlane', () => {
      const features = [
        mkFeature('epic3', 'p3'),            // expanded-plan parent
        mkFeature('task3', 'p3', 'epic3'),   // child in same expanded-plan
      ];
      const allFeaturesById = new Map(features.map((f) => [String(f.id), f]));

      // Both in p3 (expanded-plan), no plan swimlane ancestor → stays in p3
      expect(
        assignFeatureToSwimlane(
          features[1],
          swimlanes,
          allFeaturesById,
          { ...noExpansion, expandParentChild: true },
          selectedProjectIds,
          selectedTeamIds
        )
      ).toBe('p3');
    });

    it('handles cycle in parent chain without infinite loop', () => {
      // Artificial cycle: f1.parentId = f2, f2.parentId = f1
      const features = [
        { id: 'f1', project: 'p3', parentId: 'f2', capacity: [] },
        { id: 'f2', project: 'p3', parentId: 'f1', capacity: [] },
      ];
      const allFeaturesById = new Map(features.map((f) => [String(f.id), f]));

      // Should not throw or loop; falls back to expanded-plan swimlane
      expect(() =>
        assignFeatureToSwimlane(
          features[0],
          swimlanes,
          allFeaturesById,
          { ...noExpansion, expandParentChild: true },
          selectedProjectIds,
          selectedTeamIds
        )
      ).not.toThrow();
    });
  });

  describe('team swimlane assignment (expandTeamAllocated)', () => {
    it('assigns expanded-plan feature to team lane based on capacity', () => {
      const feature = mkFeature('f3', 'p3', null, [['t1', 2]]);
      expect(
        assignFeatureToSwimlane(
          feature,
          swimlanes,
          new Map(),
          { ...noExpansion, expandTeamAllocated: true },
          selectedProjectIds,
          selectedTeamIds
        )
      ).toBe('t1'); // p3 not selected → goes to team lane
    });

    it('keeps selected-plan feature in plan lane even when team allocation exists', () => {
      const feature = mkFeature('f1', 'p1', null, [['t1', 2]]);
      expect(
        assignFeatureToSwimlane(
          feature,
          swimlanes,
          new Map(),
          { ...noExpansion, expandTeamAllocated: true },
          selectedProjectIds,
          selectedTeamIds
        )
      ).toBe('p1'); // p1 is selected → stays in plan swimlane
    });

    it('ignores zero-capacity allocations for team lane assignment', () => {
      // Feature allocated to t1 with capacity=0 should not go to team lane
      const feature = mkFeature('f3', 'p3', null, [['t1', 0]]);
      // Falls through to expanded-plan swimlane since no positive team capacity
      const result = assignFeatureToSwimlane(
        feature,
        swimlanes,
        new Map(),
        { ...noExpansion, expandTeamAllocated: true },
        selectedProjectIds,
        selectedTeamIds
      );
      // Ends up in expanded-plan or first swimlane, NOT team lane
      expect(result).not.toBe('t1');
    });

    it('uses first matching team when feature allocated to multiple teams', () => {
      // Feature allocated to both t1 and another team (t1 appears first in capacity)
      const swimlanesWithT2 = [
        ...swimlanes,
        { id: 't2', name: 'Team Two', color: '#222', type: 'team' },
      ];
      const selectedTeamIdsWithT2 = new Set(['t1', 't2']);
      const feature = mkFeature('f3', 'p3', null, [
        ['t1', 1],
        ['t2', 2],
      ]);
      const result = assignFeatureToSwimlane(
        feature,
        swimlanesWithT2,
        new Map(),
        { ...noExpansion, expandTeamAllocated: true },
        selectedProjectIds,
        selectedTeamIdsWithT2
      );
      expect(result).toBe('t1'); // first matching team
    });
  });

  describe('fallbacks', () => {
    it('assigns expanded-plan feature to its own expanded-plan swimlane', () => {
      const feature = mkFeature('f3', 'p3');
      expect(
        assignFeatureToSwimlane(
          feature,
          swimlanes,
          new Map(),
          noExpansion,
          selectedProjectIds,
          selectedTeamIds
        )
      ).toBe('p3');
    });

    it('falls back to first swimlane for unknown project', () => {
      const feature = mkFeature('f_unk', 'p_unknown');
      expect(
        assignFeatureToSwimlane(
          feature,
          swimlanes,
          new Map(),
          noExpansion,
          selectedProjectIds,
          selectedTeamIds
        )
      ).toBe('p1'); // first swimlane
    });

    it('returns null for empty swimlane list', () => {
      const feature = mkFeature('f1', 'p1');
      expect(
        assignFeatureToSwimlane(
          feature,
          [],
          new Map(),
          noExpansion,
          selectedProjectIds,
          selectedTeamIds
        )
      ).toBeNull();
    });
  });
});
