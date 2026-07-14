function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Select the iteration list for one project id.
 *
 * @param {object} iterationsByProject
 * @param {string|null|undefined} projectId
 * @returns {Array<object>}
 */
export function selectIterationsForProject(iterationsByProject = {}, projectId) {
  if (!projectId) return [];
  const group = iterationsByProject?.[String(projectId)];
  return asArray(group?.iterations);
}
