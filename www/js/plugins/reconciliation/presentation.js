export const CATEGORIES = [
  { id: 'schedule', label: 'Schedule conflicts' },
  { id: 'quality', label: 'Plan quality' },
];

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