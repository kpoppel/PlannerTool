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
    expect(empty).to.have.keys(['dates','teamDailyCapacity','teamDailyCapacityMap','projectDailyCapacityRaw','projectDailyCapacity','projectDailyCapacityMap','totalOrgDailyCapacity','totalOrgDailyPerTeamAvg']);
    expect(empty.dates).to.be.an('array').that.is.empty;
  });

  it('_generateDateRange handles missing dates and returns correct iso list', () => {
    const calc = new CapacityCalculator(bus);
    const features = [
      { id: 'a', start: '2025-01-02', end: '2025-01-04' },
      { id: 'b', start: null, end: null },
      { id: 'c' }
    ];
    const dates = calc._generateDateRange(features);
    expect(dates).to.have.lengthOf(3);
    expect(dates[0]).to.equal('2025-01-02');
    expect(dates[2]).to.equal('2025-01-04');
  });

  it('generate date range and simple calculation', () => {
    const calc = new CapacityCalculator(bus);
    const features = [{ id: 'f1', start: '2025-01-01', end: '2025-01-03', project: 'p1', status: 'active', capacity: [{ team: 't1', capacity: 2 }] }];
    const teams = [{ id: 't1' }];
    const projects = [{ id: 'p1' }];
    const filters = { selectedProjects: ['p1'], selectedTeams: ['t1'], selectedStates: ['active'] };

    const res = calc.calculate(features, filters, teams, projects);
    expect(res.dates).to.have.lengthOf(3);
    expect(res.teamDailyCapacity).to.be.an('array');
    expect(res.totalOrgDaily).to.be.an('array');
    // each day should have total org capacity 2
    expect(res.totalOrgDaily.every(v => v === 2)).to.be.true;
  });

  it('incremental delta updates adjust cached result', () => {
    const calc = new CapacityCalculator(bus);
    const features = [{ id: 'f1', start: '2025-02-01', end: '2025-02-02', project: 'p1', status: 'active', capacity: [{ team: 't1', capacity: 1 }] }];
    const teams = [{ id: 't1' }];
    const projects = [{ id: 'p1' }];
    const filters = { selectedProjects: ['p1'], selectedTeams: ['t1'], selectedStates: ['active'] };

    const first = calc.calculate(features, filters, teams, projects);
    expect(first.totalOrgDaily.every(v => v === 1)).to.be.true;

    // Modify feature capacity and call calculate with changedFeatureIds to trigger deltas
    const newFeatures = [{ id: 'f1', start: '2025-02-01', end: '2025-02-02', project: 'p1', status: 'active', capacity: [{ team: 't1', capacity: 3 }] }];
    const updated = calc.calculate(newFeatures, filters, teams, projects, ['f1']);
    expect(updated.totalOrgDaily.every(v => v === 3)).to.be.true;
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
      status: 'active',
      capacity: [] // Epic itself has no direct capacity
    };
    
    const child1 = {
      id: 'f1',
      type: 'feature',
      parentEpic: 'e1',
      project: 'teamB', // Feature belongs to team, not project
      start: '2025-03-01',
      end: '2025-03-03',
      status: 'active',
      capacity: [{ team: 't1', capacity: 2 }]
    };
    
    const child2 = {
      id: 'f2',
      type: 'feature',
      parentEpic: 'e1',
      project: 'teamB', // Feature belongs to team, not project
      start: '2025-03-03',
      end: '2025-03-05',
      status: 'active',
      capacity: [{ team: 't1', capacity: 3 }]
    };
    
    const features = [epic, child1, child2];
    const teams = [{ id: 't1' }];
    const projects = [
      { id: 'projectA', type: 'project' }, 
      { id: 'teamB', type: 'team' }
    ];
    
    // Set up children map
    const childrenByEpic = new Map();
    childrenByEpic.set('e1', ['f1', 'f2']);
    calc.setChildrenByEpic(childrenByEpic);
    
    const filters = { 
      selectedProjects: ['projectA', 'teamB'], 
      selectedTeams: ['t1'], 
      selectedStates: ['active'] 
    };
    
    const result = calc.calculate(features, filters, teams, projects);
    
    // Verify dates
    expect(result.dates).to.have.lengthOf(5);
    expect(result.dates[0]).to.equal('2025-03-01');
    expect(result.dates[4]).to.equal('2025-03-05');
    
    // Get project indices - note: unfunded project is added so indices shift
    const projectAIdx = projects.findIndex(p => p.id === 'projectA');
    const teamBIdx = projects.findIndex(p => p.id === 'teamB');
    
    // CRITICAL TEST: Children capacity should roll up to Project A (epic's project)
    // Day 0 (2025-03-01): child1 = 2
    expect(result.projectDailyCapacity[0][projectAIdx]).to.equal(2, 'Day 0: child1 capacity should roll up to projectA');
    expect(result.projectDailyCapacity[0][teamBIdx]).to.equal(0, 'Day 0: teamB should have 0 (capacity rolled up to parent)');
    
    // Day 1 (2025-03-02): child1 = 2
    expect(result.projectDailyCapacity[1][projectAIdx]).to.equal(2, 'Day 1: child1 capacity should roll up to projectA');
    
    // Day 2 (2025-03-03): child1 = 2, child2 = 3
    expect(result.projectDailyCapacity[2][projectAIdx]).to.equal(5, 'Day 2: both children should roll up to projectA');
    
    // Day 3 (2025-03-04): child2 = 3
    expect(result.projectDailyCapacity[3][projectAIdx]).to.equal(3, 'Day 3: child2 capacity should roll up to projectA');
    
    // Day 4 (2025-03-05): child2 = 3
    expect(result.projectDailyCapacity[4][projectAIdx]).to.equal(3, 'Day 4: child2 capacity should roll up to projectA');
    
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
      status: 'active',
      capacity: []
    };
    
    const orphanChild = {
      id: 'f3',
      type: 'feature',
      parentEpic: 'e2',
      project: 'teamB',
      start: '2025-04-01',
      end: '2025-04-02',
      status: 'active',
      capacity: [{ team: 't1', capacity: 5 }]
    };
    
    const orphanFeature = {
      id: 'f4',
      type: 'feature',
      project: 'teamB', // No parent, in team project
      start: '2025-04-02',
      end: '2025-04-03',
      status: 'active',
      capacity: [{ team: 't1', capacity: 3 }]
    };
    
    const features = [orphanEpic, orphanChild, orphanFeature];
    const teams = [{ id: 't1' }];
    const projects = [{ id: 'teamB', type: 'team' }];
    
    const childrenByEpic = new Map();
    childrenByEpic.set('e2', ['f3']);
    calc.setChildrenByEpic(childrenByEpic);
    
    const filters = {
      selectedProjects: ['teamB'],
      selectedTeams: ['t1'],
      selectedStates: ['active']
    };
    
    const result = calc.calculate(features, filters, teams, projects);
    
    // Verify dates
    expect(result.dates).to.have.lengthOf(3);
    
    // Check that unfunded project has the allocations
    expect(result.projectDailyCapacityMap[0]['__unfunded__']).to.equal(5, 'Day 0: orphan child should go to unfunded');
    expect(result.projectDailyCapacityMap[1]['__unfunded__']).to.equal(8, 'Day 1: both orphans should go to unfunded (5+3)');
    expect(result.projectDailyCapacityMap[2]['__unfunded__']).to.equal(3, 'Day 2: orphan feature should go to unfunded');
    
    // Verify teamB has no capacity (all went to unfunded)
    expect(result.projectDailyCapacityMap[0]['teamB']).to.be.undefined;
  });
});
