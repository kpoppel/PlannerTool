/**
 * Module-level in-memory cache for Azure DevOps project metadata.
 *
 * Keyed by Azure project name (the first path segment of an area_path,
 * e.g. "Platform_Development" from "Platform_Development\Team1").
 *
 * Data is populated from server responses (prefetch on tab load, or on-demand
 * when the admin selects an Azure project in the browse panel) and is reused
 * across all admin components throughout the page session.
 *
 * Cached shape per project:
 *   {
 *     types:           string[],
 *     states:          string[],
 *     states_by_type:  Record<string, string[]>,
 *     state_categories: Record<string, string>   // e.g. { Active: "InProgress" }
 *   }
 */

/** @type {Map<string, object>} */
const _cache = new Map();

/**
 * Standard Azure DevOps state category → CSS background-color mapping.
 * Categories are: Proposed | InProgress | Resolved | Completed | Removed
 * @type {Record<string, string>}
 */
export const CATEGORY_COLORS = {
  Proposed:   '#f3f4f6',   // light gray   — not started
  InProgress: '#dbeafe',   // light blue   — active work
  Resolved:   '#fef3c7',   // light amber  — awaiting validation
  Completed:  '#dcfce7',   // light green  — done
  Removed:    '#fee2e2',   // light rose   — discarded
};

/**
 * Derive the Azure project name from an area path (first path segment).
 * Works with both backslash and forward-slash separators.
 * @param {string} areaPath
 * @returns {string}
 */
export function azureProjectFromAreaPath(areaPath) {
  if (!areaPath) return '';
  const sep = areaPath.includes('\\') ? '\\' : '/';
  return areaPath.split(sep)[0] || '';
}

/**
 * Store metadata for an Azure project.
 * @param {string} azureProject
 * @param {{types: string[], states: string[], states_by_type: object, state_categories: object}} metadata
 */
export function setMetadata(azureProject, metadata) {
  if (!azureProject) return;
  _cache.set(azureProject, metadata);
}

/**
 * Retrieve cached metadata for an Azure project, or null if not cached.
 * @param {string} azureProject
 * @returns {object|null}
 */
export function getMetadata(azureProject) {
  return _cache.get(azureProject) || null;
}

/**
 * Get the Azure DevOps category string for a given state within a project.
 * @param {string} azureProject
 * @param {string} state
 * @returns {string} category name (e.g. "InProgress") or empty string if unknown
 */
export function getStateCategory(azureProject, state) {
  const m = _cache.get(azureProject);
  if (!m || !m.state_categories) return '';
  return m.state_categories[state] || '';
}

/**
 * Get the CSS background color for a state based on its Azure DevOps category.
 * Falls back to the Proposed (gray) color when the category is unknown.
 * @param {string} azureProject
 * @param {string} state
 * @returns {string} CSS color value
 */
export function getStateCategoryColor(azureProject, state) {
  const category = getStateCategory(azureProject, state);
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.Proposed;
}
