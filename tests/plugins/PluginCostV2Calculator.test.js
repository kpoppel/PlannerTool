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
});
