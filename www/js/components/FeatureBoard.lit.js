import { LitElement, html, repeat } from '../vendor/lit.js';
import {
  ProjectEvents,
  TeamEvents,
  TimelineEvents,
  FeatureEvents,
  FilterEvents,
  ScenarioEvents,
  ViewEvents,
  GroupEvents,
  AppEvents,
  UIEvents,
  BoardEvents,
} from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { cmd, sel } from '../application/imports.js';
import { boardCoords } from '../services/BoardCoordinateService.js';
import { getTimelineMonths, TIMELINE_CONFIG } from './Timeline.lit.js';
import { laneHeight, computePosition } from './board-utils.js';
import { findInBoard } from './board-utils.js';
import { addDays, formatDate, parseDate } from './util.js';
import {
  isSwimlaneMode,
  buildSwimlaneList,
  assignFeatureToSwimlane,
  SWIMLANE_BAND_GAP_PX,
} from '../services/SwimlaneService.js';
import { featureBoardStyles } from './FeatureBoard.styles.js';
import {
  buildGroupBandItems,
  packIntoRows,
  resolveGroupDropSlot,
  resolveGroupMoveSlot,
  resolveInsertionSlot,
} from './groupBandLayout.js';
import './FeatureGroup.lit.js';
export { initBoard } from './FeatureBoard.init.js';

class FeatureBoard extends LitElement {
  static LARGE_RENDER_THRESHOLD = 250;
  static INITIAL_RENDER_CHUNK = 150;
  static RENDER_CHUNK_SIZE = 200;
  static VIRTUALIZE_OVERSCAN_Y = 600;
  static VIRTUALIZE_OVERSCAN_X = 240;

  static properties = {
    features: { type: Array },
    _insertionCaretTop: { state: true },
  };

  constructor() {
    super();
    this.features = [];
    this._cardMap = new Map();
    this._boundHandlers = new Map();
    // Swimlane geometry — populated by renderFeatures() when swimlane mode is active.
    // Each entry: { id, name, color, type, topPx, heightPx }
    this._swimlanes = [];
    // Set of group IDs the user has collapsed.
    this._collapsedGroups = new Set();
    this._handleViewportResize = this._updateSwimlaneLabelStickyTop.bind(this);
    this._overlayOffset = 0;
    this._renderGeneration = 0;
    this._fullRenderList = [];
    this._boardHeight = 0;
    this._insertionCaretTop = null;
    this._viewportRenderScheduled = false;
    this._viewportUnsubscribe = null;
  }

  static styles = featureBoardStyles;

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('role')) {
      this.setAttribute('role', 'list');
    }
    window.addEventListener('resize', this._handleViewportResize);
    this._updateSwimlaneLabelStickyTop();
    this._onOverlayOffsetChanged = ({ offset }) => {
      if (offset !== this._overlayOffset) {
        this._overlayOffset = offset;
        this.renderFeatures();
      }
    };
    bus.on(BoardEvents.OVERLAY_OFFSET_CHANGED, this._onOverlayOffsetChanged);
    this._onPresentationScopeChanged = () => {
      this.renderFeatures();
    };
    this._boundHandlers.set(FilterEvents.CHANGED, this._onPresentationScopeChanged);
    bus.on(FilterEvents.CHANGED, this._onPresentationScopeChanged);
    this._viewportUnsubscribe = boardCoords.subscribe(() => {
      this._scheduleViewportRender();
    });
  }

  _updateSwimlaneLabelStickyTop() {
    const scrollContainer = findInBoard('#scroll-container');
    const stickyTop =
      scrollContainer && scrollContainer.clientHeight ?
        Math.round(scrollContainer.clientHeight / 2)
      : 24;
    this.style.setProperty('--swimlane-label-sticky-top', `${stickyTop}px`);
    this._scheduleViewportRender();
  }

  // Build and maintain connected feature sets (parent/child and relations)
  _computeConnectedSet(startFeature) {
    const features = sel.feature.getEffectiveFeatures();
    const idKey = (v) => String(v);
    const byId = new Map(features.map((f) => [idKey(f.id), f]));

    // children map
    const childrenMap = new Map();
    for (const f of features) {
      if (f.parentId) {
        const p = idKey(f.parentId);
        if (!childrenMap.has(p)) childrenMap.set(p, []);
        childrenMap.get(p).push(f);
      }
    }

    const startId = idKey(startFeature.id);
    const q = [startId];
    const seen = new Set([startId]);

    while (q.length) {
      const cur = q.shift();
      const f = byId.get(cur);
      if (!f) continue;
      // parent
      if (f.parentId) {
        const p = idKey(f.parentId);
        if (!seen.has(p)) {
          seen.add(p);
          q.push(p);
        }
      }
      // children
      const kids = childrenMap.get(cur) || [];
      for (const c of kids) {
        const cid = idKey(c.id);
        if (!seen.has(cid)) {
          seen.add(cid);
          q.push(cid);
        }
      }
      // relations (All types except "Related" which is too broad/noisy)
      if (Array.isArray(f.relations)) {
        for (const rel of f.relations) {
          let other = null;
          if (
            ['Parent', 'Child', 'Successor', 'Predecessor'].includes(rel.type) &&
            rel.id
          ) {
            other = idKey(rel.id);
          }
          if (other && !seen.has(other)) {
            seen.add(other);
            q.push(other);
          }
        }
      }
    }

    return Array.from(seen);
  }

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  render() {
    if (!this.features?.length && !this._swimlanes?.length) {
      return html`<slot></slot>`;
    }

    return html`
      ${this._swimlanes.length
        ? html`
            ${this._swimlanes.map(
              (s) => html`<div
                class="swimlane-band"
                style="top:${s.topPx}px; height:${s.heightPx}px; background: ${this._hexToRgba(s.color, 0.15)}; border-top: 2px solid ${this._hexToRgba(s.color, 0.3)};"
                aria-hidden="true"
              ></div>`
            )}
            <div class="swimlane-labels" aria-hidden="true">
              ${this._swimlanes.map(
                (s) => html`<div
                  class="swimlane-label-slot"
                  style="top:${s.topPx}px; height:${s.heightPx}px;"
                >
                  <div
                    class="swimlane-label type-${s.type}"
                    style="border-left-color:${s.color};"
                    title="${s.name}"
                  >
                    <span class="swimlane-label-text">${s.name}</span>
                    ${s.expansionOriginCount ?
                      html`<span class="swimlane-origin-wrap">
                        <span
                          class="swimlane-origin-indicator"
                          aria-label="${s.expansionOriginTooltip}"
                        >+${s.expansionOriginCount}</span>
                        <span class="swimlane-origin-tooltip" role="tooltip">
                          ${(s.expansionOrigins || []).map(
                            (origin) => html`<span class="swimlane-origin-item">
                              <span
                                class="swimlane-origin-swatch"
                                style="background:${origin.color || '#888'};"
                              ></span>
                              <span class="swimlane-origin-name">${origin.name}</span>
                            </span>`
                          )}
                        </span>
                      </span>`
                    : ''}
                  </div>
                </div>`
              )}
            </div>
          `
        : ''}
      ${repeat(
        this.features,
        (item) =>
          item.isGroup ?
            `g:${String(item.id ?? `${item.left}:${item.top}`)}`
          : `f:${String(item.feature?.id ?? `${item.left}:${item.top}`)}`,
        (item) => {
          const itemHeight = item.isGroup ? 28 : laneHeight();
          if (item.isGroup) {
            // Render as <feature-group> web component — it handles expand/collapse,
            // right-click context, and its own visual styling.
            return html`<feature-group
              .group=${item.groupObj}
              .start=${item.start}
              .end=${item.end}
              .featureCount=${item.featureCount}
              .collapsed=${this._collapsedGroups.has(String(item.id))}
              .depth=${item.depth ?? 0}
              style="position:absolute; left:${item.left}px; top:${item.top}px; width:${item.width}px; height:${itemHeight}px;"
              @group-toggle=${this._onGroupToggle}
              @group-context-menu=${this._onGroupContextMenuBubble}
              @group-drag-preview=${this._onGroupDragPreview}
              @group-drag-end=${this._onGroupDragEnd}
            ></feature-group>`;
          }
          return html`<feature-card-lit
            .feature=${item.feature}
            .bus=${bus}
            .teams=${item.teams}
            .condensed=${item.condensed}
            .project=${item.project}
            .groupColor=${item.groupColor}
            .hideGhostTitle=${!!item.hideGhostTitle}
            style="position:absolute; left:${item.left}px; top:${item.top}px; width:${item.width}px; height:${itemHeight}px"
          ></feature-card-lit>`;
        }
      )}
      ${this._insertionCaretTop === null
        ? ''
        : html`<div
            class="group-insertion-caret"
            part="group-insertion-caret"
            style="top:${this._insertionCaretTop}px;"
            aria-hidden="true"
          ></div>`}
    `;
  }

  // ---------------------------------------------------------------------------
  // Group insertion slot
  // ---------------------------------------------------------------------------

  /**
   * Resolve where a new group would be inserted for a viewport y position.
   * @param {number} clientY
   * @returns {{ planId: string|null, parentId: string|null, afterGroupId: string|null, caretTop: number }}
   */
  getInsertionSlotAt(clientY) {
    const boardTop = this.getBoundingClientRect().top;
    return resolveInsertionSlot(this._fullRenderList, clientY - boardTop, this._boardHeight);
  }

  /** Draw the insertion caret at a board-relative y position. */
  showInsertionCaret(caretTop) {
    this._insertionCaretTop = caretTop;
  }

  /** Remove the insertion caret. */
  clearInsertionCaret() {
    this._insertionCaretTop = null;
  }

  /** Resolve one-step group move placement in the mixed task+group stream. */
  getGroupMoveSlot(groupId, direction) {
    return resolveGroupMoveSlot(this._fullRenderList, groupId, direction);
  }

  /** Resolve a drag-drop slot for moving an existing group. */
  getGroupDropSlotAt(groupId, clientY) {
    const boardTop = this.getBoundingClientRect().top;
    return resolveGroupDropSlot(
      this._fullRenderList,
      groupId,
      clientY - boardTop,
      this._boardHeight
    );
  }

  /** Handle expand/collapse from a <feature-group>. */
  _onGroupToggle(e) {    const { groupId, collapsed } = e.detail;
    if (collapsed) {
      this._collapsedGroups.add(String(groupId));
    } else {
      this._collapsedGroups.delete(String(groupId));
    }
    // Re-layout: collapsed groups hide their children
    this.renderFeatures();
  }

  /** Relay group-context-menu up (already composed, but re-dispatch for TimelineBoard). */
  _onGroupContextMenuBubble(e) {
    // Already composed=true from FeatureGroup, so it will reach TimelineBoard.
    // Nothing extra needed — TimelineBoard listens on boardArea.
  }

  _onGroupDragPreview(e) {
    const detail = e.detail;
    const group = detail && detail.group;
    const groupId = group && group.id;
    if (!groupId) return;
    const dx = Number(e.detail.deltaX);
    const dy = Number(e.detail.deltaY);
    const horizontalDominant = Math.abs(dx) > Math.abs(dy);
    if (horizontalDominant) {
      this.clearInsertionCaret();
      return;
    }
    const slot = this.getGroupDropSlotAt(groupId, e.detail.clientY);
    if (!slot) return;
    this.showInsertionCaret(slot.caretTop);
  }

  _dateFromLeftPx(leftPx, months) {
    const monthWidth = TIMELINE_CONFIG.monthWidth;
    if (months.length === 0) return new Date();

    const relative = leftPx / monthWidth;
    let monthIndex = Math.floor(relative);
    let fraction = relative - monthIndex;
    if (monthIndex < 0) {
      monthIndex = 0;
      fraction = 0;
    }
    if (monthIndex >= months.length) {
      monthIndex = months.length - 1;
      fraction = 0.999;
    }

    const monthStart = months[monthIndex];
    const daysInMonth = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0
    ).getDate();
    let dayOffset = Math.round(fraction * (daysInMonth - 1));
    if (dayOffset < 0) dayOffset = 0;
    if (dayOffset > daysInMonth - 1) dayOffset = daysInMonth - 1;
    return new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + dayOffset);
  }

  _collectDescendantFeatureIds(rootId, allFeaturesById, childrenByParent) {
    const out = [];
    const queue = [String(rootId)];
    const seen = new Set([String(rootId)]);
    while (queue.length > 0) {
      const parentId = queue.shift();
      const children = childrenByParent.get(parentId);
      if (children === undefined) continue;
      for (const childId of children) {
        const key = String(childId);
        if (seen.has(key)) continue;
        seen.add(key);
        if (allFeaturesById.has(key)) out.push(key);
        queue.push(key);
      }
    }
    return out;
  }

  _shiftGroupContentsByDeltaX(groupObj, deltaX) {
    const groupRow = this._fullRenderList.find(
      (item) => item.isGroup && String(item.id) === String(groupObj.id)
    );
    if (!groupRow) return;

    const months = getTimelineMonths();
    const oldLeft = Number(groupRow.left);
    const newLeft = Math.max(0, oldLeft + deltaX);
    const oldDate = this._dateFromLeftPx(oldLeft, months);
    const newDate = this._dateFromLeftPx(newLeft, months);
    const deltaDays = Math.round((newDate.getTime() - oldDate.getTime()) / (1000 * 60 * 60 * 24));
    if (deltaDays === 0) return;

    const planId = String(groupObj.plan_id);
    const groups = sel.group.getEffectiveGroups(planId);
    const groupIds = new Set([String(groupObj.id)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of groups) {
        const parentId = group.parent_id;
        if (!parentId) continue;
        if (!groupIds.has(String(parentId))) continue;
        if (groupIds.has(String(group.id))) continue;
        groupIds.add(String(group.id));
        changed = true;
      }
    }

    const allFeatures = sel.feature.getEffectiveFeatures();
    const byId = new Map();
    for (const feature of allFeatures) byId.set(String(feature.id), feature);

    const childrenByParent = new Map();
    for (const feature of allFeatures) {
      let parentId = feature.parentId;
      if (!parentId && feature.relations) {
        const rel = feature.relations.find((entry) => entry.type === 'Parent');
        if (rel && rel.id) parentId = rel.id;
      }
      if (!parentId) continue;
      const key = String(parentId);
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(String(feature.id));
    }

    const featureIdsToShift = new Set();
    for (const group of groups) {
      if (!groupIds.has(String(group.id))) continue;
      const members = group.members === undefined ? [] : group.members;
      for (const memberId of members) {
        const key = String(memberId);
        if (!byId.has(key)) continue;
        featureIdsToShift.add(key);
        const descendants = this._collectDescendantFeatureIds(key, byId, childrenByParent);
        for (const descendantId of descendants) featureIdsToShift.add(descendantId);
      }
    }

    const updates = [];
    for (const featureId of featureIdsToShift) {
      const feature = byId.get(featureId);
      if (!feature) continue;
      if (!feature.start || !feature.end) continue;
      const shiftedStart = addDays(parseDate(feature.start), deltaDays);
      const shiftedEnd = addDays(parseDate(feature.end), deltaDays);
      updates.push({
        id: featureId,
        start: formatDate(shiftedStart),
        end: formatDate(shiftedEnd),
      });
    }

    if (updates.length === 0) return;
    cmd.feature.updateFeatureDates(updates);
  }

  _onGroupDragEnd(e) {
    const detail = e.detail;
    const group = detail && detail.group;
    const groupId = group && group.id;
    if (!groupId) {
      this.clearInsertionCaret();
      return;
    }

    const dx = Number(e.detail.deltaX);
    const dy = Number(e.detail.deltaY);
    const horizontalDominant = Math.abs(dx) > Math.abs(dy);
    if (horizontalDominant) {
      this.clearInsertionCaret();
      this._shiftGroupContentsByDeltaX(e.detail.group, dx);
      return;
    }

    const slot = this.getGroupDropSlotAt(groupId, e.detail.clientY);
    this.clearInsertionCaret();
    if (!slot) return;

    try {
      cmd.group.moveGroupInScenario(groupId, {
        parentId: slot.parentId,
        rank: slot.rank,
        rankUpdates: slot.rankUpdates,
      });
    } catch (err) {
      console.warn('[FeatureBoard] group drag move rejected', err);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._renderGeneration += 1;
    window.removeEventListener('resize', this._handleViewportResize);
    if (this._onOverlayOffsetChanged) {
      bus.off(BoardEvents.OVERLAY_OFFSET_CHANGED, this._onOverlayOffsetChanged);
    }
    if (this._onPresentationScopeChanged) {
      bus.off(FilterEvents.CHANGED, this._onPresentationScopeChanged);
    }
    this._viewportUnsubscribe?.();
    this._viewportUnsubscribe = null;
    this._boundHandlers.forEach((handler, event) => {
      bus.off(event, handler);
    });
    this._boundHandlers.clear();
  }

  // ---- Sorting / filtering helpers ----

  _sortByRank(features) {
    return features.sort((a, b) => (a.originalRank || 0) - (b.originalRank || 0));
  }

  _sortByDate(features) {
    return features.sort((a, b) => {
      if (!a.start && !b.start) return 0;
      if (!a.start) return 1;
      if (!b.start) return -1;
      return a.start.localeCompare(b.start);
    });
  }

  /**
   * Build a Map<parentId, child[]> from all items that have a parentId.
   * Covers any hierarchy depth — not limited to feature→epic links.
   */
  _buildChildrenMap(features) {
    const childrenMap = new Map();
    features.forEach((f) => {
      if (f.parentId) {
        if (!childrenMap.has(f.parentId)) childrenMap.set(f.parentId, []);
        childrenMap.get(f.parentId).push(f);
      }
    });
    return childrenMap;
  }

  /**
   * Order features hierarchically for N-level nesting via DFS.
   * Roots are items with no parentId. Their children (and grandchildren, etc.)
   * are inserted in sorted order immediately after each parent.
   */
  _orderFeaturesHierarchically(sourceFeatures, sortMode) {
    const sortFn =
      sortMode === 'rank' ? this._sortByRank.bind(this) : this._sortByDate.bind(this);
    const childrenMap = this._buildChildrenMap(sourceFeatures);
    childrenMap.forEach((children) => sortFn(children));

    // Roots are items with no parentId present in this dataset
    const sourceIds = new Set(sourceFeatures.map((f) => f.id));
    const roots = sortFn(
      sourceFeatures.filter((f) => !f.parentId || !sourceIds.has(f.parentId))
    );

    const ordered = [];
    const visited = new Set();

    const visit = (item) => {
      if (visited.has(item.id)) return;
      visited.add(item.id);
      ordered.push(item);
      const kids = childrenMap.get(item.id) || [];
      for (const child of kids) visit(child);
    };

    for (const root of roots) visit(root);

    // Append any remaining items not reachable from roots (guards against cycles)
    for (const f of sourceFeatures) {
      if (!visited.has(f.id)) ordered.push(f);
    }

    return ordered;
  }

  _isUnplanned(feature) {
    return !feature.start || !feature.end;
  }

  _isHierarchicallyLinkedToSelectedProjectEpics(
    feature,
    allFeatures,
    selectedProjectEpicIds,
    visited = new Set()
  ) {
    if (!feature) return false;
    if (visited.has(feature.id)) return false;
    visited.add(feature.id);
    if (selectedProjectEpicIds.has(feature.id)) return true;
    if (feature.parentId) {
      const parent = allFeatures.find((f) => f.id === feature.parentId);
      if (parent)
        return this._isHierarchicallyLinkedToSelectedProjectEpics(
          parent,
          allFeatures,
          selectedProjectEpicIds,
          visited
        );
    }
    if (Array.isArray(feature.relations)) {
      const parentRel = feature.relations.find((r) => r.type === 'Parent');
      if (parentRel?.id) {
        const parent = allFeatures.find((f) => f.id === parentRel.id);
        if (parent)
          return this._isHierarchicallyLinkedToSelectedProjectEpics(
            parent,
            allFeatures,
            selectedProjectEpicIds,
            visited
          );
      }
    }
    return false;
  }

  _featurePassesFilters(feature, childrenMap, allFeatures = [], visibleScopeIds = null) {
    const scopeIds = visibleScopeIds || new Set(
      sel.scope.getVisibleFeatures().map((visibleFeature) => String(visibleFeature.id))
    );
    if (!scopeIds.has(String(feature.id))) return false;

    const projects = sel.selection.getProjects();
    const expansionState = sel.view.getExpansionState();
    const hasExpansion =
      expansionState.expandParentChild ||
      expansionState.expandRelations ||
      expansionState.expandTeamAllocated;
    const expandedIds = hasExpansion ? sel.view.getExpandedFeatureIds() : new Set();
    const isExpansionVisible = hasExpansion && expandedIds.has(String(feature.id));

    if (hasExpansion) {
      // Expansion can pull in features from other projects or teams; once a feature
      // is in the expanded set, it must remain visible even when the project/team
      // filter would otherwise reject it.
      if (!isExpansionVisible) return false;
    }

    if (sel.view.getShowOnlyProjectHierarchy()) {
      const projectTypePlans = projects.filter((p) => {
        const planType = p.type ? String(p.type) : 'project';
        return p.selected && planType === 'project';
      });
      const projectTypePlanIds = new Set(projectTypePlans.map((p) => p.id));
      const projectTypeEpicIds = new Set(
        allFeatures
          .filter((f) => !f.parentId && projectTypePlanIds.has(f.project))
          .map((f) => f.id)
      );
      if (
        !this._isHierarchicallyLinkedToSelectedProjectEpics(
          feature,
          allFeatures,
          projectTypeEpicIds
        )
      )
        return false;
    }

    const stateFilter = sel.filter.getSelectedFeatureStateSet();
    if (stateFilter.size === 0) return false;

    // Build lowercase version of selected states for case-insensitive comparison
    const stateFilterLower = new Set(
      Array.from(stateFilter).map((s) => String(s).toLowerCase())
    );
    const featureStateLower = (feature.state || '').toLowerCase();
    if (!stateFilterLower.has(featureStateLower)) return false;

    // Apply task filters (schedule, allocation, hierarchy, relations)
    if (!sel.filter.featurePassesFilters(feature)) {
      return false;
    }

    if (!sel.view.isTypeVisible(feature.type)) return false;

    if (this._isUnplanned(feature) && !sel.view.getShowUnplannedWork()) {
      return false;
    }
    return true;
  }

  // ---- Render features ----

  /**
   * Greedy interval-packing: place each bar in the first sub-row where it does
   * not overlap any already-placed bar.  Returns an array of rows, each row
   * being an array of { left, width, feature } objects.
   *
   * @param {{ left: number, width: number, feature: Object }[]} bars - sorted by left
   * @returns {Array<Array<{ left: number, width: number, feature: Object }>>}
   */
  async renderFeatures() {
    this._updateSwimlaneLabelStickyTop();
    const rawFeatures = sel.feature.getEffectiveFeatures();
    // Deduplicate by feature ID — getEffectiveFeatures() can return the same ID
    // twice when a scenario overlay collides with a baseline entry, which would
    // produce duplicate cards in the render list.
    const seenIds = new Set();
    const sourceFeatures = rawFeatures.filter((f) => {
      const key = String(f.id);
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });
    const childrenMap = this._buildChildrenMap(sourceFeatures);
    const visibleScopeIds = new Set(
      sel.scope.getVisibleFeatures().map((visibleFeature) => String(visibleFeature.id))
    );
    const months = getTimelineMonths();
    const isPacked = sel.view.getPackedMode();
    const expansionState = sel.view.getExpansionState();
    const context = sel.view.getContext();
    const laneAssignmentState = {
      ...expansionState,
      expandParentChild:
        expansionState.expandParentChild || context.parent || context.child,
    };
    const visibleFeatures = [];
    for (const feature of sourceFeatures) {
      if (!this._featurePassesFilters(feature, childrenMap, sourceFeatures, visibleScopeIds)) continue;
      if (isPacked && (!feature.start || !feature.end)) continue;
      visibleFeatures.push(feature);
    }
    const selectedProjects = sel.selection.getProjects();
    const selectedTeams = sel.selection.getTeams();
    const candidateSwimlanes = buildSwimlaneList(
      selectedProjects,
      selectedTeams,
      expansionState,
      visibleFeatures,
      { includeExpandedPlans: true }
    );
    const swimlaneActive = isSwimlaneMode(
      selectedProjects,
      expansionState,
      candidateSwimlanes
    );

    let renderList;
    let totalHeight;

    if (swimlaneActive) {
      // -----------------------------------------------------------------------
      // Swimlane mode: group features per plan/team band and sort/pack each band
      // independently. Bands are stacked vertically with a gap between them.
      // -----------------------------------------------------------------------

      // Build a lookup for parent-chain walking in assignFeatureToSwimlane.
      // Use rawFeatures (pre-dedup, full set) so cross-project parent references resolve.
      const allFeaturesById = new Map(rawFeatures.map((f) => [String(f.id), f]));

      const swimlanes = candidateSwimlanes;

      const selectedProjectIds = new Set(
        selectedProjects.filter((p) => p.selected).map((p) => p.id)
      );
      const selectedTeamIds = new Set(
        selectedTeams.filter((t) => t.selected).map((t) => t.id)
      );

      // Group visible features into per-swimlane buckets
      const buckets = new Map(swimlanes.map((s) => [s.id, []]));
      for (const feature of visibleFeatures) {
        const sid = assignFeatureToSwimlane(
          feature,
          swimlanes,
          allFeaturesById,
          laneAssignmentState,
          selectedProjectIds,
          selectedTeamIds
        );
        const bucket = buckets.get(sid) ?? buckets.get(swimlanes[0]?.id);
        if (bucket) bucket.push(feature);
      }

      // Hide only empty expansion lanes; selected plan lanes remain visible even when empty.
      const hiddenExpansionLanes = new Map(
        swimlanes
          .filter((s) => {
            const isExpansion = s.type === 'expanded-plan' || s.type === 'team';
            const isEmpty = (buckets.get(s.id) || []).length === 0;
            return isExpansion && isEmpty;
          })
          .map((s) => [String(s.id), s])
      );

      // Full lookup of all swimlanes by ID — used for origin attribution in labels.
      const swimlaneById = new Map(swimlanes.map((s) => [String(s.id), s]));

      const swimlanesToRender = swimlanes.filter(
        (s) => s.type === 'plan' || !hiddenExpansionLanes.has(String(s.id))
      );

      // Render each swimlane band independently and accumulate vertical offsets
      renderList = [];
      let currentTop = this._overlayOffset;
      const swimlaneGeometry = [];

      for (const swimlane of swimlanesToRender) {
        const bucket = buckets.get(swimlane.id) || [];
        const swimlaneTop = currentTop;
        let swimlaneHeight = 0;
        const planOrigins = new Map();
        const teamOrigins = new Map();

        for (const feature of bucket) {
          // Any feature whose own project is a different swimlane contributes
          // to this band's origin list — regardless of whether that source lane
          // is hidden or visible.  This ensures selected team-plan participants
          // (type='plan') are counted in the project swimlane label even when
          // they still have their own band for unlinked tasks.
          const sourcePlanId = String(feature.project);
          if (sourcePlanId !== String(swimlane.id)) {
            const sourcePlanSwimlane = swimlaneById.get(sourcePlanId);
            if (
              sourcePlanSwimlane &&
              (sourcePlanSwimlane.type === 'plan' || sourcePlanSwimlane.type === 'expanded-plan')
            ) {
              planOrigins.set(sourcePlanId, {
                id: sourcePlanId,
                name: sourcePlanSwimlane.name,
                color: sourcePlanSwimlane.color,
                type: sourcePlanSwimlane.type,
              });
            }
          }
          if (Array.isArray(feature.capacity)) {
            for (const cap of feature.capacity) {
              if (!cap?.team || !(cap.capacity > 0)) continue;
              const sourceTeamId = String(cap.team);
              if (sourceTeamId !== String(swimlane.id)) {
                const sourceTeamSwimlane = swimlaneById.get(sourceTeamId);
                if (sourceTeamSwimlane && sourceTeamSwimlane.type === 'team') {
                  teamOrigins.set(sourceTeamId, {
                    id: sourceTeamId,
                    name: sourceTeamSwimlane.name,
                    color: sourceTeamSwimlane.color,
                    type: sourceTeamSwimlane.type,
                  });
                }
              }
            }
          }
        }
        const expansionOrigins = [...planOrigins.values(), ...teamOrigins.values()].sort(
          (a, b) => String(a.name || '').localeCompare(String(b.name || ''))
        );
        const planOriginNames = expansionOrigins
          .filter((o) => o.type === 'expanded-plan')
          .map((o) => o.name);
        const teamOriginNames = expansionOrigins
          .filter((o) => o.type === 'team')
          .map((o) => o.name);
        const expansionOriginCount = expansionOrigins.length;
        const tooltipParts = [];
        if (planOriginNames.length > 0) {
          tooltipParts.push(`Added plans: ${planOriginNames.join(', ')}`);
        }
        if (teamOriginNames.length > 0) {
          tooltipParts.push(`Added teams: ${teamOriginNames.join(', ')}`);
        }

        // Use group layout for plan/expanded-plan swimlanes that have groups.
        const planGroups = (swimlane.type === 'plan' || swimlane.type === 'expanded-plan')
          ? sel.group.getEffectiveGroups(String(swimlane.id))
          : [];

        if (planGroups.length > 0) {
          // Group-aware layout: group pills + packed or flat features per group
          const orderedBucket = this._orderFeaturesHierarchically(
            bucket,
            sel.view.getFeatureSortMode()
          );
          const { items: groupItems, totalHeight: gHeight } = buildGroupBandItems(
            orderedBucket, planGroups, swimlaneTop, months,
            sel.view.getCondensedCards(), isPacked, this._collapsedGroups
          );
          renderList.push(...groupItems);
          swimlaneHeight = Math.max(gHeight, laneHeight());
        } else if (isPacked) {
          // Per-swimlane greedy packing (no groups)
          const bars = [];
          for (const feature of bucket) {
            const pos = computePosition(feature, months);
            if (!pos) continue;
            bars.push({ left: pos.left, width: pos.width, feature });
          }
          bars.sort((a, b) => a.left - b.left);
          const rows = packIntoRows(bars);
          rows.forEach((row, rowIndex) => {
            const top = swimlaneTop + rowIndex * laneHeight();
            for (const bar of row) {
              renderList.push({
                feature: bar.feature,
                left: bar.left,
                width: bar.width,
                top,
                teams: selectedTeams,
                condensed: true,
                hideGhostTitle: true,
                project: selectedProjects.find((p) => p.id === bar.feature.project),
              });
            }
          });
          swimlaneHeight = Math.max(rows.length, 1) * laneHeight();
        } else {
          // Per-swimlane flat hierarchical sort (no groups)
          const ordered = this._orderFeaturesHierarchically(
            bucket,
            sel.view.getFeatureSortMode()
          );
          let laneIndex = 0;
          for (const feature of ordered) {
            const pos = computePosition(feature, months) || {};
            renderList.push({
              feature,
              left: pos.left ?? 0,
              width: pos.width ?? 0,
              top: swimlaneTop + laneIndex * laneHeight(),
              teams: selectedTeams,
              condensed: sel.view.getCondensedCards(),
              hideGhostTitle: false,
              project: selectedProjects.find((p) => p.id === feature.project),
            });
            laneIndex++;
          }
          // Reserve at least one lane height even for empty swimlanes.
          swimlaneHeight = Math.max(bucket.length, 1) * laneHeight();
        }

        // The band height includes the gap that visually separates this lane
        // from the next one below it.
        const bandHeightWithGap = swimlaneHeight + SWIMLANE_BAND_GAP_PX;
        swimlaneGeometry.push({
          ...swimlane,
          topPx: swimlaneTop,
          heightPx: bandHeightWithGap,
          expansionOriginCount,
          expansionOriginTooltip: tooltipParts.join(' | '),
          expansionOrigins,
        });
        currentTop = swimlaneTop + bandHeightWithGap;
      }

      this._swimlanes = swimlaneGeometry;
      totalHeight = currentTop;
    } else {
      // -----------------------------------------------------------------------
      // Standard (non-swimlane) mode
      // -----------------------------------------------------------------------
      this._swimlanes = [];

      // Order features once; used by both group and flat paths.
      const ordered = this._orderFeaturesHierarchically(
        sourceFeatures,
        sel.view.getFeatureSortMode()
      );
      // Scope groups to the currently-selected plans only.  getAllGroups()
      // returns groups from ALL cached plans (including stale entries from plans
      // no longer selected), which would show empty group pills from other plans.
      const selectedPlanIds = selectedProjects.filter((p) => p.selected).map((p) => p.id);
      const allGroups = selectedPlanIds.flatMap((id) => sel.group.getEffectiveGroups(id));

      // Always go through the group band layout, even with zero groups: it is
      // what stamps the shared ordering keys onto every row, which the group
      // insertion caret needs in order to point between two ungrouped tasks.
      const visibleFiltered = ordered.filter(
        (f) => this._featurePassesFilters(f, childrenMap, sourceFeatures, visibleScopeIds)
      );
      const { items: groupItems, totalHeight: gHeight } = buildGroupBandItems(
        visibleFiltered, allGroups, allGroups.length > 0 ? 0 : this._overlayOffset, months,
        sel.view.getCondensedCards(), isPacked, this._collapsedGroups
      );
      renderList = groupItems;
      totalHeight = allGroups.length > 0 ? gHeight : gHeight + this._overlayOffset;
    }

    this._applyRenderList(renderList);
    this._cardMap.clear();
    // Explicitly size the host so #board-area (the positioned parent) has the
    // correct dimensions, allowing position:absolute overlays with inset:0 to
    // cover the full card area. Ensure we never shrink below the visible
    // scroll-container height so the background stripes always fill the screen.
    try {
      const sc = findInBoard('#scroll-container');
      const minH = sc && sc.clientHeight ? sc.clientHeight : 0;
      const finalH = Math.max(totalHeight, minH);
      this._boardHeight = finalH;
      this.style.height = finalH + 'px';
    } catch (e) {
      this._boardHeight = totalHeight;
      this.style.height = totalHeight + 'px';
    }
    this.requestUpdate();

    if (renderList.length === 0) {
      const mh = await import('./modalHelpers.js');
      if (typeof mh?.openEmptyBoardModal === 'function') {
        mh.openEmptyBoardModal({ parent: document.body }).catch(() => {});
      }
    }
  }

  _applyRenderList(renderList) {
    this._renderGeneration += 1;
    const generation = this._renderGeneration;
    this._fullRenderList = renderList;

    if (this._shouldVirtualize(renderList)) {
      this._updateVisibleRenderList();
      return;
    }

    if (renderList.length <= FeatureBoard.LARGE_RENDER_THRESHOLD) {
      this.features = renderList;
      this.requestUpdate();
      return;
    }

    const initialCount = Math.min(renderList.length, FeatureBoard.INITIAL_RENDER_CHUNK);
    this.features = renderList.slice(0, initialCount);
    this.requestUpdate();

    let nextIndex = initialCount;
    const pushNextChunk = () => {
      if (generation !== this._renderGeneration || nextIndex >= renderList.length) return;
      const endIndex = Math.min(
        renderList.length,
        nextIndex + FeatureBoard.RENDER_CHUNK_SIZE
      );
      this.features = renderList.slice(0, endIndex);
      this.requestUpdate();
      nextIndex = endIndex;
      if (nextIndex < renderList.length) {
        requestAnimationFrame(pushNextChunk);
      }
    };

    requestAnimationFrame(pushNextChunk);
  }

  _shouldVirtualize(renderList = this._fullRenderList) {
    const scrollContainer = findInBoard('#scroll-container');
    return !!scrollContainer && renderList.length > FeatureBoard.LARGE_RENDER_THRESHOLD;
  }

  _scheduleViewportRender() {
    if (this._viewportRenderScheduled || !this._shouldVirtualize()) return;
    this._viewportRenderScheduled = true;
    requestAnimationFrame(() => {
      this._viewportRenderScheduled = false;
      this._updateVisibleRenderList();
    });
  }

  _updateVisibleRenderList() {
    if (!this._shouldVirtualize()) return;
    const scrollContainer = findInBoard('#scroll-container');
    if (!scrollContainer) return;

    const viewport = {
      left: boardCoords.scrollX,
      right: boardCoords.scrollX + scrollContainer.clientWidth,
      top: boardCoords.scrollY,
      bottom: boardCoords.scrollY + scrollContainer.clientHeight,
      overscanX: FeatureBoard.VIRTUALIZE_OVERSCAN_X,
      overscanY: FeatureBoard.VIRTUALIZE_OVERSCAN_Y,
    };
    const next = this._computeVisibleRenderItems(this._fullRenderList, viewport);
    if (this._sameRenderSlice(this.features, next)) return;
    this.features = next;
    this._cardMap.clear();
    this.requestUpdate();
  }

  _computeVisibleRenderItems(renderList, viewport) {
    if (!Array.isArray(renderList) || renderList.length === 0) return [];
    const left = viewport.left - (viewport.overscanX ?? 0);
    const right = viewport.right + (viewport.overscanX ?? 0);
    const top = viewport.top - (viewport.overscanY ?? 0);
    const bottom = viewport.bottom + (viewport.overscanY ?? 0);

    return renderList.filter((item) => {
      const itemLeft = Number(item.left ?? 0);
      const itemWidth = Number(item.width ?? 0);
      const itemRight = itemLeft + Math.max(itemWidth, 1);
      const itemTop = Number(item.top ?? 0);
      const itemHeight = item.isGroup ? 28 : laneHeight();
      const itemBottom = itemTop + Math.max(itemHeight, 1);
      return itemRight >= left && itemLeft <= right && itemBottom >= top && itemTop <= bottom;
    });
  }

  _sameRenderSlice(prev, next) {
    if (prev === next) return true;
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) {
      return false;
    }
    for (let index = 0; index < prev.length; index += 1) {
      if (prev[index] !== next[index]) return false;
    }
    return true;
  }

  _updateCachedRenderItemById(id, feature, visuals = {}) {
    const key = String(id);
    let updated = false;
    for (const item of this._fullRenderList) {
      if (item.isGroup || String(item.feature?.id) !== key) continue;
      item.feature = { ...feature };
      if (visuals.left !== undefined) item.left = visuals.left;
      if (visuals.width !== undefined) item.width = visuals.width;
      if (visuals.project !== undefined) item.project = visuals.project;
      updated = true;
    }
    return updated;
  }

  async updateCardsById(ids = []) {
    // In packed mode any date change can shift a card into an occupied lane.
    // A full repack is required to keep the layout consistent.
    if (sel.view.getPackedMode()) {
      await this.renderFeatures();
      return;
    }

    const months = getTimelineMonths();

    for (const id of ids) {
      const feature = sel.feature.getEffectiveFeatureById(id);
      if (!feature) continue;

      // A grouped task's band may need to grow/shrink when the task is dragged
      // or resized beyond the group's current date range, so groups must be
      // recomputed via a full render rather than an in-place card update.
      if (this._featureIsInAnyGroup(feature)) {
        this.renderFeatures();
        return;
      }

      const existing = this._getCardNodeById(id);
      if (!existing && !this._shouldVirtualize()) {
        this.renderFeatures();
        return;
      }

      const geom = computePosition(feature, months) || {};
      const left =
        geom.left !== undefined ?
          typeof geom.left === 'number' ?
            `${geom.left}px`
          : geom.left
        : '';
      const width =
        geom.width !== undefined ?
          typeof geom.width === 'number' ?
            `${geom.width}px`
          : geom.width
        : '';
      const projects = sel.selection.getProjects();
      const project = projects.find((p) => p.id === feature.project);

      this._updateCachedRenderItemById(id, feature, {
        left: geom.left ?? 0,
        width: geom.width ?? 0,
        project,
      });

      if (!existing) {
        if (this._shouldVirtualize()) {
          this._scheduleViewportRender();
          continue;
        }
        this.renderFeatures();
        return;
      }

      existing.feature = { ...feature };
      existing.selected = !!feature.selected;
      existing.project = project;
      existing.applyVisuals({
        left,
        width,
        selected: !!feature.selected,
        dirty: !!feature.dirty,
        project,
      });
    }
  }

  /** True if the feature is a member of any group on its plan. */
  _featureIsInAnyGroup(feature) {
    if (!feature || !feature.project) return false;
    if (!sel.group.hasPlanLoaded(String(feature.project))) return false;
    const key = String(feature.id);
    const planGroups = sel.group.getEffectiveGroups(String(feature.project));
    return planGroups.some((group) =>
      (group.members || []).some((memberId) => String(memberId) === key)
    );
  }

  _getCardNodeById(featureId) {
    const key = String(featureId);
    const cached = this._cardMap.get(key);
    if (cached) {
      const cachedId = String(cached.feature?.id ?? cached.dataset?.featureId ?? cached.dataset?.id ?? '');
      if (cached.isConnected || cachedId === key) return cached;
    }

    const escaped = window.CSS?.escape?.(key) ?? key.replace(/["\\]/g, '\\$&');
    const node = this.shadowRoot?.querySelector(
      `feature-card-lit[data-feature-id="${escaped}"]`
    );
    if (node) {
      this._cardMap.set(key, node);
      return node;
    }
    this._cardMap.delete(key);
    return null;
  }

  _selectFeature(feature) {
    this.dispatchEvent(
      new CustomEvent('feature-selected', {
        detail: { feature },
        bubbles: true,
        composed: true,
      })
    );
  }

  centerFeatureById(featureId) {
    const card = this._getCardNodeById(featureId);
    // Scroll is now owned by the parent #scroll-container (in TimelineBoard)
    const scrollContainer = findInBoard('#scroll-container');
    if (!scrollContainer) return;

    if (!card) {
      const target = this._fullRenderList.find(
        (item) => !item.isGroup && String(item.feature?.id) === String(featureId)
      );
      if (!target) return;
      const targetHeight = laneHeight();
      scrollContainer.scrollTo({
        left: Math.max(0, Math.round(target.left + target.width / 2 - scrollContainer.clientWidth / 2)),
        top: Math.max(0, Math.round(target.top + targetHeight / 2 - scrollContainer.clientHeight / 2)),
        behavior: 'smooth',
      });
      this._scheduleViewportRender();
      return;
    }

    const cardCenterX = (card.offsetLeft || 0) + (card.clientWidth || 0) / 2;
    const cardCenterY = (card.offsetTop || 0) + (card.clientHeight || 0) / 2;
    scrollContainer.scrollTo({
      left: Math.max(0, Math.round(cardCenterX - scrollContainer.clientWidth / 2)),
      top: Math.max(0, Math.round(cardCenterY - scrollContainer.clientHeight / 2)),
      behavior: 'smooth',
    });

    card.classList.add('search-highlight');
    setTimeout(() => {
      card.classList.remove('search-highlight');
    }, 950);
  }

  addFeature(nodeOrFeature) {
    if (!nodeOrFeature) return;
    if (nodeOrFeature instanceof Node) {
      this.appendChild(nodeOrFeature);
    } else {
      const div = document.createElement('div');
      div.className = 'feature';
      div.setAttribute('role', 'listitem');
      div.textContent = nodeOrFeature.title || 'Untitled';
      this.appendChild(div);
    }
  }
}

customElements.define('feature-board', FeatureBoard);
