/** Pure Context-driven plan swimlane helpers for FeatureBoard. */

export const SWIMLANE_LABEL_WIDTH_PX = 140;
export const SWIMLANE_BAND_GAP_PX = 8;

/**
 * @param {Array<{selected:boolean}>} projects
 * @param {Array<{type:'plan'|'expanded-plan'}>} swimlanes
 * @returns {boolean}
 */
export function isSwimlaneMode(projects, swimlanes = []) {
  const selectedCount = projects.filter((project) => project.selected).length;
  const displayedPlanCount = swimlanes.filter(
    (swimlane) => swimlane.type === 'plan' || swimlane.type === 'expanded-plan'
  ).length;
  return selectedCount >= 2 || displayedPlanCount >= 2;
}

/**
 * Build selected-plan lanes plus visible cross-plan source lanes enabled by
 * Context. Related tasks are already selected by the canonical scope selector.
 *
 * @param {Array<{id:string,name:string,color:string,selected:boolean}>} projects
 * @param {Array<{project:string}>} visibleFeatures
 * @param {{parent:boolean,child:boolean,dependency:boolean,otherAllocations:boolean}} context
 * @returns {Array<{id:string,name:string,color:string,type:'plan'|'expanded-plan'}>}
 */
export function buildSwimlaneList(projects, visibleFeatures, context) {
  const swimlanes = [];
  const addedIds = new Set();
  const featuresById = new Map(visibleFeatures.map((feature) => [String(feature.id), feature]));
  const selectedProjects = projects.filter((project) => project.selected);
  const selectedPlanDepth = (planId) => {
    let depth = 0;
    for (const feature of visibleFeatures) {
      if (String(feature.project) !== String(planId)) continue;
      let current = feature;
      const visited = new Set([String(feature.id)]);
      while (current.parentId) {
        const parentId = String(current.parentId);
        if (visited.has(parentId)) break;
        visited.add(parentId);
        current = featuresById.get(parentId);
        if (!current) break;
        if (selectedProjects.some((project) => String(project.id) === String(current.project))) {
          depth += 1;
        }
      }
    }
    return depth;
  };
  const orderedSelectedProjects = [...selectedProjects].sort(
    (left, right) => selectedPlanDepth(left.id) - selectedPlanDepth(right.id)
  );
  for (const project of orderedSelectedProjects) {
    swimlanes.push({ id: project.id, name: project.name, color: project.color, type: 'plan' });
    addedIds.add(String(project.id));
  }

  const includeSourcePlans = context.parent
    || context.child
    || context.dependency
    || context.otherAllocations;
  if (!includeSourcePlans) return swimlanes;

  const projectsById = new Map(projects.map((project) => [String(project.id), project]));
  for (const feature of visibleFeatures) {
    const projectId = String(feature.project);
    if (addedIds.has(projectId)) continue;
    const project = projectsById.get(projectId);
    if (!project) continue;
    swimlanes.push({
      id: project.id,
      name: project.name,
      color: project.color,
      type: 'expanded-plan',
    });
    addedIds.add(projectId);
  }
  return swimlanes;
}

/**
 * Resolve one visible feature to a plan lane. Selected-plan ownership wins;
 * hierarchy Context then selects the nearest available ancestor lane; other
 * contextual work remains in its visible source-plan lane.
 */
export function assignFeatureToSwimlane(
  feature,
  swimlanes,
  allFeaturesById,
  context,
  groupedOwnerPlanId = null
) {
  if (swimlanes.length === 0) return null;
  const swimlaneById = new Map(swimlanes.map((swimlane) => [String(swimlane.id), swimlane]));
  const groupedOwnerLane = groupedOwnerPlanId === null
    ? null
    : swimlaneById.get(String(groupedOwnerPlanId));
  if (groupedOwnerLane && groupedOwnerLane.type === 'plan') return groupedOwnerLane.id;
  const ownSwimlane = swimlaneById.get(String(feature.project));

  if (context.parent) {
    let current = feature;
    let expandedPlanId = null;
    const visited = new Set([String(feature.id)]);
    while (current.parentId) {
      const parentId = String(current.parentId);
      if (visited.has(parentId)) break;
      visited.add(parentId);
      current = allFeaturesById.get(parentId);
      if (!current) break;
      const lane = swimlaneById.get(String(current.project));
      if (!lane) continue;
      if (lane.type === 'plan') return lane.id;
      if (expandedPlanId === null) expandedPlanId = lane.id;
    }
    if (expandedPlanId !== null) return expandedPlanId;
  }

  if (ownSwimlane && ownSwimlane.type === 'plan') return ownSwimlane.id;

  if (context.child) {
    let current = feature;
    let expandedPlanId = null;
    const visited = new Set([String(feature.id)]);
    while (current.parentId) {
      const parentId = String(current.parentId);
      if (visited.has(parentId)) break;
      visited.add(parentId);
      current = allFeaturesById.get(parentId);
      if (!current) break;
      const lane = swimlaneById.get(String(current.project));
      if (!lane) continue;
      if (lane.type === 'plan') return lane.id;
      if (expandedPlanId === null) expandedPlanId = lane.id;
    }
    if (expandedPlanId !== null) return expandedPlanId;
  }

  if (ownSwimlane) return ownSwimlane.id;
  return swimlanes[0].id;
}