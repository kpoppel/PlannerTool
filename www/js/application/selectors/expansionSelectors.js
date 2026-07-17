/**
 * Pure selectors for the expanded feature dataset.
 *
 * Expansion was previously split between State and FeatureService. Keeping the
 * traversal here makes its inputs explicit and lets UI and service callers use
 * exactly the same rules without reaching through the State facade.
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asSet(value) {
  return value instanceof Set ? new Set(value) : new Set(asArray(value));
}

function getChildren(childrenByParent, featureId) {
  if (childrenByParent instanceof Map) return childrenByParent.get(featureId) || [];
  return childrenByParent?.[featureId] || [];
}

/**
 * Expand selected features through their ancestors and true descendants.
 * Ancestors discovered while walking upward are deliberately not allowed to
 * expand downward; this prevents traversing sideways into unrelated siblings.
 *
 * @param {Array<object>} features
 * @param {Map<string, string[]>|object} childrenByParent
 * @param {Set<string>|string[]} selectedFeatureIds
 * @returns {Set<string>}
 */
export function selectParentChildClosure(features, childrenByParent, selectedFeatureIds) {
  const featureById = new Map(asArray(features).map((feature) => [feature.id, feature]));
  const expandedIds = asSet(selectedFeatureIds);
  const expandableDownward = asSet(selectedFeatureIds);
  const pending = [...expandedIds];

  while (pending.length > 0) {
    const featureId = pending.pop();
    const feature = featureById.get(featureId);
    if (!feature) continue;

    if (feature.parentId && !expandedIds.has(feature.parentId) && featureById.has(feature.parentId)) {
      expandedIds.add(feature.parentId);
      pending.push(feature.parentId);
    }

    if (!expandableDownward.has(featureId)) continue;
    for (const childId of getChildren(childrenByParent, featureId)) {
      if (expandedIds.has(childId) || !featureById.has(childId)) continue;
      expandedIds.add(childId);
      expandableDownward.add(childId);
      pending.push(childId);
    }
  }

  return expandedIds;
}

/**
 * Expand the selected features through every relation that resolves to another
 * feature in the currently loaded dataset.
 *
 * @param {Array<object>} features
 * @param {Set<string>|string[]} selectedFeatureIds
 * @returns {Set<string>}
 */
export function selectRelationLinkedFeatureIds(features, selectedFeatureIds) {
  const featureById = new Map(asArray(features).map((feature) => [feature.id, feature]));
  const expandedIds = asSet(selectedFeatureIds);
  const pending = [...expandedIds];

  while (pending.length > 0) {
    const feature = featureById.get(pending.pop());
    if (!feature) continue;

    for (const relation of feature.relations || []) {
      if (!relation?.id) continue;
      const relatedId = String(relation.id);
      if (expandedIds.has(relatedId) || !featureById.has(relatedId)) continue;
      expandedIds.add(relatedId);
      pending.push(relatedId);
    }
  }

  return expandedIds;
}

/**
 * Select features with a positive allocation to one of the selected teams.
 *
 * @param {Array<object>} features
 * @param {string[]} selectedTeamIds
 * @returns {Set<string>}
 */
export function selectTeamAllocatedFeatureIds(features, selectedTeamIds) {
  const selectedTeams = new Set(asArray(selectedTeamIds).map((id) => String(id)));
  const featureIds = new Set();

  for (const feature of asArray(features)) {
    if (!Array.isArray(feature.capacity)) continue;
    const isAllocated = feature.capacity.some((allocation) => {
      const capacity = Number(allocation?.capacity) || 0;
      return capacity > 0 && selectedTeams.has(String(allocation?.team));
    });
    if (isAllocated) featureIds.add(feature.id);
  }

  return featureIds;
}

/**
 * Select features that should participate in expand-by-team-allocation mode.
 * Returns an empty list when team-allocation expansion is off or no team is selected.
 *
 * @param {{ features?: Array<object>, selectedTeamIds?: string[], expandTeamAllocated?: boolean }} input
 * @returns {Array<object>}
 */
export function selectTeamAllocationExpansionFeatures({
  features = [],
  selectedTeamIds = [],
  expandTeamAllocated = false,
} = {}) {
  if (!expandTeamAllocated || asArray(selectedTeamIds).length === 0) return [];
  return asArray(features);
}

/**
 * Combine independent expansion modes. Parent/child and relation traversals
 * always start from the original selected set, so modes never compound.
 *
 * @param {{
 *   features?: Array<object>,
 *   childrenByParent?: Map<string, string[]>|object,
 *   selectedFeatureIds?: Set<string>|string[],
 *   expansion?: { parentChild?: boolean, relations?: boolean, teamAllocated?: boolean },
 *   selectedTeamIds?: string[],
 * }} input
 * @returns {{ expandedIds: Set<string>, counts: { parentChild: number, relations: number, teamAllocated: number } }}
 */
export function selectExpandedFeatureSet({
  features = [],
  childrenByParent = new Map(),
  selectedFeatureIds = new Set(),
  expansion = {},
  selectedTeamIds = [],
} = {}) {
  const baseIds = asSet(selectedFeatureIds);
  const expandedIds = new Set(baseIds);
  const counts = { parentChild: 0, relations: 0, teamAllocated: 0 };

  if (expansion.parentChild) {
    const parentChildIds = selectParentChildClosure(features, childrenByParent, baseIds);
    const before = expandedIds.size;
    parentChildIds.forEach((id) => expandedIds.add(id));
    counts.parentChild = expandedIds.size - before;
  }

  if (expansion.relations) {
    const relationIds = selectRelationLinkedFeatureIds(features, baseIds);
    const before = expandedIds.size;
    relationIds.forEach((id) => expandedIds.add(id));
    counts.relations = expandedIds.size - before;
  }

  if (expansion.teamAllocated && asArray(selectedTeamIds).length > 0) {
    const teamAllocatedIds = selectTeamAllocatedFeatureIds(features, selectedTeamIds);
    const before = expandedIds.size;
    teamAllocatedIds.forEach((id) => expandedIds.add(id));
    counts.teamAllocated = expandedIds.size - before;
  }

  return { expandedIds, counts };
}

/**
 * Return selected project IDs plus projects made visible through selected-team
 * allocation expansion.
 *
 * @param {{ projects?: Array<object>, teams?: Array<object>, features?: Array<object>, expandTeamAllocated?: boolean }} input
 * @returns {string[]}
 */
export function selectEffectiveSelectedProjectIds({
  projects = [],
  teams = [],
  features = [],
  expandTeamAllocated = false,
} = {}) {
  const selectedProjectIds = asArray(projects)
    .filter((project) => project?.selected)
    .map((project) => project.id);
  if (!expandTeamAllocated) return selectedProjectIds;

  const selectedTeamIds = asArray(teams)
    .filter((team) => team?.selected)
    .map((team) => team.id);
  if (selectedTeamIds.length === 0) return selectedProjectIds;

  const featureById = new Map(asArray(features).map((feature) => [feature.id, feature]));
  const projectIds = new Set(selectedProjectIds);
  selectTeamAllocatedFeatureIds(features, selectedTeamIds).forEach((featureId) => {
    const feature = featureById.get(featureId);
    if (feature?.project) projectIds.add(feature.project);
  });
  return [...projectIds];
}

/**
 * Select the feature IDs visible after applying the configured expansion modes.
 * The base set is every feature belonging to a selected project.
 *
 * @param {{
 *   projects?: Array<object>,
 *   teams?: Array<object>,
 *   features?: Array<object>,
 *   childrenByParent?: Map<string, string[]>|object,
 *   expansion?: { parentChild?: boolean, relations?: boolean, teamAllocated?: boolean },
 * }} input
 * @returns {Set<string>}
 */
export function selectExpandedFeatureIds({
  projects = [],
  teams = [],
  features = [],
  childrenByParent = new Map(),
  expansion = {},
} = {}) {
  const selectedProjectIds = new Set(
    asArray(projects)
      .filter((project) => project?.selected)
      .map((project) => String(project.id))
  );
  const selectedFeatureIds = new Set(
    asArray(features)
      .filter((feature) => selectedProjectIds.has(String(feature.project)))
      .map((feature) => feature.id)
  );
  const selectedTeamIds = asArray(teams)
    .filter((team) => team?.selected)
    .map((team) => team.id);

  return selectExpandedFeatureSet({
    features,
    childrenByParent,
    selectedFeatureIds,
    expansion,
    selectedTeamIds,
  }).expandedIds;
}
