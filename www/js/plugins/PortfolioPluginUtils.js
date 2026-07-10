/**
 * Common utility functions used across Portfolio plugin components
 */

/**
 * Normalize a state value to lowercase string
 * @param {*} value
 * @returns {string}
 */
export function normalizeState(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Get the feature type/work item type
 * @param {object} feature
 * @returns {string}
 */
export function getFeatureType(feature) {
  return String(feature?.type || feature?.workItemType || feature?.work_item_type || 'Unknown');
}

/**
 * Format a title string
 * @param {string} value
 * @returns {string}
 */
export function toTitle(value) {
  return String(value || '').trim() || 'Untitled';
}

/**
 * Convert value to number or 0 if not a valid number
 * @param {*} value
 * @returns {number}
 */
export function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Extract tags from a feature
 * @param {object} feature
 * @returns {string[]}
 */
export function featureTags(feature) {
  const raw = feature?.tags;
  if (Array.isArray(raw)) return raw.map((t) => String(t)).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Check if a feature has any capacity allocation
 * @param {object} feature
 * @returns {boolean}
 */
export function hasAnyCapacity(feature) {
  const entries = Array.isArray(feature?.capacity) ? feature.capacity : [];
  return entries.some((c) => numberOrZero(c?.capacity) > 0);
}

/**
 * Get the capacity allocation for a feature on a specific team
 * @param {object} feature
 * @param {string|number} teamId
 * @returns {number}
 */
export function getFeatureTeamAllocation(feature, teamId) {
  const entries = Array.isArray(feature?.capacity) ? feature.capacity : [];
  return entries
    .filter((c) => String(c?.team) === String(teamId))
    .reduce((sum, c) => sum + numberOrZero(c?.capacity), 0);
}

/**
 * Convert hex color to RGBA string
 * @param {string} hex - Hex color string (e.g., '#ffffff')
 * @param {number} alpha - Alpha value (0-1), defaults to 0.12
 * @returns {string} RGBA string
 */
export function hexToRgba(hex, alpha = 0.12) {
  if (!hex) return `rgba(148, 163, 184, ${alpha})`;
  const value = String(hex).replace('#', '');
  if (value.length !== 6) return `rgba(148, 163, 184, ${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  if ([r, g, b].some((part) => Number.isNaN(part))) {
    return `rgba(148, 163, 184, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
