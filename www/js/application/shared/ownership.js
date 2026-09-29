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

export function getConnectedPlanIds(planId, features) {
  const byId = new Map(features.map((feature) => [String(feature.id), feature]));
  const children = new Map();
  const seeds = [];
  for (const feature of features) {
    if (String(feature.project) === String(planId)) seeds.push(feature);
    if (feature.parentId === undefined || feature.parentId === null) continue;
    const parentId = String(feature.parentId);
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(feature);
  }

  const connected = new Set([String(planId)]);
  const visited = new Set();
  const visit = (feature) => {
    const id = String(feature.id);
    if (visited.has(id)) return false;
    visited.add(id);
    connected.add(String(feature.project));
    return true;
  };

  for (const seed of seeds) {
    let current = seed;
    while (current && visit(current)) {
      current = current.parentId === undefined || current.parentId === null ? null
        : byId.get(String(current.parentId));
    }
  }
  const pending = [...seeds];
  const descendants = new Set();
  while (pending.length) {
    const feature = pending.pop();
    const id = String(feature.id);
    if (descendants.has(id)) continue;
    descendants.add(id);
    connected.add(String(feature.project));
    for (const child of children.get(id) || []) pending.push(child);
  }
  return connected;
}

export function getPlanAncestorIds(feature, featuresById, plansById) {
  const planIds = new Set();
  const visited = new Set();
  let current = feature;
  while (current && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    const planId = String(current.project);
    if (plansById.has(planId)) planIds.add(planId);
    current = current.parentId === undefined || current.parentId === null ? null
      : featuresById.get(String(current.parentId));
  }
  return planIds;
}