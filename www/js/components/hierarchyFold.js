/**
 * hierarchyFold.js
 *
 * Pure model for parent/child folding on the timeline board.
 *
 * The board renders one absolutely-positioned row per task, so nesting is not
 * expressed by containment — it has to be derived.  This module turns a flat
 * task list into the three things the board and the cards need:
 *
 *   - a depth-first row order, so a task's descendants sit directly beneath it
 *   - the set of rows hidden because an ancestor is collapsed
 *   - per-task subtree facts (descendant count, date extent) used to draw a
 *     collapsed card as a roll-up of everything it hides
 *
 * No DOM, no Lit, no store access — everything is passed in.
 *
 * Exports:
 *   resolveParentId(feature)
 *   createFeatureComparator(sortMode)
 *   buildHierarchyModel({ allFeatures, visibleFeatures, collapsed, sortSiblings })
 *   collapseToDepth(model, depth)
 */

/** A task without a fetch-order rank sorts first rather than failing the render. */
const rankOf = (feature) =>
  Number.isInteger(feature.originalRank) ? feature.originalRank : 0;

/**
 * The parent link exists in two shapes depending on how the task was imported:
 * a direct `parentId`, or a `Parent` entry in `relations`.
 *
 * @param {object} feature
 * @returns {string|null} Parent id as a string, or null for a root task.
 */
export function resolveParentId(feature) {
  if (feature.parentId) return String(feature.parentId);
  if (!feature.relations) return null;
  const parentRelation = feature.relations.find((relation) => relation.type === 'Parent');
  if (parentRelation === undefined) return null;
  if (!parentRelation.id) return null;
  return String(parentRelation.id);
}

/**
 * Comparator matching the board's Task Sort setting.  In hierarchy ordering it
 * is applied per sibling group rather than to the whole flat list.
 *
 * @param {'rank'|'date'} sortMode
 * @returns {(a: object, b: object) => number}
 */
export function createFeatureComparator(sortMode) {
  if (sortMode === 'date') {
    return (a, b) => {
      if (!a.start && !b.start) return rankOf(a) - rankOf(b);
      if (!a.start) return 1;
      if (!b.start) return -1;
      const byDate = String(a.start).localeCompare(String(b.start));
      if (byDate !== 0) return byDate;
      return rankOf(a) - rankOf(b);
    };
  }
  return (a, b) => rankOf(a) - rankOf(b);
}

/** Map parent id → child features, for the subset of tasks given. */
function childrenByParent(features) {
  const byId = new Set(features.map((feature) => String(feature.id)));
  const map = new Map();
  for (const feature of features) {
    const parentId = resolveParentId(feature);
    // A task whose parent is not in this set is a root as far as this set goes.
    if (parentId === null || !byId.has(parentId)) continue;
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId).push(feature);
  }
  return { map, byId };
}

/** Roots are tasks with no parent inside the given set. */
function rootsOf(features, byId) {
  return features.filter((feature) => {
    const parentId = resolveParentId(feature);
    return parentId === null || !byId.has(parentId);
  });
}

/**
 * Walk the whole subtree below `rootId`, returning every descendant feature.
 * `seen` guards against parent cycles in imported data.
 */
function collectDescendants(rootId, childMap) {
  const out = [];
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = childMap.get(currentId);
    if (children === undefined) continue;
    for (const child of children) {
      const childId = String(child.id);
      if (seen.has(childId)) continue;
      seen.add(childId);
      out.push(child);
      queue.push(childId);
    }
  }
  return out;
}

/**
 * Build the folding model.
 *
 * `allFeatures` drives the subtree facts (counts, extent, comb ticks) so a
 * collapsed card reports everything it hides, including tasks removed by the
 * type/state filters.  `visibleFeatures` drives the row order and the hidden
 * set, because only those tasks are ever rendered.
 *
 * @param {object}      args
 * @param {object[]}    args.allFeatures      Every task in the dataset, unfiltered
 * @param {object[]}    args.visibleFeatures  Tasks that passed the board filters
 * @param {Set<string>} args.collapsed        Ids the user has folded
 * @param {(a:object,b:object)=>number} args.sortSiblings
 * @returns {{
 *   depth: Map<string, number>,
 *   order: Map<string, number>,
 *   hidden: Set<string>,
 *   collapsed: Set<string>,
 *   descendantCount: Map<string, number>,
 *   visibleDescendantCount: Map<string, number>,
 *   extent: Map<string, { start: string, end: string }>,
 *   descendants: Map<string, object[]>,
 *   maxDepth: number,
 * }}
 */
export function buildHierarchyModel({
  allFeatures,
  visibleFeatures,
  collapsed,
  sortSiblings,
}) {
  const visible = childrenByParent(visibleFeatures);
  const all = childrenByParent(allFeatures);

  // --- Depth-first row order over the visible tasks -------------------------
  const depth = new Map();
  const order = new Map();
  const hidden = new Set();
  let maxDepth = 0;
  let index = 0;

  const visit = (feature, level, hiddenByAncestor) => {
    const id = String(feature.id);
    if (order.has(id)) return; // cycle guard
    depth.set(id, level);
    order.set(id, index);
    index += 1;
    if (level > maxDepth) maxDepth = level;
    if (hiddenByAncestor) hidden.add(id);

    const children = visible.map.get(id);
    if (children === undefined) return;
    const foldedHere = hiddenByAncestor || collapsed.has(id);
    for (const child of [...children].sort(sortSiblings)) {
      visit(child, level + 1, foldedHere);
    }
  };

  for (const root of rootsOf(visibleFeatures, visible.byId).sort(sortSiblings)) {
    visit(root, 0, false);
  }

  // Tasks in a parent cycle are reachable from no root; render them at the top
  // level rather than dropping them off the board.
  for (const feature of [...visibleFeatures].sort(sortSiblings)) {
    visit(feature, 0, false);
  }

  // --- Subtree facts over the full dataset ---------------------------------
  const descendantCount = new Map();
  const visibleDescendantCount = new Map();
  const extent = new Map();
  const descendants = new Map();
  const visibleIds = visible.byId;

  for (const feature of allFeatures) {
    const id = String(feature.id);
    const subtree = collectDescendants(id, all.map);

    descendantCount.set(id, subtree.length);
    visibleDescendantCount.set(
      id,
      subtree.filter((child) => visibleIds.has(String(child.id))).length
    );

    const dated = subtree.filter((child) => child.start && child.end);
    descendants.set(
      id,
      dated.sort((a, b) => String(a.start).localeCompare(String(b.start)))
    );

    const starts = [feature, ...dated]
      .filter((entry) => entry.start)
      .map((entry) => String(entry.start))
      .sort();
    const ends = [feature, ...dated]
      .filter((entry) => entry.end)
      .map((entry) => String(entry.end))
      .sort();
    if (starts.length > 0 && ends.length > 0) {
      extent.set(id, { start: starts[0], end: ends[ends.length - 1] });
    }
  }

  return {
    depth,
    order,
    hidden,
    collapsed,
    descendantCount,
    visibleDescendantCount,
    extent,
    descendants,
    maxDepth,
  };
}

/**
 * Fold metadata for one task row: what the card needs to draw its chevron,
 * count badge, folded deck and comb.  Returns inert defaults when folding is
 * not active so every layout path can call it unconditionally.
 *
 * @param {ReturnType<typeof buildHierarchyModel>|null} hierarchy
 * @param {object} feature
 */
export function foldPropsFor(hierarchy, feature) {
  if (hierarchy === null) {
    return {
      hierarchyDepth: 0,
      foldable: false,
      collapsed: false,
      hiddenCount: 0,
      descendants: [],
      subtreeExtent: null,
    };
  }
  const id = String(feature.id);
  const subtree = hierarchy.extent.get(id);
  return {
    hierarchyDepth: hierarchy.depth.get(id),
    foldable: hierarchy.visibleDescendantCount.get(id) > 0,
    collapsed: hierarchy.collapsed.has(id),
    hiddenCount: hierarchy.descendantCount.get(id),
    descendants: hierarchy.descendants.get(id),
    subtreeExtent: subtree === undefined ? null : subtree,
  };
}

/**
 * Depth choices to offer for a tree of `maxDepth`, always ending in "All".
 *
 * @param {number} maxDepth Deepest nesting level present (0 = nothing nested)
 * @returns {{ label: string, depth: number }[]} Empty when nothing is nested.
 */
export function foldDepthOptions(maxDepth) {
  if (maxDepth < 1) return [];
  const options = [];
  for (let level = 1; level <= maxDepth; level += 1) {
    options.push({ label: String(level), depth: level });
  }
  options.push({ label: 'All', depth: maxDepth + 1 });
  return options;
}

/**
 * Ids that must be folded so only `depth` levels of rows remain visible.
 *
 * Parents deeper than the cut are included even though an ancestor already
 * hides them, so stepping the depth back up restores one level at a time.
 *
 * @param {ReturnType<typeof buildHierarchyModel>} model
 * @param {number} depth Number of visible levels; 1 leaves only root rows.
 * @returns {Set<string>}
 */
export function collapseToDepth(model, depth) {
  const folded = new Set();
  for (const [id, level] of model.depth.entries()) {
    if (level < depth - 1) continue;
    if (model.visibleDescendantCount.get(id) > 0) folded.add(id);
  }
  return folded;
}
