/**
 * Unit tests for PluginCostV2Calculator
 * Tests pure utility functions for cost analysis calculations
 */

import { expect } from '@open-wc/testing';
import {
  expandDataset,
  buildTaskTree,
  calculateBudgetDeviation,
  hasSignificantDeviation,
  allocateToMonths,
  flattenTree,
  buildByTeam,
  computeEffectiveDataMaps,
} from '../../www/js/plugins/PluginCostV2Calculator.js';

describe('PluginCostV2Calculator', () => {
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

  describe('calculateBudgetDeviation', () => {
    it('should calculate deviation correctly', () => {
      const parent = {
        metrics: {
          internal: { cost: 1000, hours: 100 },
          external: { cost: 500, hours: 50 },
        },
      };
      const children = [
        {
          metrics: {
            internal: { cost: 600, hours: 60 },
            external: { cost: 300, hours: 30 },
          },
        },
      ];

      const result = calculateBudgetDeviation(parent, children);

      // Parent has 1500 total cost, children sum is 900 = +66.67% deviation
      expect(result.deviation.totalCost).to.be.closeTo(66.67, 0.1);
      expect(result.parentOwn.totalCost).to.equal(1500);
      expect(result.childrenSum.totalCost).to.equal(900);
    });

    it('should handle zero children sum', () => {
      const parent = {
        metrics: {
          internal: { cost: 1000, hours: 100 },
          external: { cost: 0, hours: 0 },
        },
      };
      const children = [];

      const result = calculateBudgetDeviation(parent, children);

      expect(result.deviation.totalCost).to.equal(100); // 100% deviation
      expect(result.childrenSum.totalCost).to.equal(0);
    });

    it('should throw if parent is invalid', () => {
      expect(() => calculateBudgetDeviation(null, [])).to.throw(
        'parent must be an object'
      );
    });
  });

  describe('hasSignificantDeviation', () => {
    it('should detect deviation above threshold', () => {
      const deviation = {
        totalCost: 15,
        totalHours: 5,
        internalCost: 10,
        internalHours: 0,
        externalCost: 0,
        externalHours: 0,
      };

      expect(hasSignificantDeviation(deviation, 10)).to.be.true;
    });

    it('should not detect deviation below threshold', () => {
      const deviation = {
        totalCost: 5,
        totalHours: 3,
        internalCost: 2,
        internalHours: 0,
        externalCost: 0,
        externalHours: 0,
      };

      expect(hasSignificantDeviation(deviation, 10)).to.be.false;
    });

    it('should handle negative deviations', () => {
      const deviation = {
        totalCost: -15,
        totalHours: 0,
        internalCost: 0,
        internalHours: 0,
        externalCost: 0,
        externalHours: 0,
      };

      expect(hasSignificantDeviation(deviation, 10)).to.be.true;
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

    it('parent uses children sum when children cover the same team', () => {
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
      // Parent should use children's sum (60 + 40 = 100), not its own 500
      expect(parentAlloc.cost.internal.get('2026-01')).to.equal(100);
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
