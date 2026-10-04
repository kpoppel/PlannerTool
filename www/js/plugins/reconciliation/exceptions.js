export const EXCEPTIONS_KEY = 'plugin-reconciliation';

export function canonicalEvidence(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof Set) return canonicalEvidence([...value].sort());
  if (Object.getPrototypeOf(value) === Array.prototype) {
    return `[${value.map(canonicalEvidence).join(',')}]`;
  }
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalEvidence(value[key])}`).join(',')}}`;
}

export function exceptionIdentity(issue) {
  return { rule: issue.type, taskId: issue.featureId, relatedId: issue.relatedId,
    path: [...issue.path] };
}

export function exceptionEvidence(identity, sourceById, scenario, projects, hierarchy) {
  const ids = new Set([identity.taskId, identity.relatedId, ...identity.path]);
  ids.delete(null);
  const tasks = [...ids].sort().map((id) => ({ id,
    source: sourceById.has(id) ? sourceById.get(id) : null,
    override: scenario.overrides[id] === undefined ? null : scenario.overrides[id] }));
  const projectIds = new Set(tasks.filter((task) => task.source !== null)
    .map((task) => String(task.source.project)));
  return canonicalEvidence({ identity, tasks, hierarchy,
    projects: projects.filter((project) => projectIds.has(String(project.id))) });
}

export function exceptionDecisions(scenario) {
  const bag = scenario.pluginData[EXCEPTIONS_KEY];
  if (bag === undefined) return [];
  if (bag.version !== 1) throw new Error('Unsupported reconciliation exception version');
  return bag.decisions;
}