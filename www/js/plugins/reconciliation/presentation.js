export const CATEGORIES = [
  { id: 'quality', label: 'Within selected plans', icon: '\u2637' },
  { id: 'schedule', label: 'Across plans & dependencies', icon: '\u2194' },
];

export function categoryCounts(snapshot) {
  return CATEGORIES.map((category) => ({
    ...category, count: new Set(snapshot.groups.filter((group) => group.category === category.id)
      .map((group) => group.featureId)).size,
  })).sort((first, second) => {
    if (first.count !== second.count) return second.count - first.count;
    return first.id.localeCompare(second.id);
  });
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

const CONSTRAINTS = {
  containment: 'Task dates must stay within each scheduled ancestor\'s start and finish dates.',
  'dependency-order': 'A successor must not start before its predecessor starts.',
  'unavailable-dependency': 'Dependency start ordering requires both linked tasks to be loaded.',
  'unavailable-dependency-dates': 'Dependency start ordering requires valid start dates on both tasks.',
  'unavailable-ancestor': 'Hierarchy containment requires loaded tasks along the ancestor path.',
  'unavailable-containment-dates': 'Hierarchy containment requires complete, valid date ranges on both tasks.',
  'invalid-dates': 'Task dates must be valid, with start no later than finish.',
  'past-unfinished': 'Work scheduled to finish in the past must be completed or rescheduled.',
  'future-active': 'Active work must align with its scheduled start.',
  'missing-parent': 'Non-root tasks need a parent at the configured hierarchy level.',
  'unanchored-root': 'A lower-level plan root needs a link to a higher-level plan.',
  'unavailable-parent': 'Parent alignment requires the linked parent to be loaded.',
  'hierarchy-type': 'Parent links must follow configured task and plan hierarchy levels.',
  'unplanned-child': 'Work under a scheduled parent needs a complete schedule for alignment review.',
  'parent-state': 'Completed parents must not contain unfinished work.',
  'hierarchy-cycle': 'Parent links must form an acyclic hierarchy.',
  'team-allocation': 'Parent and child team allocations need to agree.',
};

export function findingExplanation(snapshot, issue) {
  const constraint = CONSTRAINTS[issue.type];
  if (constraint === undefined) throw new Error(`Unknown reconciliation rule ${issue.type}`);
  const ids = new Set([issue.featureId, ...issue.path]);
  if (issue.relatedId !== null) ids.add(issue.relatedId);
  const plans = new Set();
  let unavailable = false;
  for (const id of ids) {
    const feature = snapshot.featuresById.get(id);
    if (feature === undefined) unavailable = true;
    else plans.add(String(feature.project));
  }
  const affectedPlans = [...plans].map((id) => {
    const project = snapshot.projectsById.get(id);
    return project === undefined ? id : project.name;
  });
  if (unavailable) affectedPlans.push('Affected plan unavailable');
  const contextual = issue.category === 'schedule' || issue.relatedId !== null
    || ['missing-parent', 'unanchored-root', 'hierarchy-cycle', 'team-allocation'].includes(issue.type);
  const impact = unavailable
    ? 'Impact cannot be fully assessed until related task data is available.'
    : plans.size > 1
      ? 'Cross-plan impact: changing this task or link can affect commitments in related plans.'
      : contextual
        ? 'Related-work impact: review linked work before changing this task or its relationships.'
        : 'Correction belongs to the owning plan; date or link changes still require related-work review.';
  return { constraint, affectedPlans, impact };
}