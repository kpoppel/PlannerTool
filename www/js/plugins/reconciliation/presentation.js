export const CATEGORIES = [
  { id: 'schedule', label: 'Schedule conflicts' },
  { id: 'quality', label: 'Plan quality' },
];

export function categoryCounts(snapshot) {
  return CATEGORIES.map((category) => ({
    ...category, count: snapshot.groups.filter((group) => group.category === category.id).length,
  })).sort((first, second) => {
    if (first.count !== second.count) return second.count - first.count;
    return first.id.localeCompare(second.id);
  });
}

export function findingExplanation(snapshot, issue) {
  const constraints = {
    containment: 'Child dates must remain within the parent schedule.',
    'dependency-order': 'A task must not start before its predecessor starts.',
    'unavailable-dependency': 'The recorded dependency requires loaded related-task context.',
    'unavailable-dependency-dates': 'Dependency ordering requires valid dates for both tasks.',
    'unavailable-containment-dates': 'Containment requires valid parent and child dates.',
  };
  const constraint = issue.category === 'quality' ? issue.description : constraints[issue.type];
  if (typeof constraint !== 'string') {
    throw new Error(`No reconciliation constraint explanation for ${issue.type}`);
  }
  const ids = new Set([issue.featureId, ...issue.path]);
  if (issue.relatedId !== null) ids.add(issue.relatedId);
  const plans = new Map();
  for (const id of ids) {
    const feature = snapshot.featuresById.get(String(id));
    if (feature === undefined) plans.set(null, 'Affected plan unavailable');
    else plans.set(String(feature.project), projectLabel(snapshot, id));
  }
  const affectedPlans = [...plans.values()];
  const knownPlanCount = [...plans.keys()].filter((id) => id !== null).length;
  const impact = issue.severity === 'info'
    ? 'Cannot assess impact until related task data is available.'
    : knownPlanCount > 1
      ? 'Cross-plan impact: corrections may affect related work in other plans.'
      : 'Corrections may affect related work in the owning plan.';
  return { constraint, affectedPlans, impact };
}

export function changeLabel(change) {
  if (change === 'new') return 'New';
  if (change === 'worsened') return 'Worsened';
  if (change === 'existing') return 'Existing';
  return '';
}

export function statusText(snapshot) {
  if (snapshot.status === 'loading') return 'Loading plan data...';
  if (snapshot.status === 'unavailable') return 'Plan data unavailable. Issues cannot be assessed.';
  if (snapshot.status === 'inactive') return 'Reconciliation is inactive.';
  if (snapshot.visibleIds.size === 0) return 'No tasks in the current scope.';
  if (snapshot.groups.length === 0) return 'No issues found in the current scope.';
  return snapshot.groups.length === 1 ? '1 item needs review in the current scope.'
    : `${snapshot.groups.length} items need review in the current scope.`;
}

export function taskLabel(snapshot, featureId) {
  const feature = snapshot.featuresById.get(String(featureId));
  return feature ? feature.title : `Task ${featureId} (not loaded)`;
}

export function projectLabel(snapshot, featureId) {
  const feature = snapshot.featuresById.get(String(featureId));
  if (!feature) return 'Project unavailable';
  const project = snapshot.projectsById.get(String(feature.project));
  return project ? project.name : String(feature.project);
}