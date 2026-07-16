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

/**
 * Select resolution metadata for one project id.
 *
 * @param {object} iterationsByProject
 * @param {string|null|undefined} projectId
 * @returns {{matchedRuleId?:string|null, fallbackUsed?:boolean, resolutionWarnings?:Array<string>, sourceProject?:string, roots?:Array<string>}|null}
 */
export function selectIterationResolutionForProject(iterationsByProject = {}, projectId) {
  if (!projectId) return null;
  const group = iterationsByProject?.[String(projectId)];
  if (!group || typeof group !== 'object') return null;
  return {
    matchedRuleId: group.matchedRuleId ?? null,
    fallbackUsed: !!group.fallbackUsed,
    resolutionWarnings: asArray(group.resolutionWarnings),
    sourceProject: group.sourceProject || '',
    roots: asArray(group.roots),
  };
}
