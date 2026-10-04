import { calendarDay } from './scheduleAssessment.js';

export function assessQuality({ featuresById, scopeIds, today, projects, hierarchy }) {
  const issues = [];
  const projectMap = new Map(projects.map((project) => [String(project.id), project]));
  const levels = new Map(hierarchy.flatMap((level, index) =>
    level.types.map((type) => [type.toLowerCase(), index])));
  const minimumLevels = new Map();
  for (const feature of featuresById.values()) {
    const level = levels.get(feature.type.toLowerCase());
    const projectId = String(feature.project);
    if (level !== undefined && (!minimumLevels.has(projectId)
      || level < minimumLevels.get(projectId))) minimumLevels.set(projectId, level);
  }
  const categoryFor = (feature) => {
    const project = projectMap.get(String(feature.project));
    return project ? project.state_categories[feature.state] : undefined;
  };
  const todayDay = calendarDay(today);
  const add = (feature, type, title, description, severity = 'warning', relatedId = null,
    relatedIds = []) => {
    issues.push({ id: `${type}:${feature.id}`, type, category: 'quality',
      featureId: String(feature.id), relatedId, title, description, severity,
      path: relatedId === null ? [String(feature.id), ...relatedIds]
        : [String(feature.id), relatedId, ...relatedIds] });
  };

  for (const feature of featuresById.values()) {
    if (!scopeIds.has(String(feature.id))) continue;
    const start = calendarDay(feature.start);
    const end = calendarDay(feature.end);
    const category = categoryFor(feature);
    if ((feature.start && start === null) || (feature.end && end === null)
      || (start !== null && end !== null && start > end)) {
      add(feature, 'invalid-dates', 'Invalid task dates',
        `Review the start and finish dates of "${feature.title}".`, 'error');
    } else {
      if (end !== null && end < todayDay && (category === 'InProgress' || category === 'Proposed')) {
        add(feature, 'past-unfinished', 'Past finish date, still unfinished',
          `"${feature.title}" was scheduled to finish ${feature.end} and is ${feature.state}. Review its dates or status.`);
      }
      if (start !== null && start > todayDay && (category === 'InProgress' || category === 'Resolved')) {
        add(feature, 'future-active', 'Work started ahead of its schedule',
          `"${feature.title}" is ${feature.state}, but starts ${feature.start}. Review its dates or status.`);
      }
    }
    const level = levels.get(feature.type.toLowerCase());
    const projectId = String(feature.project);
    const project = projectMap.get(projectId);
    const isRoot = level === minimumLevels.get(projectId);
    if (!feature.parentId) {
      if (level !== undefined && !isRoot) {
        add(feature, 'missing-parent', 'Task has no parent link',
          `"${feature.title}" is not a root item in its project and has no parent.`);
      } else if (level !== undefined && project && project.container_order > 0) {
        add(feature, 'unanchored-root', 'Plan root is not linked to a higher-level plan',
          `"${feature.title}" has no parent in a higher-level plan.`);
      }
      continue;
    }
    const parentId = String(feature.parentId);
    const parent = featuresById.get(parentId);
    if (!parent) {
      add(feature, 'unavailable-parent', 'Parent context unavailable',
        `Parent ${parentId} of "${feature.title}" is not loaded; its alignment cannot be assessed.`, 'info', parentId);
      continue;
    }
    const parentProject = projectMap.get(String(parent.project));
    const anchoredRoot = isRoot && project && parentProject
      && parentProject.container_order < project.container_order;
    const parentLevel = levels.get(parent.type.toLowerCase());
    if (!anchoredRoot && level !== undefined && parentLevel !== undefined && parentLevel >= level) {
      add(feature, 'hierarchy-type', 'Unexpected parent task type',
        `"${feature.title}" (${feature.type}) is linked below "${parent.title}" (${parent.type}).`, 'warning', parentId);
    }
    if ((start === null || end === null) && calendarDay(parent.start) !== null
      && calendarDay(parent.end) !== null) {
      add(feature, 'unplanned-child', 'Unplanned task under a scheduled parent',
        `"${feature.title}" has no complete schedule, while "${parent.title}" is planned.`, 'warning', parentId);
    }
    if (categoryFor(parent) === 'Completed' && (category === 'InProgress' || category === 'Proposed')) {
      add(feature, 'parent-state', 'Finished parent has unfinished work',
        `"${parent.title}" is ${parent.state}, but "${feature.title}" is ${feature.state}.`, 'warning', parentId);
    }
    const visited = new Set([String(feature.id)]);
    let current = feature;
    while (current.parentId) {
      const ancestorId = String(current.parentId);
      if (visited.has(ancestorId)) {
        add(feature, 'hierarchy-cycle', 'Circular parent links',
          `The parent chain of "${feature.title}" loops back on itself.`, 'error');
        break;
      }
      visited.add(ancestorId);
      current = featuresById.get(ancestorId);
      if (!current) break;
    }
  }
  const childrenByParent = new Map();
  for (const child of featuresById.values()) {
    if (!child.parentId) continue;
    const parentId = String(child.parentId);
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(child);
  }
  for (const [parentId, children] of childrenByParent) {
    if (!scopeIds.has(parentId) && !children.some((child) => scopeIds.has(String(child.id)))) continue;
    const parent = featuresById.get(parentId);
    if (!parent) continue;
    const parentTeams = new Set(parent.capacity.map((allocation) => String(allocation.team)));
    const childTeams = new Set(children.flatMap((child) =>
      child.capacity.map((allocation) => String(allocation.team))));
    if (parentTeams.size === 0 || childTeams.size === 0) continue;
    const missingOnChildren = [...parentTeams].filter((team) => !childTeams.has(team));
    const missingOnParent = [...childTeams].filter((team) => !parentTeams.has(team));
    if (missingOnChildren.length > 0 || missingOnParent.length > 0) {
      add(parent, 'team-allocation', 'Parent and child team allocations differ',
        `Review the team allocations of "${parent.title}" and its children.`, 'warning', null,
        children.map((child) => String(child.id)));
    }
  }
  return issues;
}