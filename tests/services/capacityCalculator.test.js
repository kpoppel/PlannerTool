import { expect } from '@open-wc/testing';
import { CapacityCalculator } from '../../www/js/services/CapacityCalculator.js';
import { bus } from '../../www/js/core/EventBus.js';

describe('CapacityCalculator (unit)', () => {
  it('empty inputs produce empty result', () => {
    const calc = new CapacityCalculator(bus);
    const res = calc.calculate([], {}, [], []);
    expect(res).to.have.property('dates').that.is.an('array').that.is.empty;
  });

  it('_emptyResult returns empty collections for keys', () => {
    const calc = new CapacityCalculator(bus);
    const empty = calc._emptyResult();
    expect(empty).to.have.keys([
      'dates',
      'teamDailyCapacity',
      'teamDailyCapacityMap',
      'projectDailyCapacityRaw',
      'projectDailyCapacity',
      'projectDailyCapacityMap',
      'totalOrgDailyCapacity',
      'totalOrgDailyPerTeamAvg',
    ]);
    expect(empty.dates).to.be.an('array').that.is.empty;
  });

  it('_generateDateRange handles missing dates and returns correct iso list', () => {
    const calc = new CapacityCalculator(bus);
    const features = [
      { id: 'a', start: '2025-01-02', end: '2025-01-04' },
      { id: 'b', start: null, end: null },
      { id: 'c' },
    ];
    const dates = calc._generateDateRange(features);
    expect(dates).to.have.lengthOf(3);
    expect(dates[0]).to.equal('2025-01-02');
    expect(dates[2]).to.equal('2025-01-04');
  });

  it('generate date range and simple calculation', () => {
    const calc = new CapacityCalculator(bus);
    const features = [
      {
        id: 'f1',
        start: '2025-01-01',
        end: '2025-01-03',
        project: 'p1',
        state: 'active',
        capacity: [{ team: 't1', capacity: 2 }],
      },
    ];
    const teams = [{ id: 't1' }];
    const projects = [{ id: 'p1' }];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['t1'],
      selectedStates: ['active'],
    };

    const res = calc.calculate(features, filters, teams, projects);
    expect(res.dates).to.have.lengthOf(3);
    expect(res.teamDailyCapacity).to.be.an('array');
    expect(res.totalOrgDaily).to.be.an('array');
    // each day should have total org capacity 2
    expect(res.totalOrgDaily.every((v) => v === 2)).to.be.true;
  });

  it('incremental delta updates adjust cached result', () => {
    const calc = new CapacityCalculator(bus);
    const features = [
      {
        id: 'f1',
        start: '2025-02-01',
        end: '2025-02-02',
        project: 'p1',
        state: 'active',
        capacity: [{ team: 't1', capacity: 1 }],
      },
    ];
    const teams = [{ id: 't1' }];
    const projects = [{ id: 'p1' }];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['t1'],
      selectedStates: ['active'],
    };

    const first = calc.calculate(features, filters, teams, projects);
    expect(first.totalOrgDaily.every((v) => v === 1)).to.be.true;

    // Modify feature capacity and call calculate with changedFeatureIds to trigger deltas
    const newFeatures = [
      {
        id: 'f1',
        start: '2025-02-01',
        end: '2025-02-02',
        project: 'p1',
        state: 'active',
        capacity: [{ team: 't1', capacity: 3 }],
      },
    ];
    const updated = calc.calculate(newFeatures, filters, teams, projects, ['f1']);
    expect(updated.totalOrgDaily.every((v) => v === 3)).to.be.true;
  });

  it('epic children rollup: children allocations roll up to epic parent project', () => {
    const calc = new CapacityCalculator(bus);

    // Setup: Project A (type=project) with Epic E1
    //        Team B (type=team) with Feature F1 and F2 (children of E1)
    // Expected: F1 and F2 capacity should appear in Project A, not Team B

    const epic = {
      id: 'e1',
      type: 'epic',
      project: 'projectA',
      start: '2025-03-01',
      end: '2025-03-05',
      state: 'active',
      capacity: [], // Epic itself has no direct capacity
    };

    const child1 = {
      id: 'f1',
      type: 'feature',
      parentId: 'e1',
      project: 'teamB', // Feature belongs to team, not project
      start: '2025-03-01',
      end: '2025-03-03',
      state: 'active',
      capacity: [{ team: 't1', capacity: 2 }],
    };

    const child2 = {
      id: 'f2',
      type: 'feature',
      parentId: 'e1',
      project: 'teamB', // Feature belongs to team, not project
      start: '2025-03-03',
      end: '2025-03-05',
      state: 'active',
      capacity: [{ team: 't1', capacity: 3 }],
    };

    const features = [epic, child1, child2];
    const teams = [{ id: 't1' }];
    const projects = [
      { id: 'projectA', type: 'project' },
      { id: 'teamB', type: 'team' },
    ];

    // Set up children map
    const childrenByParent = new Map();
    childrenByParent.set('e1', ['f1', 'f2']);
    calc.setChildrenByParent(childrenByParent);

    const filters = {
      selectedProjects: ['projectA', 'teamB'],
      selectedTeams: ['t1'],
      selectedStates: ['active'],
    };

    const result = calc.calculate(features, filters, teams, projects);

    // Verify dates
    expect(result.dates).to.have.lengthOf(5);
    expect(result.dates[0]).to.equal('2025-03-01');
    expect(result.dates[4]).to.equal('2025-03-05');

    // Get project indices - note: unfunded project is added so indices shift
    const projectAIdx = projects.findIndex((p) => p.id === 'projectA');
    const teamBIdx = projects.findIndex((p) => p.id === 'teamB');

    // CRITICAL TEST: Children capacity should roll up to Project A (epic's project)
    // Day 0 (2025-03-01): child1 = 2
    expect(result.projectDailyCapacity[0][projectAIdx]).to.equal(
      2,
      'Day 0: child1 capacity should roll up to projectA'
    );
    expect(result.projectDailyCapacity[0][teamBIdx]).to.equal(
      0,
      'Day 0: teamB should have 0 (capacity rolled up to parent)'
    );

    // Day 1 (2025-03-02): child1 = 2
    expect(result.projectDailyCapacity[1][projectAIdx]).to.equal(
      2,
      'Day 1: child1 capacity should roll up to projectA'
    );

    // Day 2 (2025-03-03): child1 = 2, child2 = 3
    expect(result.projectDailyCapacity[2][projectAIdx]).to.equal(
      5,
      'Day 2: both children should roll up to projectA'
    );

    // Day 3 (2025-03-04): child2 = 3
    expect(result.projectDailyCapacity[3][projectAIdx]).to.equal(
      3,
      'Day 3: child2 capacity should roll up to projectA'
    );

    // Day 4 (2025-03-05): child2 = 3
    expect(result.projectDailyCapacity[4][projectAIdx]).to.equal(
      3,
      'Day 4: child2 capacity should roll up to projectA'
    );

    // Verify map-based results too
    expect(result.projectDailyCapacityMap[0]['projectA']).to.equal(2);
    expect(result.projectDailyCapacityMap[0]['teamB']).to.be.undefined; // Or 0
  });

  it('unfunded allocations: tasks without type=project parent go to unfunded', () => {
    const calc = new CapacityCalculator(bus);

    // Setup: Team B (type=team) with orphaned Epic (no parent to type=project)
    //        Epic has children with allocations
    // Expected: Children allocations should appear in __unfunded__ project

    const orphanEpic = {
      id: 'e2',
      type: 'epic',
      project: 'teamB', // Epic in team project, no parent
      start: '2025-04-01',
      end: '2025-04-03',
      state: 'active',
      capacity: [],
    };

    const orphanChild = {
      id: 'f3',
      type: 'feature',
      parentId: 'e2',
      project: 'teamB',
      start: '2025-04-01',
      end: '2025-04-02',
      state: 'active',
      capacity: [{ team: 't1', capacity: 5 }],
    };

    const orphanFeature = {
      id: 'f4',
      type: 'feature',
      project: 'teamB', // No parent, in team project
      start: '2025-04-02',
      end: '2025-04-03',
      state: 'active',
      capacity: [{ team: 't1', capacity: 3 }],
    };

    const features = [orphanEpic, orphanChild, orphanFeature];
    const teams = [{ id: 't1' }];
    const projects = [{ id: 'teamB', type: 'team' }];

    const childrenByParent = new Map();
    childrenByParent.set('e2', ['f3']);
    calc.setChildrenByParent(childrenByParent);

    const filters = {
      selectedProjects: ['teamB'],
      selectedTeams: ['t1'],
      selectedStates: ['active'],
    };

    const result = calc.calculate(features, filters, teams, projects);

    // Verify dates
    expect(result.dates).to.have.lengthOf(3);

    // Check that unfunded project has the allocations
    expect(result.projectDailyCapacityMap[0]['__unfunded__']).to.equal(
      5,
      'Day 0: orphan child should go to unfunded'
    );
    expect(result.projectDailyCapacityMap[1]['__unfunded__']).to.equal(
      8,
      'Day 1: both orphans should go to unfunded (5+3)'
    );
    expect(result.projectDailyCapacityMap[2]['__unfunded__']).to.equal(
      3,
      'Day 2: orphan feature should go to unfunded'
    );

    // Verify teamB has no capacity (all went to unfunded)
    expect(result.projectDailyCapacityMap[0]['teamB']).to.be.undefined;
  });

  // ---------------------------------------------------------------------------
  // Team-aware child precedence (USE_PARENT_CAPACITY_GAP_FILLS = true)
  // ---------------------------------------------------------------------------

  it('team-aware: team with children suppresses parent for that team across all parent days', () => {
    // Scenario from requirements:
    //   Parent epic: day 1-10, Team A 10%, Team B 20%
    //   Child feature: day 1-5, Team A 20%
    // Expected:
    //   day 1-5  → Team A 20% (child), Team B 20% (parent)
    //   day 6-10 → Team B 20% (parent)  — Team A parent NOT gap-filled
    const calc = new CapacityCalculator(bus);

    const epic = {
      id: 'epic1',
      project: 'p1',
      start: '2025-05-01', // day 1
      end: '2025-05-10',  // day 10
      state: 's',
      capacity: [
        { team: 'teamA', capacity: 10 },
        { team: 'teamB', capacity: 20 },
      ],
    };

    const child = {
      id: 'child1',
      parentId: 'epic1',
      project: 'p1',
      start: '2025-05-01', // day 1
      end: '2025-05-05',   // day 5
      state: 's',
      capacity: [{ team: 'teamA', capacity: 20 }],
    };

    const features = [epic, child];
    const teams = [{ id: 'teamA' }, { id: 'teamB' }];
    const projects = [{ id: 'p1', type: 'project' }];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['teamA', 'teamB'],
      selectedStates: ['s'],
    };

    const childrenByParent = new Map([['epic1', ['child1']]]);
    calc.setChildrenByParent(childrenByParent);

    const result = calc.calculate(features, filters, teams, projects);

    // Should span full epic range (day 1 – day 10)
    expect(result.dates).to.have.lengthOf(10);

    const teamAIdx = teams.findIndex((t) => t.id === 'teamA'); // 0
    const teamBIdx = teams.findIndex((t) => t.id === 'teamB'); // 1

    // Days 0-4 (day 1-5): Team A = 20 (child wins), Team B = 20 (parent, unaffected)
    for (let d = 0; d < 5; d++) {
      expect(result.teamDailyCapacity[d][teamAIdx]).to.equal(
        20,
        `Day ${d + 1}: Team A should come from child`
      );
      expect(result.teamDailyCapacity[d][teamBIdx]).to.equal(
        20,
        `Day ${d + 1}: Team B should come from parent`
      );
    }

    // Days 5-9 (day 6-10): Team A = 0 (parent suppressed, no child), Team B = 20 (parent)
    for (let d = 5; d < 10; d++) {
      expect(result.teamDailyCapacity[d][teamAIdx]).to.equal(
        0,
        `Day ${d + 1}: Team A parent must be suppressed (has children)`
      );
      expect(result.teamDailyCapacity[d][teamBIdx]).to.equal(
        20,
        `Day ${d + 1}: Team B should still come from parent`
      );
    }
  });

  it('team-aware: team without any children shows parent estimate unchanged', () => {
    // Parent: Team A 10% only, no children for Team A
    // Expected: parent's Team A allocation shown for all parent days
    const calc = new CapacityCalculator(bus);

    const epic = {
      id: 'epic2',
      project: 'p1',
      start: '2025-06-01',
      end: '2025-06-03',
      state: 's',
      capacity: [{ team: 'teamA', capacity: 15 }],
    };
    // Child has capacity for teamB (unrelated team)
    const child = {
      id: 'child2',
      parentId: 'epic2',
      project: 'p1',
      start: '2025-06-01',
      end: '2025-06-02',
      state: 's',
      capacity: [{ team: 'teamB', capacity: 25 }],
    };

    const features = [epic, child];
    const teams = [{ id: 'teamA' }, { id: 'teamB' }];
    const projects = [{ id: 'p1', type: 'project' }];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['teamA', 'teamB'],
      selectedStates: ['s'],
    };

    const childrenByParent = new Map([['epic2', ['child2']]]);
    calc.setChildrenByParent(childrenByParent);

    const result = calc.calculate(features, filters, teams, projects);
    expect(result.dates).to.have.lengthOf(3);

    const teamAIdx = 0;
    const teamBIdx = 1;

    // Day 0-1: teamA from parent (unaffected), teamB from child
    expect(result.teamDailyCapacity[0][teamAIdx]).to.equal(15, 'Day 0: teamA from parent');
    expect(result.teamDailyCapacity[0][teamBIdx]).to.equal(25, 'Day 0: teamB from child');

    // Day 2: teamA from parent, teamB = 0 (child does not cover day 2)
    expect(result.teamDailyCapacity[2][teamAIdx]).to.equal(15, 'Day 2: teamA from parent');
    expect(result.teamDailyCapacity[2][teamBIdx]).to.equal(0, 'Day 2: teamB child ends day 1');
  });

  // ---------------------------------------------------------------------------
  // Incremental delta: child capacity change must suppress parent contribution
  // ---------------------------------------------------------------------------

  it('incremental delta: adding child Team A capacity removes parent Team A from cache', () => {
    // Regression: Bug steps:
    //   1. Parent (epic) has Team A capacity → full calculate → cache stores parent Team A
    //   2. Child gets Team A capacity → delta update with changedIds = [child.id]
    // Expected after step 2: total Team A = child value only (parent suppressed).
    // Before fix: parent Team A stays in cache AND child is added → double-counting.
    const calc = new CapacityCalculator(bus);

    const epic = {
      id: 'epicDelta',
      project: 'p1',
      start: '2025-08-01',
      end: '2025-08-05',
      state: 's',
      capacity: [{ team: 'teamA', capacity: 10 }],
    };
    const childV1 = {
      id: 'childDelta',
      parentId: 'epicDelta',
      project: 'p1',
      start: '2025-08-01',
      end: '2025-08-05',
      state: 's',
      capacity: [],  // initially no capacity
    };

    const teams = [{ id: 'teamA' }];
    const projects = [{ id: 'p1', type: 'project' }];
    const filters = { selectedProjects: ['p1'], selectedTeams: ['teamA'], selectedStates: ['s'] };

    const childrenByParent = new Map([['epicDelta', ['childDelta']]]);
    calc.setChildrenByParent(childrenByParent);

    // Step 1: full calculate — parent contributes Team A, child has no capacity
    const step1 = calc.calculate([epic, childV1], filters, teams, projects);
    const teamAIdx = 0;
    expect(step1.teamDailyCapacity[0][teamAIdx]).to.equal(10, 'Step1: parent Team A = 10');

    // Step 2: child gets Team A capacity — incremental delta (only child.id changed)
    const childV2 = { ...childV1, capacity: [{ team: 'teamA', capacity: 20 }] };
    const step2 = calc.calculate([epic, childV2], filters, teams, projects, ['childDelta']);

    // Child wins → total must be 20, NOT 30 (which would be the double-count bug)
    for (let d = 0; d < 5; d++) {
      expect(step2.teamDailyCapacity[d][teamAIdx]).to.equal(
        20,
        `Day ${d}: child Team A replaces parent; must be 20 not 30`
      );
    }
  });

  it('team-aware: parent with no children is rendered fully', () => {
    // Regression: parent with no children must not be affected
    const calc = new CapacityCalculator(bus);

    const epic = {
      id: 'epicNone',
      project: 'p1',
      start: '2025-07-01',
      end: '2025-07-02',
      state: 's',
      capacity: [{ team: 'teamA', capacity: 30 }],
    };

    const features = [epic];
    const teams = [{ id: 'teamA' }];
    const projects = [{ id: 'p1', type: 'project' }];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['teamA'],
      selectedStates: ['s'],
    };

    calc.setChildrenByParent(new Map());

    const result = calc.calculate(features, filters, teams, projects);
    expect(result.dates).to.have.lengthOf(2);
    expect(result.teamDailyCapacity[0][0]).to.equal(30);
    expect(result.teamDailyCapacity[1][0]).to.equal(30);
  });
});
