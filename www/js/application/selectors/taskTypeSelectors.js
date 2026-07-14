/**
 * Pure task-type derivation selectors.
 *
 * Task type data is currently inferred from loaded features until the backend
 * provides a canonical task-type catalog. Keeping that compatibility rule here
 * prevents menus and plugins from duplicating hierarchy behavior.
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Derive the distinct task types present in the baseline feature dataset.
 * Supports the legacy field aliases accepted by the current frontend.
 *
 * @param {Array<object>} features
 * @returns {string[]}
 */
export function selectAvailableTaskTypes(features = []) {
  const types = new Set();
  for (const feature of asArray(features)) {
    const type = feature?.type || feature?.workItemType || feature?.work_item_type;
    if (type) types.add(String(type));
  }
  return [...types].sort();
}

/**
 * Select the first configured non-empty hierarchy in project order.
 *
 * @param {Array<object>} projects
 * @returns {Array<{types: string[]}>}
 */
export function selectTaskTypeHierarchy(projects = []) {
  for (const project of asArray(projects)) {
    if (Array.isArray(project?.task_type_hierarchy) && project.task_type_hierarchy.length > 0) {
      return project.task_type_hierarchy;
    }
  }
  return [];
}

/**
 * Return the hierarchy level for a type, or the stable out-of-hierarchy value.
 *
 * @param {Array<{types: string[]}>} hierarchy
 * @param {string} type
 * @returns {number}
 */
export function selectTaskTypeLevel(hierarchy = [], type) {
  const key = String(type || '').toLowerCase();
  for (let index = 0; index < asArray(hierarchy).length; index += 1) {
    const types = asArray(hierarchy[index]?.types).map((item) => String(item).toLowerCase());
    if (types.includes(key)) return index;
  }
  return 9999;
}

/**
 * Return the configured display spelling for a type, falling back to its input.
 *
 * @param {Array<{types: string[]}>} hierarchy
 * @param {string} type
 * @returns {string}
 */
export function selectTaskTypeDisplayName(hierarchy = [], type) {
  const key = String(type || '').toLowerCase();
  for (const level of asArray(hierarchy)) {
    const canonical = asArray(level?.types).find((item) => String(item).toLowerCase() === key);
    if (canonical !== undefined) return canonical;
  }
  return type;
}

/**
 * Sort task types by hierarchy level then alphabetically, returning configured
 * display spelling when a type is known to the hierarchy.
 *
 * @param {Array<string>} taskTypes
 * @param {Array<{types: string[]}>} hierarchy
 * @returns {string[]}
 */
export function selectOrderedTaskTypes(taskTypes = [], hierarchy = []) {
  const types = asArray(taskTypes);
  if (asArray(hierarchy).length === 0) return types;

  return [...types]
    .sort((left, right) => {
      const leftLevel = selectTaskTypeLevel(hierarchy, left);
      const rightLevel = selectTaskTypeLevel(hierarchy, right);
      if (leftLevel !== rightLevel) return leftLevel - rightLevel;
      return left.localeCompare(right);
    })
    .map((type) => selectTaskTypeDisplayName(hierarchy, type));
}
