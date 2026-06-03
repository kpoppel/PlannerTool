import { describe, it, expect } from 'vitest';
import { computeGrid, ensureArray, fieldValues } from '../../www/js/plugins/xyBoardUtils.js';

describe('ensureArray', () => {
  it('wraps a scalar in an array', () => {
    expect(ensureArray('foo')).toEqual(['foo']);
  });

  it('returns array as-is', () => {
    expect(ensureArray(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('returns [] for null', () => {
    expect(ensureArray(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(ensureArray(undefined)).toEqual([]);
  });
});

describe('fieldValues', () => {
  it('returns string values for a scalar field', () => {
    expect(fieldValues({ state: 'New' }, 'state')).toEqual(['New']);
  });

  it('returns array values for a multi-value field', () => {
    expect(fieldValues({ productType: ['Charger', 'Battery'] }, 'productType')).toEqual([
      'Charger',
      'Battery',
    ]);
  });

  it('returns [Unassigned] for missing field', () => {
    expect(fieldValues({}, 'state')).toEqual(['Unassigned']);
  });

  it('returns [Unassigned] for null field', () => {
    expect(fieldValues({ iterationPath: null }, 'iterationPath')).toEqual(['Unassigned']);
  });

  it('returns [Unassigned] for empty array field', () => {
    expect(fieldValues({ productType: [] }, 'productType')).toEqual(['Unassigned']);
  });
});

describe('computeGrid', () => {
  const features = [
    { id: '1', title: 'A', type: 'Feature', state: 'New' },
    { id: '2', title: 'B', type: 'Feature', state: 'Done' },
    { id: '3', title: 'C', type: 'Bug', state: 'New' },
  ];

  it('produces correct xVals and yVals', () => {
    const { xVals, yVals } = computeGrid(features, 'state', 'type');
    expect(xVals).toEqual(['Done', 'New']);
    expect(yVals).toEqual(['Bug', 'Feature']);
  });

  it('places features in correct cells', () => {
    const { grid } = computeGrid(features, 'state', 'type');
    expect(grid.get('Feature').get('New').map((f) => f.id)).toEqual(['1']);
    expect(grid.get('Feature').get('Done').map((f) => f.id)).toEqual(['2']);
    expect(grid.get('Bug').get('New').map((f) => f.id)).toEqual(['3']);
    expect(grid.get('Bug').get('Done')).toEqual([]);
  });

  it('duplicates cards for multi-value fields', () => {
    const f = [{ id: '10', title: 'Multi', productType: ['Charger', 'Battery'], state: 'New' }];
    const { grid, xVals } = computeGrid(f, 'productType', 'state');
    expect(xVals).toEqual(['Battery', 'Charger']);
    expect(grid.get('New').get('Battery').map((x) => x.id)).toEqual(['10']);
    expect(grid.get('New').get('Charger').map((x) => x.id)).toEqual(['10']);
  });

  it('places missing field values in Unassigned cell', () => {
    const f = [{ id: '20', title: 'No iter' }];
    const { xVals, yVals, grid } = computeGrid(f, 'iterationPath', 'type');
    expect(xVals).toEqual(['Unassigned']);
    expect(yVals).toEqual(['Unassigned']);
    expect(grid.get('Unassigned').get('Unassigned').map((x) => x.id)).toEqual(['20']);
  });

  it('sorts Unassigned to end of each axis', () => {
    const f = [
      { id: '30', state: 'New', type: 'Feature' },
      { id: '31', state: null, type: 'Bug' },
    ];
    const { xVals } = computeGrid(f, 'state', 'type');
    expect(xVals[xVals.length - 1]).toBe('Unassigned');
  });

  it('returns empty grid for empty feature list', () => {
    const { xVals, yVals, grid } = computeGrid([], 'state', 'type');
    expect(xVals).toEqual([]);
    expect(yVals).toEqual([]);
    expect(grid.size).toBe(0);
  });
});
