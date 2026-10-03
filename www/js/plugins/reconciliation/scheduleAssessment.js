const DAY_MS = 86400000;

export function calendarDay(value) {
  if (!value) return null;
  const date = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    return null;
  }
  return timestamp / DAY_MS;
}

function drift(child, parent) {
  const childStart = calendarDay(child.start);
  const childEnd = calendarDay(child.end);
  const parentStart = calendarDay(parent.start);
  const parentEnd = calendarDay(parent.end);
  if ([childStart, childEnd, parentStart, parentEnd].includes(null)
    || childStart > childEnd || parentStart > parentEnd) return null;
  return {
    earlyDays: Math.max(0, parentStart - childStart),
    lateDays: Math.max(0, childEnd - parentEnd),
  };
}

export function assessSchedule(featuresById, scopeIds) {
  const issues = [];
  for (const child of featuresById.values()) {
    const childId = String(child.id);
    const path = [childId];
    const visited = new Set(path);
    let current = child;
    while (current.parentId) {
      const parentId = String(current.parentId);
      if (visited.has(parentId)) break;
      visited.add(parentId);
      path.push(parentId);
      const parent = featuresById.get(parentId);
      if (!parent) break;
      if (scopeIds.has(childId) || scopeIds.has(parentId)) {
        const overhang = drift(child, parent);
        if (overhang && (overhang.earlyDays > 0 || overhang.lateDays > 0)) {
          const magnitude = Math.max(overhang.earlyDays, overhang.lateDays);
          issues.push({
            id: `containment:${childId}:${parentId}`, type: 'containment', category: 'schedule',
            featureId: childId, relatedId: parentId, path: [...path], ...overhang,
            magnitude, severity: magnitude >= 10 ? 'high' : 'warning',
            title: 'Task dates outside ancestor bounds',
            description: `"${child.title}" ${overhang.earlyDays > 0 ? `starts ${overhang.earlyDays} days early` : ''}${overhang.earlyDays > 0 && overhang.lateDays > 0 ? ' and ' : ''}${overhang.lateDays > 0 ? `finishes ${overhang.lateDays} days late` : ''} relative to "${parent.title}".`,
          });
        }
      }
      current = parent;
    }
  }
  const dependencies = new Map();
  for (const feature of featuresById.values()) {
    for (const relation of feature.relations) {
      if (relation.type !== 'Predecessor' && relation.type !== 'Successor') continue;
      const otherId = String(relation.id);
      const featureId = String(feature.id);
      const other = featuresById.get(otherId);
      if (!other || (!scopeIds.has(featureId) && !scopeIds.has(otherId))) continue;
      const predecessor = relation.type === 'Predecessor' ? other : feature;
      const successor = relation.type === 'Predecessor' ? feature : other;
      const before = calendarDay(predecessor.start);
      const after = calendarDay(successor.start);
      if (before === null || after === null || after >= before) continue;
      const id = `dependency:${predecessor.id}:${successor.id}`;
      dependencies.set(id, {
        id, type: 'dependency-order', category: 'schedule',
        featureId: String(successor.id), relatedId: String(predecessor.id),
        path: [String(successor.id), String(predecessor.id)],
        earlyDays: before - after, lateDays: 0, magnitude: before - after,
        severity: 'warning', title: 'Task starts before its predecessor',
        description: `"${successor.title}" starts ${before - after} days before "${predecessor.title}". Review the dependency dates.`,
      });
    }
  }
  issues.push(...dependencies.values());
  return issues;
}