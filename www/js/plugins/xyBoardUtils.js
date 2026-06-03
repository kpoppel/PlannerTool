/**
 * xyBoardUtils.js
 * Pure utility functions for the XY Board plugin.
 * No DOM or service dependencies — safe to import in unit tests.
 */

/**
 * Coerce a field value to an array. Returns [] for null/undefined.
 * @param {*} v
 * @returns {any[]}
 */
export function ensureArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Return the display values for a field on a feature.
 * A missing or empty array field resolves to ['Unassigned'].
 * @param {Object} feature
 * @param {string} field
 * @returns {string[]}
 */
export function fieldValues(feature, field) {
  const vals = ensureArray(feature[field]).filter((v) => v != null && v !== '');
  return vals.length ? vals.map(String) : ['Unassigned'];
}

/**
 * Compute the XY grid from a feature list.
 *
 * Multi-value support: a feature with `productType: ["A","B"]` appears in
 * every cell whose column matches A or B. Same logic applies to the Y field.
 *
 * 'Unassigned' is always sorted to the end of each axis.
 *
 * @param {Object[]} features - array of feature objects
 * @param {string} xField - field name for X axis (columns)
 * @param {string} yField - field name for Y axis (rows)
 * @returns {{ xVals: string[], yVals: string[], grid: Map<string, Map<string, Object[]>> }}
 */
export function computeGrid(features, xField, yField) {
  const xSet = new Set();
  const ySet = new Set();

  // Collect all axis domain values
  for (const f of features) {
    for (const v of fieldValues(f, xField)) xSet.add(v);
    for (const v of fieldValues(f, yField)) ySet.add(v);
  }

  const sortAxis = (set) => {
    const arr = Array.from(set);
    arr.sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
    return arr;
  };

  const xVals = sortAxis(xSet);
  const yVals = sortAxis(ySet);

  // Build grid: grid.get(y).get(x) = feature[]
  /** @type {Map<string, Map<string, Object[]>>} */
  const grid = new Map();
  for (const y of yVals) {
    const row = new Map();
    for (const x of xVals) row.set(x, []);
    grid.set(y, row);
  }

  for (const f of features) {
    const xs = fieldValues(f, xField);
    const ys = fieldValues(f, yField);
    for (const y of ys) {
      for (const x of xs) {
        grid.get(y)?.get(x)?.push(f);
      }
    }
  }

  return { xVals, yVals, grid };
}
