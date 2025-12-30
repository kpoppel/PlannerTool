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
});
