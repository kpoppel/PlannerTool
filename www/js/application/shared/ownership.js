/**
 * Resolve the nearest project-typed plan that owns a feature or one of its
 * ancestors. The optional memo stores one result per feature for a calculation.
 * @param {any} feature
 * @param {Map<string, any>} effectiveById
 * @param {Map<string, any>} projectById
 * @param {Map<string, string|null>} [memo]
 * @returns {string|null}
 */
export function resolveFundedTargetProject(feature, effectiveById, projectById, memo = new Map()) {
  const startId = String(feature.id);
  if (memo.has(startId)) return memo.get(startId);

  const visited = new Set();
  let current = feature;
  let result = null;

  while (current) {
    const currentId = String(current.id);
    if (visited.has(currentId)) break;
    visited.add(currentId);

    if (current.project !== undefined && current.project !== null) {
      const projectId = String(current.project);
      const project = projectById.get(projectId);
      if (project && (project.type || 'project') === 'project') {
        result = projectId;
        break;
      }
    }

    if (current.parentId === undefined || current.parentId === null) break;
    current = effectiveById.get(String(current.parentId));
  }

  memo.set(startId, result);
  return result;
}