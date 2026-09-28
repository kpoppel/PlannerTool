export function buildFoldModel(features, sections, folded) {
  const byId = new Map(features.map((feature) => [String(feature.id), feature]));
  const children = new Map(features.map((feature) => [String(feature.id), []]));
  const roots = [];

  for (const feature of features) {
    const parentId = feature.parentId && String(feature.parentId);
    const id = String(feature.id);
    if (parentId && byId.has(parentId) && sections.get(id) === sections.get(parentId)) {
      children.get(parentId).push(feature);
    } else {
      roots.push(feature);
    }
  }

  const hidden = new Set();
  const counts = new Map();
  const depth = new Map();
  const ordered = [];
  const seen = new Set();
  const visit = (feature, level, concealed) => {
    const id = String(feature.id);
    if (seen.has(id)) return 0;
    seen.add(id);
    ordered.push(feature);
    depth.set(id, level);
    if (concealed) hidden.add(id);
    let count = 0;
    for (const child of children.get(id)) {
      count += 1 + visit(child, level + 1, concealed || folded.has(id));
    }
    if (count > 0) counts.set(id, count);
    return count;
  };
  for (const root of roots) visit(root, 0, false);
  for (const feature of features) visit(feature, 0, false);

  return {
    visible: ordered.filter((feature) => !hidden.has(String(feature.id))),
    hidden,
    counts,
    depth,
  };
}

export function applyFoldAction(model, folded, action) {
  if (action === 'expand-all') return new Set();
  const next = new Set(folded);
  if (action === 'collapse-all') {
    for (const id of model.counts.keys()) next.add(id);
    return next;
  }
  const candidates = model.visible
    .map((feature) => String(feature.id))
    .filter((id) => model.counts.has(id) && folded.has(id) === (action === 'expand-one'));
  if (candidates.length === 0) return next;
  const levels = candidates.map((id) => model.depth.get(id));
  const frontier = action === 'expand-one' ? Math.min(...levels) : Math.max(...levels);
  for (const id of candidates) {
    if (model.depth.get(id) !== frontier) continue;
    if (action === 'expand-one') next.delete(id);
    else if (action === 'collapse-one') next.add(id);
  }
  return next;
}