import { expect } from '@open-wc/testing';
import { CapacityCalculator } from '../../www/js/services/CapacityCalculator.js';
import { bus } from '../../www/js/core/EventBus.js';
import allocationCases from '../fixtures/allocation_rule/cases.json';

function planConfig(id, type = 'project') {
  const containerTypes = ['program', 'project', 'team'];
  return { id, type, container_order: containerTypes.indexOf(type), container_types: containerTypes };
}

describe('CapacityCalculator (unit)', () => {
  it('expands winning groups without duplicating organization load or its denominator', () => {
    const teams = [
      { id: 'A', kind: 'team', group_id: 'G' },
      { id: 'B', kind: 'team', group_id: 'G' },
      { id: 'G', kind: 'group' },
    ];
    const features = [{ id: 'root', project: 'p1', state: 'active',
      start: '2025-01-06', end: '2025-01-06', capacity: [{ team: 'G', capacity: 40 }] }];
    const result = new CapacityCalculator(bus).calculate(features,
      { selectedProjects: ['p1'], selectedStates: ['active'] }, teams, [planConfig('p1')]);
    expect(result.totalOrgDailyCapacity).to.deep.equal([80]);
    expect(result.totalOrgDailyPerTeamAvg).to.deep.equal([40]);
    expect(result.teamDailyCapacityMap).to.deep.equal([{ A: 40, B: 40, G: 40 }]);
    expect(result.teamDailyCapacity).to.deep.equal([[40, 40, 40]]);
  });

  it('invalidates a whole ancestor group before expanding member load', () => {
    const teams = [{ id: 'A', kind: 'team', group_id: 'G' },
      { id: 'B', kind: 'team', group_id: 'G' }, { id: 'G', kind: 'group' }];
    const features = [
      { id: 'root', project: 'p1', state: 'active', start: '2025-01-06', end: '2025-01-06',
        capacity: [{ team: 'G', capacity: 40 }] },
      { id: 'leaf', parentId: 'root', project: 'p1', state: 'active',
        start: '2025-01-06', end: '2025-01-06', capacity: [{ team: 'A', capacity: 100 }] },
    ];
    const result = new CapacityCalculator(bus).calculate(features,
      { selectedProjects: ['p1'], selectedStates: ['active'] }, teams, [planConfig('p1')]);
    expect(result.totalOrgDailyCapacity).to.deep.equal([100]);
    expect(result.teamDailyCapacityMap).to.deep.equal([{ A: 100, G: 50 }]);
    expect(result.teamDailyCapacity).to.deep.equal([[100, 0, 50]]);
  });

  it('invalid spans do not distort the date range or suppress planned reservations', () => {
    const features = [
      { id: 'root', project: 'p1', state: 'active', start: '2025-01-01', end: '2025-01-02',
        capacity: [{ team: 'A', capacity: 100 }] },
      { id: 'invalid-child', parentId: 'root', project: 'p1', state: 'active',
        start: '2025-02-30', end: 'invalid', capacity: [{ team: 'A', capacity: 20 }] },
      { id: 'reversed', project: 'p1', state: 'active', start: '2024-12-30', end: '2024-12-01',
        capacity: [{ team: 'A', capacity: 40 }] },
    ];
    const result = new CapacityCalculator(bus).calculate(features,
      { selectedProjects: ['p1'], selectedStates: ['active'] }, [{ id: 'A' }], [planConfig('p1')]);
    expect(result.dates).to.deep.equal(['2025-01-01', '2025-01-02']);
    expect(result.totalOrgDailyCapacity).to.deep.equal([100, 100]);
  });

  it('unplanned descendant allocations neither count nor suppress the planned parent', () => {
    const features = [
      { id: 'root', project: 'p1', state: 'active', start: '2025-01-01', end: '2025-01-02',
        capacity: [{ team: 'A', capacity: 100 }] },
      { id: 'leaf', parentId: 'root', project: 'p1', state: 'active',
        capacity: [{ team: 'A', capacity: 20 }] },
    ];
    const result = new CapacityCalculator(bus).calculate(features,
      { selectedProjects: ['p1'], selectedStates: ['active'] }, [{ id: 'A' }], [planConfig('p1')]);
    expect(result.totalOrgDailyCapacity).to.deep.equal([100, 100]);
    expect(result.teamDailyCapacity).to.deep.equal([[100], [100]]);
  });

  it('matches shared per-team monthly working-day loads', () => {
    const fixture = allocationCases.find((entry) => entry.monthlyLoad !== undefined);
    const features = fixture.features.map((feature) => ({ ...feature, state: 'active' }));
    const teams = Object.keys(fixture.monthlyLoad).map((id) => ({ id }));
    const result = new CapacityCalculator(bus).calculate(features,
      { selectedProjects: ['project-1', 'project-2'], selectedStates: ['active'] },
      teams, [planConfig('project-1'), planConfig('project-2')]);
    for (const team of teams) {
      const monthly = {};
      result.dates.forEach((date, index) => {
        const weekday = new Date(date).getUTCDay();
        const load = result.teamDailyCapacity[index][teams.indexOf(team)];
        if (weekday === 0 || weekday === 6 || load === 0) return;
        const month = date.slice(0, 7);
        if (monthly[month] === undefined) monthly[month] = 0;
        monthly[month] += load / 100;
      });
      for (const [month, load] of Object.entries(fixture.monthlyLoad[team.id])) {
        expect(monthly[month]).to.be.closeTo(load, 0.000001);
      }
      expect(Object.keys(monthly)).to.deep.equal(Object.keys(fixture.monthlyLoad[team.id]));
    }
  });

  it('resolves grandchild overrides before state and plan filters without mutating prior results', () => {
    const calc = new CapacityCalculator(bus);
    const features = [
      { id: 'root', project: 'p1', state: 'active', start: '2025-01-01', end: '2025-01-02',
        capacity: [{ team: 'A', capacity: 100 }] },
      { id: 'middle', parentId: 'root', project: 'p2', capacity: [] },
      { id: 'leaf', parentId: 'middle', project: 'p2', state: 'closed',
        start: '2025-01-01', end: '2025-01-02', capacity: [] },
    ];
    const filters = { selectedProjects: ['p1'], selectedStates: ['active'] };
    const teams = [{ id: 'A' }];
    const projects = [planConfig('p1'), planConfig('p2')];
    const before = calc.calculate(features, filters, teams, projects);
    const overridden = features.map((feature) => feature.id === 'leaf'
      ? { ...feature, capacity: [{ team: 'A', capacity: 20 }] } : feature);
    const after = calc.calculate(overridden, filters, teams, projects);
    expect(after.totalOrgDailyCapacity).to.deep.equal([0, 0]);
    expect(before.totalOrgDailyCapacity).to.deep.equal([100, 100]);
    expect(calc.calculate(features, filters, teams, projects).totalOrgDailyCapacity)
      .to.deep.equal([100, 100]);
  });

  it('counts shared hidden context once for any associated selected plan', () => {
    const calc = new CapacityCalculator(bus);
    const projects = [planConfig('p1'), planConfig('p2')];
    const features = [
      { id: 'seed', project: 'p1', sourcePlanIds: ['p1'], presentationPlanIds: ['p1'],
        start: '2025-01-01', end: '2025-01-01', state: 'active',
        capacity: [{ team: 't1', capacity: 90 }] },
      { id: 'linked', project: 'internal-owner', parentId: 'seed',
        sourcePlanIds: ['p1', 'p2'], presentationPlanIds: [],
        start: '2025-01-01', end: '2025-01-01', state: 'active',
        capacity: [{ team: 't1', capacity: 30 }] },
    ];
    const calculate = (selectedProjects, data = features) => calc.calculate(
      data, { selectedProjects, selectedStates: ['active'] }, [{ id: 't1' }], projects,
    );

    expect(calculate(['p1']).totalOrgDailyCapacity).to.deep.equal([30]);
    expect(calculate(['p2']).totalOrgDailyCapacity).to.deep.equal([30]);
    const sharedResult = calculate(['p1', 'p2']);
    expect(sharedResult.totalOrgDailyCapacity).to.deep.equal([30]);
    expect(sharedResult.planDailyCapacityMap[0]).to.deep.equal({ p1: 30, p2: 30 });
    const changed = features.map((feature) => feature.id === 'linked'
      ? { ...feature, capacity: [{ team: 't1', capacity: 40 }] } : feature);
    expect(calculate(['p1', 'p2'], changed).totalOrgDailyCapacity).to.deep.equal([40]);
    expect(calculate([]).totalOrgDailyCapacity).to.deep.equal([]);
  });

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
      'planDailyCapacityMap',
      'planTeamDailyCapacityMap',
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
    const projects = [planConfig('p1')];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['t1'],
      selectedStates: ['active'],
    };

    const res = calc.calculate(features, filters, teams, projects);
    expect(res.dates).to.have.lengthOf(3);
    expect(res.teamDailyCapacity).to.be.an('array');
    expect(res.totalOrgDailyCapacity).to.be.an('array');
    // each day should have total org capacity 2
    expect(res.totalOrgDailyCapacity.every((v) => v === 2)).to.be.true;
  });

  it('keeps organization capacity stable when team drill-down changes', () => {
    const calc = new CapacityCalculator(bus);
    const features = [{
      id: 'f1',
      start: '2025-01-01',
      end: '2025-01-01',
      project: 'p1',
      state: 'active',
      capacity: [
        { team: 't1', capacity: 20 },
        { team: 't2', capacity: 80 },
      ],
    }];
    const teams = [{ id: 't1' }, { id: 't2' }];
    const projects = [planConfig('p1')];
    const baseFilters = {
      selectedProjects: ['p1'],
      selectedStates: ['active'],
    };

    const allTeams = calc.calculate(features, { ...baseFilters, selectedTeams: ['t1', 't2'] }, teams, projects);
    const narrowedTeams = calc.calculate(features, { ...baseFilters, selectedTeams: ['t1'] }, teams, projects);

    expect(narrowedTeams.totalOrgDailyCapacity).to.deep.equal(allTeams.totalOrgDailyCapacity);
    expect(narrowedTeams.totalOrgDailyPerTeamAvg).to.deep.equal(allTeams.totalOrgDailyPerTeamAvg);
    expect(narrowedTeams.teamDailyCapacityMap[0]).to.deep.equal({ t1: 20, t2: 80 });
    expect(narrowedTeams.totalOrgDailyPerTeamAvg[0]).to.equal(50);
  });

  it('rolls shared-team allocations up each unique task ancestor chain', () => {
    const calc = new CapacityCalculator(bus);
    const projects = [
      planConfig('program-1', 'program'), planConfig('program-2', 'program'),
      planConfig('project-a'), planConfig('project-b'), planConfig('team-f', 'team'),
    ];
    const features = [
      { id: 'p1', project: 'program-1' }, { id: 'p2', project: 'program-2' },
      { id: 'a', project: 'project-a', parentId: 'p1' },
      { id: 'b', project: 'project-b', parentId: 'p2' },
      { id: 'f1', project: 'team-f', parentId: 'a', start: '2025-01-01', end: '2025-01-01',
        state: 'active', capacity: [{ team: 'f', capacity: 30 }] },
      { id: 'f2', project: 'team-f', parentId: 'b', start: '2025-01-01', end: '2025-01-01',
        state: 'active', capacity: [{ team: 'f', capacity: 20 }] },
    ];
    const filters = { selectedProjects: projects.map((project) => project.id),
      selectedTeams: ['f'], selectedStates: ['active'] };
    const result = calc.calculate(features, filters, [{ id: 'f' }], projects);
    expect(result.planDailyCapacityMap[0]).to.deep.equal({
      'team-f': 50, 'project-a': 30, 'program-1': 30,
      'project-b': 20, 'program-2': 20,
    });
    expect(result.planTeamDailyCapacityMap[0]['team-f']).to.deep.equal({ f: 50 });

    const changed = features.map((feature) => feature.id === 'f1' ?
      { ...feature, capacity: [{ team: 'f', capacity: 40 }] } : feature);
    const updated = calc.calculate(changed, filters, [{ id: 'f' }], projects);
    expect(updated.planDailyCapacityMap[0]['program-1']).to.equal(40);
    expect(updated.planDailyCapacityMap[0]['program-2']).to.equal(20);
    expect(updated.planDailyCapacityMap[0]['team-f']).to.equal(60);
  });

  it('keeps team-plan capacity when no project-type plan exists', () => {
    const calc = new CapacityCalculator(bus);
    const features = [{ id: 'task', project: 'team-f', start: '2025-01-01',
      end: '2025-01-01', state: 'active', capacity: [{ team: 'f', capacity: 25 }] }];
    const filters = { selectedProjects: ['team-f'], selectedTeams: ['f'],
      selectedStates: ['active'] };
    const result = calc.calculate(features, filters, [{ id: 'f' }],
      [planConfig('team-f', 'team')]);

    expect(result.planTeamDailyCapacityMap[0]['team-f']).to.deep.equal({ f: 25 });
    expect(result.planDailyCapacityMap[0]['team-f']).to.equal(25);
  });

  it('moves plan rollups to the new ancestor after a task is reparented', () => {
    const calc = new CapacityCalculator(bus);
    const projects = [planConfig('program-1', 'program'),
      planConfig('program-2', 'program'), planConfig('team-f', 'team')];
    const features = [
      { id: 'p1', project: 'program-1' },
      { id: 'p2', project: 'program-2' },
      { id: 'task', project: 'team-f', parentId: 'p1', start: '2025-01-01',
        end: '2025-01-01', state: 'active', capacity: [{ team: 'f', capacity: 25 }] },
    ];
    const filters = { selectedProjects: projects.map((project) => project.id),
      selectedTeams: ['f'], selectedStates: ['active'] };
    calc.calculate(features, filters, [{ id: 'f' }], projects);

    const moved = features.map((feature) => feature.id === 'task' ?
      { ...feature, parentId: 'p2' } : feature);
    const result = calc.calculate(moved, filters, [{ id: 'f' }], projects);

    expect(result.planDailyCapacityMap[0]['program-1']).to.equal(undefined);
    expect(result.planDailyCapacityMap[0]['program-2']).to.equal(25);
    expect(result.planDailyCapacityMap[0]['team-f']).to.equal(25);
  });

  it('recalculation reflects allocation changes', () => {
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
    const projects = [planConfig('p1')];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['t1'],
      selectedStates: ['active'],
    };

    const first = calc.calculate(features, filters, teams, projects);
    expect(first.totalOrgDailyCapacity.every((v) => v === 1)).to.be.true;

    // The next calculation uses the updated feature allocation.
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
    const updated = calc.calculate(newFeatures, filters, teams, projects);
    expect(updated.totalOrgDailyCapacity.every((v) => v === 3)).to.be.true;
  });

  it('recalculation removes deleted team allocations', () => {
    const calc = new CapacityCalculator(bus);
    const teams = [{ id: 't1' }];
    const projects = [planConfig('p1')];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['t1'],
      selectedStates: ['active'],
    };
    const allocatedFeature = {
      id: 'f1',
      start: '2025-02-01',
      end: '2025-02-02',
      project: 'p1',
      state: 'active',
      capacity: [{ team: 't1', capacity: 40 }],
    };

    const initial = calc.calculate([allocatedFeature], filters, teams, projects);
    expect(initial.teamDailyCapacityMap[0].t1).to.equal(40);

    const removed = calc.calculate(
      [{ ...allocatedFeature, capacity: [] }],
      filters,
      teams,
      projects
    );

    expect(removed.teamDailyCapacity[0][0]).to.equal(0);
    expect(removed.teamDailyCapacityMap[0]).to.deep.equal({});
    expect(removed.totalOrgDailyCapacity.every((value) => value === 0)).to.be.true;
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
      planConfig('projectA'),
      planConfig('teamB', 'team'),
    ];

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
    const projects = [planConfig('teamB', 'team')];

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
  // Span-independent, per-team descendant precedence
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
    const projects = [planConfig('p1')];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['teamA', 'teamB'],
      selectedStates: ['s'],
    };

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
    const projects = [planConfig('p1')];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['teamA', 'teamB'],
      selectedStates: ['s'],
    };

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
  // Child allocation changes must suppress parent contributions on recalculation.
  // ---------------------------------------------------------------------------

  it('adding child Team A capacity replaces the parent reservation', () => {
    // Recalculation must replace the parent contribution rather than double-count it.
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
    const projects = [planConfig('p1')];
    const filters = { selectedProjects: ['p1'], selectedTeams: ['teamA'], selectedStates: ['s'] };

    // Step 1: parent contributes Team A, child has no allocation.
    const step1 = calc.calculate([epic, childV1], filters, teams, projects);
    const teamAIdx = 0;
    expect(step1.teamDailyCapacity[0][teamAIdx]).to.equal(10, 'Step1: parent Team A = 10');

    // Step 2: the child now holds the winning Team A allocation.
    const childV2 = { ...childV1, capacity: [{ team: 'teamA', capacity: 20 }] };
    const step2 = calc.calculate([epic, childV2], filters, teams, projects);

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
    const projects = [planConfig('p1')];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['teamA'],
      selectedStates: ['s'],
    };

    const result = calc.calculate(features, filters, teams, projects);
    expect(result.dates).to.have.lengthOf(2);
    expect(result.teamDailyCapacity[0][0]).to.equal(30);
    expect(result.teamDailyCapacity[1][0]).to.equal(30);
  });

  it('keeps deselected team allocations in the organization numerator and denominator', () => {
    // Team Drill-down is presentation-only: both organization allocations count,
    // normalized across the full organization roster.
    const calc = new CapacityCalculator(bus);

    const feature = {
      id: 'f1',
      project: 'p1',
      start: '2025-09-01',
      end: '2025-09-01',
      state: 's',
      capacity: [
        { team: 'teamA', capacity: 40 },
        { team: 'teamB', capacity: 60 },
      ],
    };

    const teams = [{ id: 'teamA' }, { id: 'teamB' }];
    const projects = [planConfig('p1')];
    const filters = {
      selectedProjects: ['p1'],
      // teamB is intentionally not in Team Drill-down
      selectedTeams: ['teamA'],
      selectedStates: ['s'],
    };

    const result = calc.calculate([feature], filters, teams, projects);
    const p1Idx = 0;

    // Both allocations count: (40 + 60) / 2 teams = 50.
    expect(result.projectDailyCapacity[0][p1Idx]).to.equal(50);
    expect(result.totalOrgDailyPerTeamAvg[0]).to.equal(50);
  });

  it('repeated calculations keep full-organization normalization', () => {
    const calc = new CapacityCalculator(bus);

    const feature = {
      id: 'fDelta',
      project: 'p1',
      start: '2025-09-10',
      end: '2025-09-10',
      state: 's',
      capacity: [
        { team: 'teamA', capacity: 40 },
        { team: 'teamB', capacity: 60 },
      ],
    };

    const teams = [{ id: 'teamA' }, { id: 'teamB' }];
    const projects = [planConfig('p1')];
    const filters = {
      selectedProjects: ['p1'],
      selectedTeams: ['teamA'],
      selectedStates: ['s'],
    };

    // Calculate once before repeating with the same inputs.
    calc.calculate([feature], filters, teams, projects);

    // Repeated calculations retain the full organization denominator.
    const result = calc.calculate([feature], filters, teams, projects);

    expect(result.projectDailyCapacity[0][0]).to.equal(50);
    expect(result.totalOrgDailyPerTeamAvg[0]).to.equal(50);
  });
});
