/**
 * Module: SwimlaneLayout
 * Intent: Pure layout engine for plan summary (swimlane) mode.
 *
 * Takes features, summary groups, selected projects, and timeline months and produces
 * a layout descriptor that FeatureBoard can render directly.
 *
 * Layout rules:
 *  - One swimlane per selected project that has visible features.
 *  - Features that belong to a group are represented by the group bar instead
 *    of individual bars (when the group is collapsed, members are invisible).
 *  - Multiple non-overlapping bars on the same swimlane are packed onto the
 *    fewest sub-rows using a greedy interval-packing algorithm.
 *  - A group bar spans min(members.start) .. max(members.end).
 *
 * @typedef {{ type: 'feature'|'group', data: Object, left: number, width: number, top: number, projectId: string }} LayoutItem
 * @typedef {{ project: Object, offsetY: number, totalHeight: number, rows: LayoutItem[][] }} SwimlaneDef
 * @typedef {{ swimlanes: SwimlaneDef[], totalHeight: number }} SwimlaneLayoutResult
 */

import { computePosition } from './board-utils.js';
import { laneHeight } from './board-utils.js';

const MIN_WIDTH = 8; // px — minimum bar width

/**
 * Compute the pixel position of a bar given ISO date strings.
 * Returns { left, width } or null when dates are missing / off-timeline.
 *
 * @param {string} start - ISO date string
 * @param {string} end - ISO date string
 * @param {Date[]} months - Timeline months array
 * @returns {{ left: number, width: number }|null}
 */
function _positionFromDates(start, end, months) {
  if (!start || !end || !months || months.length === 0) return null;
  // Reuse the existing computePosition helper by passing a synthetic feature-like object
  const pos = computePosition({ start, end }, months);
  if (!pos) return null;
  return { left: pos.left, width: Math.max(MIN_WIDTH, pos.width) };
}

/**
 * Compute a group bar's date range from its member features.
 * @param {import('../services/SummaryGroupService.js').SummaryGroup} group
 * @param {Map<string, Object>} featuresById
 * @returns {{ start: string, end: string }|null}
 */
function _groupDateRange(group, featuresById) {
  let minStart = null;
  let maxEnd = null;

  for (const memberId of group.memberIds) {
    const feature = featuresById.get(memberId);
    if (!feature) continue;
    if (feature.start && (!minStart || feature.start < minStart)) minStart = feature.start;
    if (feature.end && (!maxEnd || feature.end > maxEnd)) maxEnd = feature.end;
  }

  if (!minStart || !maxEnd) return null;
  return { start: minStart, end: maxEnd };
}

/**
 * Greedy interval packing: place each item in the first sub-row where it doesn't
 * overlap any already-placed item.  Returns an array of rows, each row being an
 * array of items.
 *
 * @param {{ left: number, width: number, item: Object }[]} bars - Sorted by left
 * @returns {Object[][]} rows of items
 */
function _packIntoRows(bars) {
  /** @type {{ right: number }[]} tracks the rightmost edge of each row */
  const rowEnds = [];
  /** @type {Object[][]} */
  const rows = [];
  const GAP = 4; // minimum horizontal gap between bars (px)

  for (const { left, width, item } of bars) {
    const right = left + width;
    let placed = false;
    for (let r = 0; r < rowEnds.length; r++) {
      if (left >= rowEnds[r] + GAP) {
        rows[r].push(item);
        rowEnds[r] = right;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([item]);
      rowEnds.push(right);
    }
  }

  return rows;
}

/**
 * Build the full swimlane layout.
 *
 * @param {Object[]} features - All effective features (already filtered by state)
 * @param {import('../services/SummaryGroupService.js').SummaryGroup[]} groups
 * @param {Object[]} selectedProjects - Projects with .selected === true
 * @param {Date[]} months - Timeline months array
 * @param {number} [rowHeight] - Height per packed row (defaults to laneHeight())
 * @returns {SwimlaneLayoutResult}
 */
export function buildSwimlaneLayout(features, groups, selectedProjects, months, rowHeight) {
  const ROW_H = rowHeight ?? laneHeight();
  const SWIMLANE_PADDING = 8; // vertical padding inside each swimlane (top + bottom)
  const LABEL_H = 20; // px reserved for the project name label at top of swimlane

  const featuresById = new Map(features.map((f) => [String(f.id), f]));

  // Determine which feature IDs are members of a (non-dissolved) group
  const groupedFeatureIds = new Set();
  for (const g of groups) {
    for (const id of g.memberIds) groupedFeatureIds.add(id);
  }

  // Build a Map: projectId -> list of bars (items) to lay out
  /** @type {Map<string, Array<{ left: number, width: number, item: Object }>>} */
  const projectBars = new Map();

  for (const project of selectedProjects) {
    projectBars.set(String(project.id), []);
  }

  // --- Group bars ---
  for (const group of groups) {
    const projId = String(group.projectId);
    if (!projectBars.has(projId)) continue;

    const dateRange = _groupDateRange(group, featuresById);
    if (!dateRange) continue;

    const pos = _positionFromDates(dateRange.start, dateRange.end, months);
    if (!pos) continue;

    projectBars.get(projId).push({
      left: pos.left,
      width: pos.width,
      item: {
        type: 'group',
        data: group,
        left: pos.left,
        width: pos.width,
        projectId: projId,
      },
    });

    // When collapsed, do NOT add individual member bars (handled below by skip)
  }

  // --- Individual feature bars ---
  // Iterate the deduped map to prevent duplicate feature IDs from producing two bars
  // (getEffectiveFeatures() can return the same ID in both the baseline and scenario
  // overlay slices when a scenario is active).
  for (const feature of featuresById.values()) {
    const projId = String(feature.project);
    if (!projectBars.has(projId)) continue;

    let memberGroup = null;
    // Skip features that belong to a group (collapsed OR not — they are represented by the group bar)
    if (groupedFeatureIds.has(String(feature.id))) {
      memberGroup = groups.find((g) => g.memberIds.has(String(feature.id)));
      // Show individual bar only when the group exists and is NOT collapsed
      if (!memberGroup || memberGroup.collapsed) continue;
    }

    if (!feature.start || !feature.end) continue; // skip unplanned in summary mode

    const pos = _positionFromDates(feature.start, feature.end, months);
    if (!pos) continue;

    projectBars.get(projId).push({
      left: pos.left,
      width: pos.width,
      item: {
        type: 'feature',
        data: feature,
        left: pos.left,
        width: pos.width,
        projectId: projId,
        groupColor: memberGroup?.color ?? null,
      },
    });
  }

  // --- Build swimlane descriptors ---
  const swimlanes = [];
  let offsetY = 0;

  for (const project of selectedProjects) {
    const projId = String(project.id);
    const bars = projectBars.get(projId) ?? [];

    // Sort by start position for packing
    bars.sort((a, b) => a.left - b.left);

    const rows = bars.length > 0 ? _packIntoRows(bars) : [[]];

    // Assign top within swimlane: LABEL_H + rowIndex * ROW_H
    const layoutRows = rows.map((rowItems, rowIndex) =>
      rowItems.map((item) => ({
        ...item,
        top: offsetY + LABEL_H + rowIndex * ROW_H,
      }))
    );

    const swimlaneHeight = LABEL_H + rows.length * ROW_H + SWIMLANE_PADDING;

    swimlanes.push({
      project,
      offsetY,
      totalHeight: swimlaneHeight,
      rows: layoutRows,
    });

    offsetY += swimlaneHeight;
  }

  return { swimlanes, totalHeight: offsetY };
}

/**
 * Flatten all layout items from all swimlanes into a single array suitable
 * for FeatureBoard.features.
 *
 * @param {SwimlaneLayoutResult} layout
 * @param {Object[]} teams - Teams array for passing to feature cards
 * @param {boolean} [condensed] - Whether to render cards in condensed mode (follows sidebar Display setting)
 * @returns {Object[]} Flat render list compatible with FeatureBoard
 */
export function flattenSwimlaneLayout(layout, teams, condensed = false) {
  const items = [];
  for (const swimlane of layout.swimlanes) {
    for (const row of swimlane.rows) {
      for (const item of row) {
        if (item.type === 'feature') {
          items.push({
            _layoutType: 'feature',
            feature: item.data,
            left: item.left,
            width: item.width,
            top: item.top,
            teams,
            condensed, // respects the sidebar Display mode setting
            project: swimlane.project,
            groupColor: item.groupColor ?? null,
          });
        } else if (item.type === 'group') {
          items.push({
            _layoutType: 'group',
            group: item.data,
            left: item.left,
            width: item.width,
            top: item.top,
            project: swimlane.project,
            condensed,
          });
        }
      }
    }
  }
  return items;
}
