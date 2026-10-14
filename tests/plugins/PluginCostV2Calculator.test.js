/**
 * Unit tests for PluginCostCalculator
 * Tests pure utility functions for cost analysis calculations
 */

import { expect } from '@open-wc/testing';
import {
  toDate,
  firstOfMonth,
  lastOfMonth,
  addMonths,
  monthKey,
  monthLabel,
  buildMonths,
  expandDataset,
  buildTaskTree,
  allocateToMonths,
  flattenTree,
  buildByTeam,
  computeEffectiveDataMaps,
  buildCostTaskRows as buildCostTaskRowsSource,
} from '../../www/js/plugins/PluginCostCalculator.js';

function buildCostTaskRows(features, children, months, range = {
  start: `${months[0]}-01`,
  end: lastOfMonth(toDate(`${months[months.length - 1]}-01`)).toISOString().slice(0, 10),
}) {
  return buildCostTaskRowsSource(features, children, months, range);
}

describe('PluginCostCalculator', () => {
  it('hides filter-excluded allocating rows without changing financial rollups', () => {
    const base = { start: '2026-01-01', end: '2026-01-31', estimateTeams: {} };
    const features = [
      { ...base, id: 'root', displayMode: 'normal', capacity: [], metrics: { teams: {} } },
      { ...base, id: 'excluded', displayMode: 'excluded', capacity: [{ team: 'A', capacity: 20 }],
        metrics: { teams: { A: {
          cost: { internal: { '2026-01': 50 }, external: {} },
          hours: { internal: { '2026-01': 5 }, external: {} },
        } } } },
      { ...base, id: 'hidden-type', displayMode: 'context', capacity: [{ team: 'A', capacity: 20 }],
        metrics: { teams: {} } },
    ];
    const rows = buildCostTaskRows(features, new Map([['root', ['excluded', 'hidden-type']]]),
      ['2026-01']);
    expect(rows.map((row) => row.feature.id)).to.deep.equal(['root', 'hidden-type']);
    expect(rows[0].totalCost).to.equal(50);
    expect(rows[0].totalHours).to.equal(5);
  });
  it('leaves lifecycle pruning to the complete graph producer rather than a projected report', () => {
    const base = { start: '2026-01-01', end: '2026-01-31', capacity: [],
      displayMode: 'normal', metrics: { teams: {} }, estimateTeams: {}, stateCategory: 'Completed' };
    const features = [
      { ...base, id: 'active-root', stateCategory: 'InProgress' },
      { ...base, id: 'closed-empty' }, { ...base, id: 'closed-grandchild' },
      { ...base, id: 'active-empty', state: 'Closed', stateCategory: 'InProgress' },
      { ...base, id: 'closed-parent' },
      { ...base, id: 'closed-allocated', capacity: [{ team: 'unknown', capacity: 20 }] },
      { ...base, id: 'closed-above-active' },
      { ...base, id: 'active-descendant', stateCategory: 'InProgress' },
    ];
    const original = structuredClone(features);
    const children = new Map([
      ['active-root', ['closed-empty', 'active-empty', 'closed-parent', 'closed-above-active']],
      ['closed-empty', ['closed-grandchild']], ['closed-parent', ['closed-allocated']],
      ['closed-above-active', ['active-descendant']],
    ]);
    expect(buildCostTaskRows(features, children, ['2026-01']).map((row) => row.feature.id))
      .to.deep.equal(['active-root', 'closed-empty', 'closed-grandchild',
        'active-empty', 'closed-parent', 'closed-allocated',
        'closed-above-active', 'active-descendant']);
    expect(features).to.deep.equal(original);
  });
  it('limits normal and context rows to exact inclusive report dates', () => {
    const base = { capacity: [], displayMode: 'normal', metrics: { teams: {} }, estimateTeams: {} };
    const features = [
      { ...base, id: 'old', start: '2025-08-20', end: '2025-11-11' },
      { ...base, id: 'early', start: '2026-01-01', end: '2026-01-09' },
      { ...base, id: 'boundary', start: '2026-01-10', end: '2026-01-10' },
      { ...base, id: 'overlap', start: '2026-01-05', end: '2026-01-25' },
      { ...base, id: 'late', start: '2026-01-21', end: '2026-01-31' },
      { ...base, id: 'undated' },
      { ...base, id: 'context', displayMode: 'context', start: '2026-01-01', end: '2026-01-09',
        capacity: [{ team: 'A', capacity: 20 }] },
    ];
    expect(buildCostTaskRows(features, new Map(), ['2026-01'],
      { start: '2026-01-10', end: '2026-01-20' }).map((row) => row.feature.id))
      .to.deep.equal(['boundary', 'overlap', 'undated']);
    const children = new Map([['old', ['boundary']]]);
    expect(buildCostTaskRows(features, children, ['2026-01'],
      { start: '2026-01-10', end: '2026-01-20' })[0].depth).to.equal(0);
  });
  it('keeps unpriced dated allocations as context without treating them as zero estimates', () => {
    const feature = { id: 'unknown', start: '2026-01-01', end: '2026-01-31',
      capacity: [{ team: 'unknown-team', capacity: 20 }], displayMode: 'context',
      metrics: { teams: {} }, estimateTeams: {} };
    const rows = buildCostTaskRows([feature], new Map(), ['2026-01']);
    expect(rows).to.have.lengthOf(1);
    expect(rows[0].hasOwnAllocation).to.equal(true);
    expect(rows[0].hasOwnEstimate).to.equal(false);
    expect(buildCostTaskRows([{ ...feature, start: null, end: null }],
      new Map(), ['2026-01'])).to.have.lengthOf(0);
  });

  it('compares each team independently and retains only useful hidden context rows', () => {
    const team = (cost, hours) => ({
      cost: { internal: { '2026-01': cost }, external: {} },
      hours: { internal: { '2026-01': hours }, external: {} },
    });
    const features = [
      { id: 'root', displayMode: 'normal', metrics: { teams: {} },
        estimateTeams: { A: team(1000, 100), B: team(1000, 100) } },
      { id: 'bridge', displayMode: 'context', metrics: { teams: {} }, estimateTeams: {} },
      { id: 'leaf', displayMode: 'context', metrics: { teams: { A: team(400, 40), B: team(1600, 160) } },
        estimateTeams: { A: team(400, 40), B: team(1600, 160) } },
      { id: 'empty', displayMode: 'normal', metrics: { teams: {} }, estimateTeams: {} },
      { id: 'noise', displayMode: 'context', metrics: { teams: {} }, estimateTeams: {} },
    ].map((feature) => ({ ...feature, start: '2026-01-01', end: '2026-01-31',
      capacity: Object.keys(feature.estimateTeams).map((team) => ({ team, capacity: 100 })) }));
    const children = new Map([['root', ['bridge', 'empty', 'noise']], ['bridge', ['leaf']]]);
    const rows = buildCostTaskRows(features, children, ['2026-01']);
    expect(rows.map((row) => row.feature.id)).to.deep.equal(['root', 'leaf', 'empty']);
    expect(rows[1].depth).to.equal(1);
    expect(rows[0].totalCost).to.equal(2000);
    expect(rows[0].comparisons.map((comparison) => comparison.percent)).to.deep.equal([-60, 60]);
    expect(rows[2].hasOwnEstimate).to.equal(false);
    const equalFeatures = features.map((feature) => feature.id === 'leaf'
      ? { ...feature, metrics: { teams: { A: team(1000, 100), B: team(1000, 100) } } } : feature);
    expect(buildCostTaskRows(equalFeatures, children, ['2026-01'])[0]
      .comparisons.every((comparison) => comparison.percent === 0)).to.equal(true);
    const zeroRate = features.map((feature) => ({ ...feature,
      estimateTeams: Object.fromEntries(Object.entries(feature.estimateTeams)
        .map(([name, metrics]) => [name, { ...metrics, cost: { internal: {}, external: {} } }])),
      metrics: { teams: Object.fromEntries(Object.entries(feature.metrics.teams)
        .map(([name, metrics]) => [name, { ...metrics, cost: { internal: {}, external: {} } }])) },
    }));
    const freeRows = buildCostTaskRows(zeroRate, children, ['2026-01']);
    expect(freeRows.map((row) => row.feature.id)).to.deep.equal(['root', 'leaf', 'empty']);
    expect(freeRows[0].comparisons[0].percent).to.equal(-60);
  });
  describe('date and month helpers', () => {
    it('parses date-only values at UTC midnight and preserves Date inputs', () => {
      const date = toDate('2026-12-15');
      expect(date.toISOString()).to.equal('2026-12-15T00:00:00.000Z');
      expect(toDate(date)).to.equal(date);
      expect(toDate(null)).to.equal(null);
    });

    it('computes UTC month boundaries including leap years and year rollover', () => {
      const date = toDate('2024-02-15');
      expect(firstOfMonth(date).toISOString()).to.equal('2024-02-01T00:00:00.000Z');
      expect(lastOfMonth(date).toISOString()).to.equal('2024-02-29T00:00:00.000Z');
      expect(addMonths(toDate('2026-12-15'), 1).toISOString())
        .to.equal('2027-01-01T00:00:00.000Z');
      expect(monthKey(date)).to.equal('2024-02');
      expect(monthLabel(date)).to.be.a('string').and.to.not.equal('');
      expect(firstOfMonth(null)).to.equal(null);
      expect(lastOfMonth(null)).to.equal(null);
    });

    it('builds inclusive UTC month ranges across years', () => {
      const months = buildMonths({ dataset_start: '2026-12-15', dataset_end: '2027-02-03' });
      expect(months.map(monthKey)).to.deep.equal(['2026-12', '2027-01', '2027-02']);
      expect(months.map((month) => month.toISOString())).to.deep.equal([
        '2026-12-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2027-02-01T00:00:00.000Z',
      ]);
    });

    it('returns no months for missing or reversed dataset bounds', () => {
      expect(buildMonths({ dataset_start: null, dataset_end: '2026-01-31' }))
        .to.deep.equal([]);
      expect(buildMonths({ dataset_start: '2026-01-01', dataset_end: null }))
        .to.deep.equal([]);
      expect(buildMonths({ dataset_start: '2026-02-01', dataset_end: '2026-01-31' }))
        .to.deep.equal([]);
    });
  });

  describe('expandDataset', () => {
    it('should include initial features', () => {
      const features = [{ id: '1', title: 'Feature 1' }];
      const childrenByParent = new Map();
      const allFeatures = features;

      const result = expandDataset(features, childrenByParent, allFeatures);

      expect(result).to.have.length(1);
      expect(result[0].id).to.equal('1');
    });

    it('should recursively include children', () => {
      const features = [{ id: '1', title: 'Parent' }];
      const childrenByParent = new Map([
        [1, ['2']],
        [2, ['3']],
      ]);
      const allFeatures = [
        { id: '1', title: 'Parent' },
        { id: '2', title: 'Child' },
        { id: '3', title: 'Grandchild' },
      ];

      const result = expandDataset(features, childrenByParent, allFeatures);

      expect(result).to.have.length(3);
      expect(result.map((f) => f.id)).to.include.members(['1', '2', '3']);
    });

    it('should prevent duplicates', () => {
      const features = [
        { id: '1', title: 'Feature 1' },
        { id: '1', title: 'Feature 1' },
      ];
      const childrenByParent = new Map();
      const allFeatures = features;

      const result = expandDataset(features, childrenByParent, allFeatures);

      expect(result).to.have.length(1);
    });

    it('should throw if features is not an array', () => {
      expect(() => expandDataset(null, new Map(), [])).to.throw(
        'features must be an array'
      );
    });

    it('should throw if childrenByParent is not a Map', () => {
      expect(() => expandDataset([], {}, [])).to.throw('childrenByParent must be a Map');
    });
  });

  describe('buildTaskTree', () => {
    it('should identify orphan features', () => {
      const features = [{ id: '1', title: 'Orphan' }];
      const childrenByParent = new Map();

      const result = buildTaskTree(features, childrenByParent);

      expect(result.roots).to.include('1');
      expect(result.childrenMap.size).to.equal(0);
      expect(result.parentMap.size).to.equal(0);
    });

    it('should build parent-child relationships', () => {
      const features = [
        { id: '1', title: 'Parent' },
        { id: '2', title: 'Child' },
      ];
      const childrenByParent = new Map([[1, ['2']]]);

      const result = buildTaskTree(features, childrenByParent);

      expect(result.roots).to.include('1');
      expect(result.roots).to.not.include('2');
      expect(result.childrenMap.get('1')).to.include('2');
      expect(result.parentMap.get('2')).to.equal('1');
    });

    it('should handle multiple orphans', () => {
      const features = [
        { id: '1', title: 'Orphan 1' },
        { id: '2', title: 'Orphan 2' },
      ];
      const childrenByParent = new Map();

      const result = buildTaskTree(features, childrenByParent);

      expect(result.roots).to.have.length(2);
      expect(result.roots).to.include.members(['1', '2']);
    });
  });

  describe('allocateToMonths', () => {
    it('should allocate to single month', () => {
      const feature = {
        start: '2026-01-01',
        end: '2026-01-31',
        metrics: {
          internal: { cost: 1000, hours: 100 },
          external: { cost: 500, hours: 50 },
        },
      };
      const months = [new Date('2026-01-01T00:00:00Z')];

      const result = allocateToMonths(feature, months);

      expect(result.cost.internal.get('2026-01')).to.equal(1000);
      expect(result.cost.external.get('2026-01')).to.equal(500);
      expect(result.hours.internal.get('2026-01')).to.equal(100);
      expect(result.hours.external.get('2026-01')).to.equal(50);
    });

    it('should split across multiple months', () => {
      const feature = {
        start: '2026-01-15',
        end: '2026-02-15',
        metrics: {
          internal: { cost: 3100, hours: 310 },
          external: { cost: 0, hours: 0 },
        },
      };
      const months = [new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z')];

      const result = allocateToMonths(feature, months);

      // 32 days total: 17 in Jan, 15 in Feb
      const janCost = result.cost.internal.get('2026-01');
      const febCost = result.cost.internal.get('2026-02');

      expect(janCost + febCost).to.be.closeTo(3100, 0.1);
      expect(janCost).to.be.greaterThan(febCost); // More days in Jan
    });

    it('should return empty maps for features without dates', () => {
      const feature = {
        start: null,
        end: null,
        metrics: {
          internal: { cost: 1000, hours: 100 },
          external: { cost: 0, hours: 0 },
        },
      };
      const months = [new Date('2026-01-01T00:00:00Z')];

      const result = allocateToMonths(feature, months);

      expect(result.cost.internal.size).to.equal(0);
      expect(result.cost.external.size).to.equal(0);
    });
  });

  describe('flattenTree', () => {
    it('should return features in DFS pre-order with depths', () => {
      const childrenMap = new Map([['1', ['2', '3']], ['2', ['4']]]);
      const featureMap = new Map([
        ['1', { id: '1', title: 'Root' }],
        ['2', { id: '2', title: 'Child A' }],
        ['3', { id: '3', title: 'Child B' }],
        ['4', { id: '4', title: 'Grandchild' }],
      ]);

      const result = flattenTree(['1'], childrenMap, featureMap, 0, []);

      expect(result.map((r) => r.feature.id)).to.deep.equal(['1', '2', '4', '3']);
      expect(result[0].depth).to.equal(0);
      expect(result[1].depth).to.equal(1);
      expect(result[2].depth).to.equal(2);
      expect(result[3].depth).to.equal(1);
    });

    it('should skip unknown feature ids', () => {
      const result = flattenTree(['99'], new Map(), new Map(), 0, []);
      expect(result).to.have.length(0);
    });

    it('should handle multiple root ids', () => {
      const featureMap = new Map([
        ['1', { id: '1', title: 'A' }],
        ['2', { id: '2', title: 'B' }],
      ]);
      const result = flattenTree(['1', '2'], new Map(), featureMap, 0, []);
      expect(result).to.have.length(2);
      expect(result[0].feature.id).to.equal('1');
      expect(result[1].feature.id).to.equal('2');
    });
  });

  describe('buildByTeam', () => {
    const monthKeys = ['2026-01', '2026-02'];

    it('rolls up deep trees without recursion and rejects cycles', () => {
      const features = Array.from({ length: 5000 }, (_, index) => ({
        id: String(index), metrics: { teams: {} },
      }));
      features[4999].metrics.teams.A = {
        cost: { internal: { '2026-01': 100 }, external: {} },
        hours: { internal: { '2026-01': 10 }, external: {} },
      };
      const children = new Map(features.slice(0, -1).map((feature, index) =>
        [feature.id, [String(index + 1)]]));
      expect(buildByTeam(features, children, monthKeys).get('0').get('A')
        .hours.internal.get('2026-01')).to.equal(10);
      children.set('4999', ['0']);
      expect(() => buildByTeam(features, children, monthKeys))
        .to.throw('Cost hierarchy contains a cycle');
    });

    it('should return leaf own allocation for a leaf with no children', () => {
      const features = [
        {
          id: '1',
          metrics: {
            teams: {
              'team-a': {
                cost: { internal: { '2026-01': 100, '2026-02': 200 }, external: {} },
                hours: { internal: { '2026-01': 10, '2026-02': 20 }, external: {} },
              },
            },
          },
        },
      ];
      const childrenMap = new Map();
      const result = buildByTeam(features, childrenMap, monthKeys);

      const teamA = result.get('1')?.get('team-a');
      expect(teamA).to.exist;
      expect(teamA.cost.internal.get('2026-01')).to.equal(100);
      expect(teamA.cost.internal.get('2026-02')).to.equal(200);
      expect(teamA.hours.internal.get('2026-01')).to.equal(10);
    });

    it('should restrict to display window monthKeys only', () => {
      const features = [
        {
          id: '1',
          metrics: {
            teams: {
              'team-a': {
                cost: { internal: { '2025-12': 999, '2026-01': 100 }, external: {} },
                hours: { internal: { '2025-12': 99, '2026-01': 10 }, external: {} },
              },
            },
          },
        },
      ];
      const result = buildByTeam(features, new Map(), ['2026-01']);
      const teamA = result.get('1')?.get('team-a');
      expect(teamA.cost.internal.has('2025-12')).to.be.false;
      expect(teamA.cost.internal.get('2026-01')).to.equal(100);
    });

    it('rolls up resolved metrics additively without applying precedence again', () => {
      const features = [
        {
          id: 'parent',
          metrics: {
            teams: {
              'team-a': {
                cost: { internal: { '2026-01': 500 }, external: {} },
                hours: { internal: { '2026-01': 50 }, external: {} },
              },
            },
          },
        },
        {
          id: 'child1',
          metrics: {
            teams: {
              'team-a': {
                cost: { internal: { '2026-01': 60 }, external: {} },
                hours: { internal: { '2026-01': 6 }, external: {} },
              },
            },
          },
        },
        {
          id: 'child2',
          metrics: {
            teams: {
              'team-a': {
                cost: { internal: { '2026-01': 40 }, external: {} },
                hours: { internal: { '2026-01': 4 }, external: {} },
              },
            },
          },
        },
      ];
      const childrenMap = new Map([['parent', ['child1', 'child2']]]);
      const result = buildByTeam(features, childrenMap, ['2026-01']);

      const parentAlloc = result.get('parent')?.get('team-a');
      expect(parentAlloc.cost.internal.get('2026-01')).to.equal(600);
    });

    it('sums every same-team child when the parent has no winning reservation', () => {
      const team = (value) => ({ cost: { internal: { '2026-01': value }, external: {} },
        hours: { internal: { '2026-01': value / 10 }, external: {} } });
      const features = [
        { id: 'parent', metrics: { teams: {} } },
        { id: 'child1', metrics: { teams: { A: team(60) } } },
        { id: 'child2', metrics: { teams: { A: team(40) } } },
      ];
      const original = structuredClone(features);
      const result = buildByTeam(features, new Map([['parent', ['child1', 'child2']]]), ['2026-01']);
      expect(result.get('parent').get('A').cost.internal.get('2026-01')).to.equal(100);
      expect(result.get('parent').get('A').hours.internal.get('2026-01')).to.equal(10);
      expect(features).to.deep.equal(original);
    });

    it('parent keeps own allocation when children do NOT cover that team', () => {
      const features = [
        {
          id: 'parent',
          metrics: {
            teams: {
              'team-a': {
                cost: { internal: { '2026-01': 500 }, external: {} },
                hours: { internal: {}, external: {} },
              },
            },
          },
        },
        {
          id: 'child1',
          metrics: {
            teams: {
              'team-b': {
                cost: { internal: { '2026-01': 60 }, external: {} },
                hours: { internal: {}, external: {} },
              },
            },
          },
        },
      ];
      const childrenMap = new Map([['parent', ['child1']]]);
      const result = buildByTeam(features, childrenMap, ['2026-01']);

      const parentAllocA = result.get('parent')?.get('team-a');
      // team-a not covered by child → parent keeps own
      expect(parentAllocA.cost.internal.get('2026-01')).to.equal(500);
    });
  });

  describe('computeEffectiveDataMaps', () => {
    it('should aggregate all teams into one combined map per feature', () => {
      const features = [
        {
          id: '1',
          metrics: {
            teams: {
              'team-a': {
                cost: { internal: { '2026-01': 100 }, external: { '2026-01': 50 } },
                hours: { internal: { '2026-01': 10 }, external: { '2026-01': 5 } },
              },
              'team-b': {
                cost: { internal: { '2026-01': 200 }, external: {} },
                hours: { internal: { '2026-01': 20 }, external: {} },
              },
            },
          },
        },
      ];
      const result = computeEffectiveDataMaps(features, new Map(), ['2026-01']);

      const dataMap = result.get('1');
      expect(dataMap).to.exist;
      // team-a internal + team-b internal = 300
      expect(dataMap.cost.internal.get('2026-01')).to.equal(300);
      // only team-a external = 50
      expect(dataMap.cost.external.get('2026-01')).to.equal(50);
      expect(dataMap.hours.internal.get('2026-01')).to.equal(30);
    });
  });
});
