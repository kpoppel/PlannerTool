import { LitElement, html } from '../vendor/lit.js';
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
import { state } from '../services/State.js';
import { getTimelineMonths } from './Timeline.lit.js';
import { laneHeight, computePosition } from './board-utils.js';
import { featureFlags } from '../config.js';
import { findInBoard } from './board-utils.js';
import {
  isSwimlaneMode,
  buildSwimlaneList,
  assignFeatureToSwimlane,
  SWIMLANE_BAND_GAP_PX,
} from '../services/SwimlaneService.js';
import { groupService } from '../services/GroupService.js';
import { featureBoardStyles } from './FeatureBoard.styles.js';
import { buildGroupBandItems, packIntoRows } from './groupBandLayout.js';
import './FeatureGroup.lit.js';
export { initBoard } from './FeatureBoard.init.js';

class FeatureBoard extends LitElement {
  static properties = {
    features: { type: Array },
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
  }

  _updateSwimlaneLabelStickyTop() {
    const scrollContainer = findInBoard('#scroll-container');
    const stickyTop =
      scrollContainer && scrollContainer.clientHeight ?
        Math.round(scrollContainer.clientHeight / 2)
      : 24;
    this.style.setProperty('--swimlane-label-sticky-top', `${stickyTop}px`);
  }

  // Build and maintain connected feature sets (parent/child and relations)
  _computeConnectedSet(startFeature) {
    let features = state.getEffectiveFeatures();
    if (!features) features = [];
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
      ${this.features.map((item) => {
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
          ></feature-group>`;
        }
        return html`<feature-card-lit
          .feature=${item.feature}
          .bus=${bus}
          .teams=${item.teams}
          .condensed=${item.condensed}
          .project=${item.project}
          .hideGhostTitle=${!!item.hideGhostTitle}
          style="position:absolute; left:${item.left}px; top:${item.top}px; width:${item.width}px; height:${itemHeight}px"
        ></feature-card-lit>`;
      })}
    `;
  }

  /** Handle expand/collapse from a <feature-group>. */
  _onGroupToggle(e) {
    const { groupId, collapsed } = e.detail;
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

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this._handleViewportResize);
    if (this._onOverlayOffsetChanged) {
      bus.off(BoardEvents.OVERLAY_OFFSET_CHANGED, this._onOverlayOffsetChanged);
    }
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

  _featurePassesFilters(feature, childrenMap, allFeatures = []) {
    // Check if feature is in expanded set (when expansion filters are active)
    const expansionState = state.expansionState || {};
    const hasExpansion =
      expansionState.expandParentChild ||
      expansionState.expandRelations ||
      expansionState.expandTeamAllocated;

    if (hasExpansion) {
      const expandedIds = state.getExpandedFeatureIds();
      // If expansion is active, only show features in expanded set
      // Don't require project selection - expansion can pull in features from other projects
      if (!expandedIds.has(feature.id)) return false;
    } else {
      // No expansion active - use standard project filter
      const project = state.projects.find((p) => p.id === feature.project && p.selected);
      if (!project) return false;
    }

    if (state._viewService.showOnlyProjectHierarchy) {
      const projectTypePlans = state.projects.filter((p) => {
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

    const stateFilter =
      state.selectedFeatureStateFilter instanceof Set ?
        state.selectedFeatureStateFilter
      : new Set(
          state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []
        );
    if (stateFilter.size === 0) return false;

    // Build lowercase version of selected states for case-insensitive comparison
    const stateFilterLower = new Set(
      Array.from(stateFilter).map((s) => String(s).toLowerCase())
    );
    const featureStateLower = (feature.state || '').toLowerCase();
    if (!stateFilterLower.has(featureStateLower)) return false;

    // Apply task filters (schedule, allocation, hierarchy, relations)
    if (
      state.taskFilterService &&
      !state.taskFilterService.featurePassesFilters(feature)
    ) {
      return false;
    }

    if (!state._viewService.isTypeVisible(feature.type)) return false;

    if (featureFlags.SHOW_UNPLANNED_WORK) {
      if (this._isUnplanned(feature) && !state._viewService.showUnplannedWork)
        return false;
    }

    // If a project/plan is selected, show tasks from that project regardless of team selection.
    const selectedProjectIds = new Set(
      state.projects.filter((p) => p.selected).map((p) => String(p.id))
    );

    // A parent item is visible if it has direct or indirect visible children,
    // or if it itself passes team/project/capacity checks.
    // Use childrenMap to detect parent items generically (no type string check).
    if (childrenMap.has(feature.id)) {
      const children = childrenMap.get(feature.id) || [];
      const anyChildVisible = children.some((child) => {
        const childProject = state.projects.find(
          (p) => p.id === child.project && p.selected
        );
        if (!childProject) return false;
        if (
          featureFlags.SHOW_UNPLANNED_WORK &&
          this._isUnplanned(child) &&
          !state._viewService.showUnplannedWork
        )
          return false;
        const hasCapacity = child.capacity?.length > 0;
        if (!hasCapacity) return state._viewService.showUnassignedCards;
        // If the child's project is among selected projects, ignore team-selection and show it.
        if (selectedProjectIds.has(String(child.project))) return true;
        return child.capacity.some((tl) =>
          state.teams.find((t) => t.id === tl.team && t.selected)
        );
      });
      const hasCapacity = feature.capacity?.length > 0;
      const epicVisible =
        hasCapacity ?
          selectedProjectIds.has(String(feature.project)) ||
          feature.capacity.some((tl) =>
            state.teams.find((t) => t.id === tl.team && t.selected)
          )
        : state._viewService.showUnassignedCards;
      if (!epicVisible && !anyChildVisible) return false;
    } else {
      const hasCapacity = feature.capacity?.length > 0;
      if (!hasCapacity) {
        if (!state._viewService.showUnassignedCards) return false;
      } else {
        // If this feature belongs to a selected project, ignore team-selection and show it.
        if (
          !(
            selectedProjectIds.has(String(feature.project)) ||
            feature.capacity.some((tl) =>
              state.teams.find((t) => t.id === tl.team && t.selected)
            )
          )
        )
          return false;
      }
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
    const rawFeatures = state.getEffectiveFeatures();
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
    const months = getTimelineMonths();
    const isPacked = state._viewService.packedMode;
    const expansionState = state.expansionState || {};
    const visibleFeatures = [];
    for (const feature of sourceFeatures) {
      if (!this._featurePassesFilters(feature, childrenMap, sourceFeatures)) continue;
      if (isPacked && (!feature.start || !feature.end)) continue;
      visibleFeatures.push(feature);
    }
    const selectedProjects = state.projects;
    const selectedTeams = state.teams;
    const candidateSwimlanes = buildSwimlaneList(
      selectedProjects,
      selectedTeams,
      expansionState,
      visibleFeatures
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
          expansionState,
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
          const sourceProjectLane = hiddenExpansionLanes.get(String(feature.project));
          if (
            sourceProjectLane &&
            sourceProjectLane.type === 'expanded-plan' &&
            String(sourceProjectLane.id) !== String(swimlane.id)
          ) {
            planOrigins.set(String(sourceProjectLane.id), {
              id: String(sourceProjectLane.id),
              name: sourceProjectLane.name,
              color: sourceProjectLane.color,
              type: sourceProjectLane.type,
            });
          }
          if (Array.isArray(feature.capacity)) {
            for (const cap of feature.capacity) {
              if (!cap?.team || !(cap.capacity > 0)) continue;
              const sourceTeamLane = hiddenExpansionLanes.get(String(cap.team));
              if (
                sourceTeamLane &&
                sourceTeamLane.type === 'team' &&
                String(sourceTeamLane.id) !== String(swimlane.id)
              ) {
                teamOrigins.set(String(sourceTeamLane.id), {
                  id: String(sourceTeamLane.id),
                  name: sourceTeamLane.name,
                  color: sourceTeamLane.color,
                  type: sourceTeamLane.type,
                });
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
          ? groupService.getGroupsForPlan(String(swimlane.id))
          : [];

        if (planGroups.length > 0) {
          // Group-aware layout: group pills + packed or flat features per group
          const orderedBucket = this._orderFeaturesHierarchically(
            bucket,
            state._viewService.featureSortMode
          );
          const { items: groupItems, totalHeight: gHeight } = buildGroupBandItems(
            orderedBucket, planGroups, swimlaneTop, months,
            state._viewService.condensedCards, isPacked, this._collapsedGroups, String(swimlane.id)
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
                teams: state.teams,
                condensed: true,
                hideGhostTitle: true,
                project: state.projects.find((p) => p.id === bar.feature.project),
              });
            }
          });
          swimlaneHeight = Math.max(rows.length, 1) * laneHeight();
        } else {
          // Per-swimlane flat hierarchical sort (no groups)
          const ordered = this._orderFeaturesHierarchically(
            bucket,
            state._viewService.featureSortMode
          );
          let laneIndex = 0;
          for (const feature of ordered) {
            const pos = computePosition(feature, months) || {};
            renderList.push({
              feature,
              left: pos.left ?? feature._left ?? feature.left,
              width: pos.width ?? feature._width ?? feature.width,
              top: swimlaneTop + laneIndex * laneHeight(),
              teams: state.teams,
              condensed: state._viewService.condensedCards,
              hideGhostTitle: false,
              project: state.projects.find((p) => p.id === feature.project),
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
        state._viewService.featureSortMode
      );
      // Scope groups to the currently-selected plans only.  getAllGroups()
      // returns groups from ALL cached plans (including stale entries from plans
      // no longer selected), which would show empty group pills from other plans.
      const selectedPlanIds = selectedProjects.filter((p) => p.selected).map((p) => p.id);
      const allGroups = selectedPlanIds.flatMap((id) => groupService.getGroupsForPlan(id));
      renderList = [];

      if (allGroups.length > 0) {
        // Group-aware layout — handles both packed and normal modes.
        // Filter to only visible features first.
        const visibleFiltered = ordered.filter(
          (f) => this._featurePassesFilters(f, childrenMap, sourceFeatures)
        );
        const { items: groupItems, totalHeight: gHeight } = buildGroupBandItems(
          visibleFiltered, allGroups, 0, months,
          state._viewService.condensedCards, isPacked, this._collapsedGroups,
          selectedPlanIds.length === 1 ? String(selectedPlanIds[0]) : 'multi'
        );
        renderList = groupItems;
        totalHeight = gHeight;
      } else if (isPacked) {
        // --- Packed mode: features with non-overlapping dates share a lane ---
        const filtered = [];
        for (const feature of sourceFeatures) {
          if (!this._featurePassesFilters(feature, childrenMap, sourceFeatures)) continue;
          // Unplanned features (no dates) cannot be positioned in packed mode
          if (!feature.start || !feature.end) continue;
          const pos = computePosition(feature, months);
          if (!pos) continue;
          filtered.push({ left: pos.left, width: pos.width, feature });
        }
        // Sort by start position ascending for greedy packing
        filtered.sort((a, b) => a.left - b.left);
        const rows = packIntoRows(filtered);
        rows.forEach((row, rowIndex) => {
          const top = this._overlayOffset + rowIndex * laneHeight();
          for (const bar of row) {
            renderList.push({
              feature: bar.feature,
              left: bar.left,
              width: bar.width,
              top,
              teams: state.teams,
              condensed: true, // packed always uses compact card height
              hideGhostTitle: true, // ghost titles would overlap packed neighbours
              project: state.projects.find((p) => p.id === bar.feature.project),
            });
          }
        });
        totalHeight = rows.length * laneHeight() + this._overlayOffset;
      } else {
        // --- Normal / Compact mode: one lane per feature, no groups ---
        let laneIndex = 0;
        for (const feature of ordered) {
          if (!this._featurePassesFilters(feature, childrenMap, sourceFeatures)) continue;
          const pos = computePosition(feature, months) || {};
          renderList.push({
              feature,
              left: pos.left ?? feature._left ?? feature.left,
              width: pos.width ?? feature._width ?? feature.width,
              top: this._overlayOffset + laneIndex * laneHeight(),
            teams: state.teams,
            condensed: state._viewService.condensedCards,
            hideGhostTitle: false,
            project: state.projects.find((p) => p.id === feature.project),
          });
          laneIndex++;
        }
          totalHeight = renderList.length * laneHeight() + this._overlayOffset;
      }
    }

    this.features = renderList;
    // Explicitly size the host so #board-area (the positioned parent) has the
    // correct dimensions, allowing position:absolute overlays with inset:0 to
    // cover the full card area. Ensure we never shrink below the visible
    // scroll-container height so the background stripes always fill the screen.
    try {
      const sc = findInBoard('#scroll-container');
      const minH = sc && sc.clientHeight ? sc.clientHeight : 0;
      const finalH = Math.max(totalHeight, minH);
      this.style.height = finalH + 'px';
    } catch (e) {
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

  async updateCardsById(ids = []) {
    // In packed mode any date change can shift a card into an occupied lane.
    // A full repack is required to keep the layout consistent.
    if (state._viewService.packedMode) {
      await this.renderFeatures();
      return;
    }

    const months = getTimelineMonths();

    for (const id of ids) {
      const feature = state.getEffectiveFeatureById(id);
      if (!feature) continue;

      const existing = this._cardMap.get(id);
      if (!existing) {
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
      const project = state.projects.find((p) => p.id === feature.project);

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

  // After render, update card map
  updated() {
    if (!this.shadowRoot) return;
    const cards = this.shadowRoot.querySelectorAll('feature-card-lit');
    this._cardMap.clear();
    cards.forEach((node) => {
      if (node.feature?.id) this._cardMap.set(node.feature.id, node);
    });
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
    const card =
      this._cardMap.get(String(featureId)) ||
      this.shadowRoot?.querySelector(`feature-card-lit[data-feature-id="${featureId}"]`);
    // Scroll is now owned by the parent #scroll-container (in TimelineBoard)
    const scrollContainer = findInBoard('#scroll-container');
    if (!card || !scrollContainer) return;

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
