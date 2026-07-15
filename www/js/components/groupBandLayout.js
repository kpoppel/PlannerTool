/**
 * groupBandLayout.js
 *
 * Pure layout helpers for rendering group pills and feature cards on the board.
 *
 * Extracted from FeatureBoard so the component stays focused on Lit rendering
 * and lifecycle.  No DOM or Lit imports — all functions take explicit inputs
 * and return plain data structures.
 *
 * Exports:
 *   packIntoRows(bars)
 *   buildGroupBandItems(orderedFeatures, planGroups, topOffset, months, condensed, packed, collapsedGroups, planId)
 */
import * as boardUtils from './board-utils.js';
import { applicationApi as state } from '../application/plannerApplication.js';

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

/**
 * Build render items (group pills + feature cards) for a single plan's groups.
 *
 * Works for both normal and packed display modes:
 *   - packed=false: each feature occupies one full lane row (laneHeight px)
 *   - packed=true:  features within each group are packed horizontally;
 *                   unplanned features (no start/end) are skipped
 *
 * @param {Array}   orderedFeatures  Visible features already sorted by rank/date
 * @param {Array}   planGroups       All groups for this plan (from GroupService)
 * @param {number}  topOffset        Starting y-position in px
 * @param {Date[]}  months           Timeline months from getTimelineMonths()
 * @param {boolean} condensed        Use condensed card height (normal mode)
 * @param {boolean} packed           Pack features horizontally within groups
 * @param {Set<string>} collapsedGroups  Set of collapsed group IDs
 * @param {string}  [planId]         Plan ID — used to scope the Ungrouped pill
 *                                   collapse key so different plans don't share it
 * @returns {{ items: Array, totalHeight: number }}
 */
export function buildGroupBandItems(
  orderedFeatures, planGroups, topOffset, months, condensed, packed, collapsedGroups, planId
) {
  // Plan-scoped key for the Ungrouped pill so each plan collapses independently.
  const ungroupedId = `__ungrouped__:${planId ?? planGroups[0]?.plan_id ?? 'unknown'}`;
  const items = [];

  // featuresByGroup: groupId → features in that group
  // Membership is determined by group.members (list of task IDs on the group)
  const planGroupIds = new Set(planGroups.map((g) => String(g.id)));
  const featuresByGroup = new Map();

  // Index features by id for O(1) lookup
  const featureById = new Map(orderedFeatures.map((f) => [String(f.id), f]));

  // Populate featuresByGroup from group.members lists
  for (const group of planGroups) {
    const members = group.members || [];
    const groupFeatures = members
      .map((taskId) => featureById.get(String(taskId)))
      .filter(Boolean);
    featuresByGroup.set(String(group.id), groupFeatures);
  }

  // Ungrouped: features not in any group's members list
  const allGroupedIds = new Set(
    planGroups.flatMap((g) => (g.members || []).map(String))
  );
  const ungroupedFeatures = orderedFeatures.filter(
    (f) => !allGroupedIds.has(String(f.id))
  );

  // Parent → direct children map for sub-group tree traversal
  const childGroupsByParent = new Map();
  for (const g of planGroups) {
    if (g.parent_id && planGroupIds.has(String(g.parent_id))) {
      const key = String(g.parent_id);
      if (!childGroupsByParent.has(key)) childGroupsByParent.set(key, []);
      childGroupsByParent.get(key).push(g);
    }
  }

  /** Compute pill left/width, falling back to today → today+1 month for empty groups. */
  const pillPosition = (start, end) => {
    if (start && end) return boardUtils.computePosition({ start, end }, months);
    const today = new Date();
    const next = new Date(today);
    next.setMonth(today.getMonth() + 1);
    const fmt = (d) => d.toISOString().slice(0, 10);
    return boardUtils.computePosition({ start: fmt(today), end: fmt(next) }, months);
  };

  /** Sort groups by earliest child start date, then by rank. */
  const sortGroupList = (groups) =>
    [...groups].sort((a, b) => {
      const aFeats = featuresByGroup.get(String(a.id)) || [];
      const bFeats = featuresByGroup.get(String(b.id)) || [];
      const aStart = aFeats.map((f) => f.start).filter(Boolean).sort()[0] || '';
      const bStart = bFeats.map((f) => f.start).filter(Boolean).sort()[0] || '';
      if (aStart && bStart) return aStart.localeCompare(bStart);
      if (aStart) return -1;
      if (bStart) return 1;
      return (a.rank ?? 0) - (b.rank ?? 0);
    });

  let rowTop = topOffset;

  /** Push feature card render items for a list of features (flat or packed). */
  const addFeatureRows = (features) => {
    if (packed) {
      const plannedFeatures = features.filter((f) => f.start && f.end);
      const bars = plannedFeatures
        .map((f) => {
          const p = boardUtils.computePosition(f, months);
          return p ? { left: p.left, width: p.width, feature: f } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.left - b.left);

      if (bars.length === 0 && plannedFeatures.length > 0) {
        for (const feature of plannedFeatures) {
          items.push({
            feature,
            left: 0,
            width: 0,
            top: rowTop,
            teams: state.selection.getTeams(),
            condensed: true,
            hideGhostTitle: true,
            project: state.selection.getProjects().find((p) => p.id === feature.project),
          });
          rowTop += boardUtils.laneHeight();
        }
        return;
      }

      const rows = packIntoRows(bars);
      rows.forEach((row, rowIndex) => {
        const top = rowTop + rowIndex * boardUtils.laneHeight();
        for (const bar of row) {
          items.push({
            feature: bar.feature,
            left: bar.left,
            width: bar.width,
            top,
            teams: state.selection.getTeams(),
            condensed: true,
            hideGhostTitle: true,
            project: state.selection.getProjects().find((p) => p.id === bar.feature.project),
          });
        }
      });
      rowTop += Math.max(rows.length, 0) * boardUtils.laneHeight();
    } else {
      for (const feature of features) {
        const fpos = boardUtils.computePosition(feature, months) || {};
        items.push({
          feature,
          left: fpos.left ?? 0,
          width: fpos.width ?? 0,
          top: rowTop,
          teams: state.selection.getTeams(),
          condensed,
          hideGhostTitle: false,
          project: state.selection.getProjects().find((p) => p.id === feature.project),
        });
        rowTop += boardUtils.laneHeight();
      }
    }
  };

  /** Recursively render groups and their sub-groups (depth-first). */
  const renderGroupTree = (groupList, depth, parentCollapsed) => {
    for (const group of sortGroupList(groupList)) {
      // Aggregate dates from this group and all descendants for the pill span
      const collectDates = (gid) => {
        const direct = featuresByGroup.get(String(gid)) || [];
        const starts = direct.map((f) => f.start).filter(Boolean);
        const ends = direct.map((f) => f.end).filter(Boolean);
        for (const child of (childGroupsByParent.get(String(gid)) || [])) {
          const sub = collectDates(child.id);
          starts.push(...sub.starts);
          ends.push(...sub.ends);
        }
        return { starts, ends };
      };
      const { starts, ends } = collectDates(group.id);
      starts.sort();
      ends.sort();
      const pillStart = starts[0] || null;
      const pillEnd = ends[ends.length - 1] || null;
      const pos = pillPosition(pillStart, pillEnd);

      const isCollapsed = collapsedGroups.has(String(group.id));
      const groupFeatures = featuresByGroup.get(String(group.id)) || [];

      if (!parentCollapsed) {
        items.push({
          isGroup: true,
          id: group.id,
          groupObj: group,
          name: group.name,
          color: group.color || null,
          left: pos ? pos.left : 0,
          width: pos ? pos.width : 0,
          top: rowTop,
          start: pillStart,
          end: pillEnd,
          featureCount: groupFeatures.length,
          depth,
        });
        rowTop += 28;
      }

      if (!isCollapsed && !parentCollapsed) {
        addFeatureRows(groupFeatures);
      }

      const children = childGroupsByParent.get(String(group.id)) || [];
      if (children.length > 0) {
        renderGroupTree(children, depth + 1, parentCollapsed || isCollapsed);
      }
    }
  };

  const topLevelGroups = planGroups.filter(
    (g) => !g.parent_id || !planGroupIds.has(String(g.parent_id))
  );
  renderGroupTree(topLevelGroups, 0, false);

  // Ungrouped section — always shown so users can see unassigned features
  const isUngroupedCollapsed = collapsedGroups.has(ungroupedId);
  const uStarts = ungroupedFeatures.map((f) => f.start).filter(Boolean).sort();
  const uEnds = ungroupedFeatures.map((f) => f.end).filter(Boolean).sort();
  const uStart = uStarts[0] || null;
  const uEnd = uEnds[uEnds.length - 1] || null;
  const uPos = pillPosition(uStart, uEnd);

  items.push({
    isGroup: true,
    id: ungroupedId,
    groupObj: { id: ungroupedId, name: 'Ungrouped', color: null },
    name: 'Ungrouped',
    color: null,
    left: uPos ? uPos.left : 0,
    width: uPos ? uPos.width : 0,
    top: rowTop,
    start: uStart,
    end: uEnd,
    featureCount: ungroupedFeatures.length,
  });
  rowTop += 28;

  if (!isUngroupedCollapsed) {
    addFeatureRows(ungroupedFeatures);
  }

  return { items, totalHeight: rowTop - topOffset };
}
