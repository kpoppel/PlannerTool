/**
 * groupBandLayout.js
 *
 * Pure layout helpers for rendering group pills and feature cards on the board.
 *
 * Extracted from FeatureBoard so the component stays focused on Lit rendering
 * and lifecycle.  No DOM or Lit imports — all functions take explicit inputs
 * and return plain data structures.
 *
 * Ordering model
 * --------------
 * Groups and tasks share one ordering scale.  A task's key is its position in
 * the globally sorted task list, spaced `RANK_GAP` apart; a group's key is its
 * stored `rank`.  Every level of the tree — the board root and the inside of
 * each group — is a single stream of rows sorted by that key, so a group band
 * can sit anywhere among the tasks rather than always above them.  There is no
 * separate "Ungrouped" band: tasks that belong to no group are simply rows at
 * the root level.
 *
 * Exports:
 *   packIntoRows(bars)
 *   buildGroupBandItems(orderedFeatures, planGroups, topOffset, months, condensed, packed, collapsedGroups)
 *   resolveInsertionSlot(items, y, bottomY)
 *   resolveGroupDropSlot(items, groupId, y, bottomY)
 */
import { computePosition, laneHeight } from './board-utils.js';
import { sel } from '../application/imports.js';
import { RANK_GAP, rankBetween } from '../application/shared/ordering.js';

/** Height of a group pill row in px. */
export const GROUP_PILL_HEIGHT = 28;

/**
 * Greedy interval-packing: place each bar in the first sub-row where it does
 * not overlap any already-placed bar.
 *
 * @param {{ left: number, width: number, feature: object }[]} bars — sorted by left
 * @returns {Array<Array<{ left: number, width: number, feature: object }>>}
 */
export function packIntoRows(bars) {
  const GAP = 4; // minimum horizontal gap between bars (px)
  const rowEnds = []; // tracks rightmost edge of each row
  const rows = [];
  for (const bar of bars) {
    const right = bar.left + bar.width;
    let placed = false;
    for (let r = 0; r < rowEnds.length; r++) {
      if (bar.left >= rowEnds[r] + GAP) {
        rows[r].push(bar);
        rowEnds[r] = right;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([bar]);
      rowEnds.push(right);
    }
  }
  return rows;
}

/** Normalize a parent reference so null / undefined / '' all mean "root level". */
function parentKey(parentId) {
  if (parentId === null || parentId === undefined || parentId === '') return '';
  return String(parentId);
}

/**
 * Map a vertical board position onto the group insertion slot it points at.
 *
 * Two placements are derived from a single y:
 *   - the *sibling* slot: the new group goes between the two rows the cursor
 *     sits between, under the same parent, so the caret lands exactly on the
 *     row that will be pushed down.  The neighbouring rows may be group pills
 *     or task cards — both carry a key on the shared ordering scale.
 *   - the *container*: the deepest band the cursor is inside, offered as
 *     "new sub-group in X" so nesting is reachable at any depth.
 *
 * Depth is taken from the y position alone: the board positions pills by the
 * date range of their tasks, so horizontal position carries no nesting
 * information.
 *
 * @param {Array}  items    Render items from buildGroupBandItems (board order)
 * @param {number} y        Cursor position in board coordinates (px from board top)
 * @param {number} bottomY  Bottom of the rendered board, used when nothing follows
 * @returns {{ planId: string|null, parentId: string|null, rank: number, caretTop: number,
 *            rankUpdates: { id: string, rank: number }[],
 *            container: { id: string, name: string, caretTop: number }|null }}
 */
export function resolveInsertionSlot(items, y, bottomY) {
  const rows = items.filter((item) => Number.isInteger(item.slotRank));
  const pills = rows.filter((item) => item.isGroup);

  const enclosing = pills.filter((item) => item.top <= y);
  const anchor = enclosing[enclosing.length - 1];
  const container = anchor === undefined
    ? null
    : {
      id: String(anchor.id),
      name: anchor.groupObj.name,
      caretTop: anchor.top + GROUP_PILL_HEIGHT,
    };

  const next = rows.find((item) => item.top > y);
  const parentId = next === undefined ? null : next.slotParentId;
  const caretTop = next === undefined ? bottomY : next.top;
  const planId = pills.length === 0 ? null : pills[0].groupObj.plan_id;

  const siblings = rows.filter((item) => parentKey(item.slotParentId) === parentKey(parentId));
  const before = next === undefined ? null : next;
  const precedingSiblings = siblings.filter(
    (item) => before === null || item.top < before.top
  );
  const previous = precedingSiblings[precedingSiblings.length - 1];

  const afterRank = previous === undefined ? null : previous.slotRank;
  const beforeRank = before === null ? null : before.slotRank;
  const rank = rankBetween(afterRank, beforeRank);
  if (rank !== null) {
    return { planId, parentId, rank, caretTop, rankUpdates: [], container };
  }

  // Neighbouring keys leave no integer between them — happens with groups
  // persisted before ranks were meaningful, which all share rank 0.  Respace
  // this level onto the shared scale and re-derive the slot from that.
  const insertIndex = precedingSiblings.length;
  const rankUpdates = siblings
    .map((item, index) => ({ item, rank: (index + 1) * RANK_GAP }))
    .filter((entry) => entry.item.isGroup && entry.item.slotRank !== entry.rank)
    .map((entry) => ({ id: String(entry.item.id), rank: entry.rank }));

  return {
    planId,
    parentId,
    rank: insertIndex * RANK_GAP + Math.floor(RANK_GAP / 2),
    caretTop,
    rankUpdates,
    container,
  };
}

/**
 * Resolve a one-step move slot for a group in the mixed task+group row stream.
 *
 * `direction='up'` moves the group before the previous row in the same parent
 * stream; `direction='down'` moves after the next row in that stream. Rows can
 * be either groups or tasks, so movement is relative to tasks too.
 *
 * @param {Array} items Render items from buildGroupBandItems (board order)
 * @param {string|number} groupId Group to move
 * @param {'up'|'down'} direction
 * @returns {{ parentId: string|null, rank: number, rankUpdates: { id: string, rank: number }[] }|null}
 */
export function resolveGroupMoveSlot(items, groupId, direction) {
  const rows = items.filter((item) => Number.isInteger(item.slotRank));
  const current = rows.find((item) => item.isGroup && String(item.id) === String(groupId));
  if (!current) return null;

  const parentId = current.slotParentId;
  const stream = rows.filter((item) => parentKey(item.slotParentId) === parentKey(parentId));
  const currentIndex = stream.findIndex(
    (item) => item.isGroup && String(item.id) === String(groupId)
  );
  if (currentIndex === -1) return null;

  if (direction === 'up' && currentIndex === 0) return null;
  if (direction === 'down' && currentIndex === stream.length - 1) return null;

  const withoutCurrent = stream.filter(
    (item) => !(item.isGroup && String(item.id) === String(groupId))
  );
  const insertIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

  const prev = insertIndex <= 0 ? null : withoutCurrent[insertIndex - 1];
  const next = insertIndex >= withoutCurrent.length ? null : withoutCurrent[insertIndex];
  const prevRank = prev === null ? null : prev.slotRank;
  const nextRank = next === null ? null : next.slotRank;

  const rank = rankBetween(prevRank, nextRank);
  if (rank !== null) {
    const normalizedParentId = parentId === null || parentId === undefined || parentId === ''
      ? null
      : parentId;
    return {
      parentId: normalizedParentId,
      rank,
      rankUpdates: [],
    };
  }

  const rankUpdates = withoutCurrent
    .map((item, index) => ({ item, rank: (index + 1) * RANK_GAP }))
    .filter((entry) => entry.item.isGroup && entry.item.slotRank !== entry.rank)
    .map((entry) => ({ id: String(entry.item.id), rank: entry.rank }));

  const normalizedParentId = parentId === null || parentId === undefined || parentId === ''
    ? null
    : parentId;
  return {
    parentId: normalizedParentId,
    rank: insertIndex * RANK_GAP + Math.floor(RANK_GAP / 2),
    rankUpdates,
  };
}

function collectGroupDescendants(items, groupId) {
  const groups = items.filter((item) => item.isGroup);
  const descendants = new Set([String(groupId)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      const groupObj = group.groupObj;
      const parentId = groupObj ? groupObj.parent_id : null;
      if (!parentId) continue;
      if (!descendants.has(String(parentId))) continue;
      if (descendants.has(String(group.id))) continue;
      descendants.add(String(group.id));
      changed = true;
    }
  }
  return descendants;
}

/**
 * Resolve a drag-drop insertion slot for moving an existing group.
 *
 * The dragged group and its descendants are removed from the hit-test stream,
 * so dropping inside the old subtree does not produce self/descendant parents.
 *
 * @param {Array} items Render items from buildGroupBandItems (board order)
 * @param {string|number} groupId Group being dragged
 * @param {number} y Cursor position in board coordinates
 * @param {number} bottomY Board bottom in board coordinates
 * @returns {{ parentId: string|null, rank: number, rankUpdates: { id: string, rank: number }[], caretTop: number }|null}
 */
export function resolveGroupDropSlot(items, groupId, y, bottomY) {
  const descendants = collectGroupDescendants(items, groupId);
  const filtered = items.filter((item) => {
    if (item.isGroup && descendants.has(String(item.id))) return false;
    if (item.slotParentId && descendants.has(String(item.slotParentId))) return false;
    return true;
  });

  const slot = resolveInsertionSlot(filtered, y, bottomY);
  return {
    parentId: slot.parentId,
    rank: slot.rank,
    rankUpdates: slot.rankUpdates,
    caretTop: slot.caretTop,
  };
}

/**
 * Build render items (group pills + feature cards) for a single plan.
 *
 * Works for both normal and packed display modes:
 *   - packed=false: each feature occupies one full lane row (laneHeight px)
 *   - packed=true:  consecutive task rows are packed horizontally;
 *                   unplanned features (no start/end) are skipped
 *
 * @param {Array}   orderedFeatures  Visible features already sorted by rank/date
 * @param {Array}   planGroups       All groups for this plan (from GroupService)
 * @param {number}  topOffset        Starting y-position in px
 * @param {Date[]}  months           Timeline months from getTimelineMonths()
 * @param {boolean} condensed        Use condensed card height (normal mode)
 * @param {boolean} packed           Pack consecutive task rows horizontally
 * @param {Set<string>} collapsedGroups  Set of collapsed group IDs
 * @returns {{ items: Array, totalHeight: number }}
 */
export function buildGroupBandItems(
  orderedFeatures, planGroups, topOffset, months, condensed, packed, collapsedGroups
) {
  const items = [];
  const planGroupIds = new Set(planGroups.map((g) => String(g.id)));
  const featureSortMode = sel.view.getFeatureSortMode();

  // Phase 3 replaces this with a persisted PlannerTool sort key; until then a
  // task without a fetch-order rank sorts first rather than failing the render.
  const rankOf = (feature) =>
    (Number.isInteger(feature.originalRank) ? feature.originalRank : 0);

  const sortFeatures = (features) => {
    const sorted = [...features];
    if (featureSortMode === 'date') {
      sorted.sort((a, b) => {
        if (!a.start && !b.start) return rankOf(a) - rankOf(b);
        if (!a.start) return 1;
        if (!b.start) return -1;
        const byDate = String(a.start).localeCompare(String(b.start));
        if (byDate !== 0) return byDate;
        return rankOf(a) - rankOf(b);
      });
      return sorted;
    }
    sorted.sort((a, b) => rankOf(a) - rankOf(b));
    return sorted;
  };

  // The shared ordering scale: a task's key is its position in the globally
  // sorted task list, spaced like group ranks so a group can be ranked between
  // any two tasks.
  const taskRankById = new Map(
    sortFeatures(orderedFeatures).map((f, index) => [String(f.id), (index + 1) * RANK_GAP])
  );
  const featureById = new Map(orderedFeatures.map((f) => [String(f.id), f]));

  // groupId → its member features that are actually visible
  const memberIds = (group) => (group.members === undefined ? [] : group.members);
  const featuresByGroup = new Map();
  const childGroupsByParent = new Map();
  for (const group of planGroups) {
    featuresByGroup.set(
      String(group.id),
      memberIds(group).map((taskId) => featureById.get(String(taskId))).filter(Boolean)
    );
    childGroupsByParent.set(String(group.id), []);
  }

  const allGroupedIds = new Set(planGroups.flatMap((g) => memberIds(g).map(String)));
  const rootFeatures = orderedFeatures.filter((f) => !allGroupedIds.has(String(f.id)));

  const rootGroups = [];
  for (const group of planGroups) {
    if (group.parent_id && planGroupIds.has(String(group.parent_id))) {
      childGroupsByParent.get(String(group.parent_id)).push(group);
    } else {
      rootGroups.push(group);
    }
  }

  /** Compute pill left/width, falling back to today → today+1 month for empty groups. */
  const pillPosition = (start, end) => {
    if (start && end) return computePosition({ start, end }, months);
    const today = new Date();
    const next = new Date(today);
    next.setMonth(today.getMonth() + 1);
    const fmt = (d) => d.toISOString().slice(0, 10);
    return computePosition({ start: fmt(today), end: fmt(next) }, months);
  };

  // Groups persisted before ranks were meaningful sort last; the first edit
  // under that parent respaces them onto the shared scale.
  const groupRank = (group) =>
    Number.isInteger(group.rank) ? group.rank : Number.MAX_SAFE_INTEGER;

  let rowTop = topOffset;
  const teams = sel.selection.getTeams();
  const projects = sel.selection.getProjects();
  const projectById = new Map(projects.map((project) => [String(project.id), project]));
  const projectFor = (feature) => {
    const project = projectById.get(String(feature.project));
    return project === undefined ? null : project;
  };

  const groupById = new Map(planGroups.map((group) => [String(group.id), group]));

  /** Push feature card render items for a run of consecutive task rows. */
  const addFeatureRows = (features, slotParentId) => {
    // Colour of the group that *directly* owns these rows, so a card nested
    // deeper in the tree still reads as belonging to its immediate parent.
    const owner = groupById.get(String(slotParentId));
    const groupColor = owner === undefined ? null : owner.color;

    if (packed) {
      const bars = features
        .filter((f) => f.start && f.end)
        .map((f) => {
          const p = computePosition(f, months);
          return p ? { left: p.left, width: p.width, feature: f } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.left - b.left);
      const rows = packIntoRows(bars);
      rows.forEach((row, rowIndex) => {
        const top = rowTop + rowIndex * laneHeight();
        for (const bar of row) {
          items.push({
            feature: bar.feature,
            left: bar.left,
            width: bar.width,
            top,
            teams,
            condensed: true,
            hideGhostTitle: true,
            project: projectFor(bar.feature),
            groupColor,
            slotParentId,
            slotRank: taskRankById.get(String(bar.feature.id)),
          });
        }
      });
      rowTop += Math.max(rows.length, 0) * laneHeight();
      return;
    }

    for (const feature of features) {
      const fpos = computePosition(feature, months);
      items.push({
        feature,
        left: fpos === null ? 0 : fpos.left,
        width: fpos === null ? 0 : fpos.width,
        top: rowTop,
        teams,
        condensed,
        hideGhostTitle: false,
        project: projectFor(feature),
        groupColor,
        slotParentId,
        slotRank: taskRankById.get(String(feature.id)),
      });
      rowTop += laneHeight();
    }
  };

  /** Aggregate dates from a group and all its descendants for the pill span. */
  const collectDates = (groupId) => {
    const direct = featuresByGroup.get(String(groupId));
    const starts = direct.map((f) => f.start).filter(Boolean);
    const ends = direct.map((f) => f.end).filter(Boolean);
    for (const child of childGroupsByParent.get(String(groupId))) {
      const sub = collectDates(child.id);
      starts.push(...sub.starts);
      ends.push(...sub.ends);
    }
    return { starts, ends };
  };

  /**
   * Render one level as a single stream: the level's child groups and its own
   * tasks, interleaved by their key on the shared ordering scale.
   */
  const renderLevel = (groups, features, parentId, depth) => {
    const nodes = [
      ...groups.map((group) => ({ rank: groupRank(group), group })),
      ...features.map((feature) => ({
        rank: taskRankById.get(String(feature.id)),
        feature,
      })),
    ].sort((a, b) => a.rank - b.rank);

    let taskRun = [];
    const flushTasks = () => {
      if (taskRun.length === 0) return;
      addFeatureRows(taskRun, parentId);
      taskRun = [];
    };

    for (const node of nodes) {
      if (node.feature) {
        taskRun.push(node.feature);
        continue;
      }
      flushTasks();
      renderGroup(node.group, parentId, depth);
    }
    flushTasks();
  };

  /** Render one group pill followed by its contents, unless it is collapsed. */
  const renderGroup = (group, parentId, depth) => {
    const { starts, ends } = collectDates(group.id);
    starts.sort();
    ends.sort();
    const pillStart = starts.length === 0 ? null : starts[0];
    const pillEnd = ends.length === 0 ? null : ends[ends.length - 1];
    const pos = pillPosition(pillStart, pillEnd);
    const groupFeatures = featuresByGroup.get(String(group.id));

    items.push({
      isGroup: true,
      id: group.id,
      groupObj: group,
      name: group.name,
      color: group.color ? group.color : null,
      left: pos ? pos.left : 0,
      width: pos ? pos.width : 0,
      top: rowTop,
      start: pillStart,
      end: pillEnd,
      featureCount: groupFeatures.length,
      depth,
      slotParentId: parentId,
      slotRank: groupRank(group),
    });
    rowTop += GROUP_PILL_HEIGHT;

    if (collapsedGroups.has(String(group.id))) return;
    renderLevel(
      childGroupsByParent.get(String(group.id)),
      groupFeatures,
      String(group.id),
      depth + 1
    );
  };

  renderLevel(rootGroups, rootFeatures, null, 0);

  return { items, totalHeight: rowTop - topOffset };
}
