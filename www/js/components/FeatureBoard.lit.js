import { LitElement, html, css } from '../vendor/lit.js';
import {
  ProjectEvents,
  TeamEvents,
  TimelineEvents,
  FeatureEvents,
  FilterEvents,
  ScenarioEvents,
  ViewEvents,
  AppEvents,
  UIEvents,
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
  SWIMLANE_LABEL_WIDTH_PX,
  SWIMLANE_BAND_GAP_PX,
} from '../services/SwimlaneService.js';
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
  }

  static styles = css`
    :host {
      display: block;
      /* No overflow — scroll is handled by the parent #scroll-container in TimelineBoard.
         Width and height are set programmatically to the full content dimensions so that
         plugin SVG overlays inside the shadow root can use position:absolute & inset:0. */
      position: relative;
      overflow: visible;
      padding: 0;
      /* No background — stripes are on #board-area which spans the full content width.
         feature-board is transparent so the parent background shows through. */
      background: transparent;
    }

    :host(.scenario-mode) {
      /* Scenario mode class propagated from initBoard; actual color is on #board-area */
    }

    /* Swimlane background band — coloured translucent strip spanning full board width */
    .swimlane-band {
      position: absolute;
      left: 0;
      right: 0;
      pointer-events: none;
      box-sizing: border-box;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
    }

    /*
     * Sticky label column — stays at the left edge of the viewport while the user
     * scrolls the timeline horizontally, but scrolls vertically with the board.
     *
     * Only "left: 0" is specified (no "top") so stickiness applies in the horizontal
     * direction only. Adding "top: 0" would pin the container to the viewport top,
     * making absolute children appear at fixed viewport positions instead of their
     * correct board positions.
     *
     * height:0 + overflow:visible means the container occupies no vertical space in
     * the flow but its absolutely-positioned children are still rendered over the board.
     */
    .swimlane-labels {
      position: sticky;
      left: 0;
      width: ${SWIMLANE_LABEL_WIDTH_PX}px;
      height: 0;
      overflow: visible;
      z-index: 20;
      pointer-events: none;
    }

    /* Individual plan/team name label */
    .swimlane-label {
      position: absolute;
      left: 0;
      width: ${SWIMLANE_LABEL_WIDTH_PX}px;
      display: flex;
      align-items: center;
      padding-left: 10px;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: rgba(255, 255, 255, 0.9);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-sizing: border-box;
      border-left: 4px solid;
      /* Semi-transparent dark background for legibility over the board stripes */
      background: rgba(0, 0, 0, 0.22);
      backdrop-filter: blur(2px);
    }

    /* Expanded-plan labels (unselected projects pulled in by expansion) are dimmer */
    .swimlane-label.type-expanded-plan {
      opacity: 0.75;
      font-weight: 600;
    }

    /* Team labels use italic to distinguish them from plan labels */
    .swimlane-label.type-team {
      font-style: italic;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('role')) {
      this.setAttribute('role', 'list');
    }
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
  // style="top:${s.topPx}px; height:${s.heightPx}px; background:${s.color}; opacity:0.15; border-top: 2px solid color-mix(in srgb, ${s.color} 50%, transparent);"

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
                  class="swimlane-label type-${s.type}"
                  style="top:${s.topPx}px; height:${s.heightPx}px; border-left-color:${s.color};"
                  title="${s.name}"
                >${s.name}</div>`
              )}
            </div>
          `
        : ''}
      ${this.features.map(
        (featureObj) =>
          html`<feature-card-lit
            .feature=${featureObj.feature}
            .bus=${bus}
            .teams=${featureObj.teams}
            .condensed=${featureObj.condensed}
            .project=${featureObj.project}
            .hideGhostTitle=${!!featureObj.hideGhostTitle}
            style="position:absolute; left:${featureObj.left}px; top:${featureObj.top}px; width:${featureObj.width}px"
          ></feature-card-lit>`
      )}
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
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
  _packIntoRows(bars) {
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

  async renderFeatures() {
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
    const swimlaneActive = isSwimlaneMode(state.projects, expansionState);

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

      // Collect visible features (pass through the same filter as non-swimlane mode)
      const visibleFeatures = [];
      for (const feature of sourceFeatures) {
        if (!this._featurePassesFilters(feature, childrenMap, sourceFeatures)) continue;
        if (isPacked && (!feature.start || !feature.end)) continue;
        visibleFeatures.push(feature);
      }

      const selectedProjects = state.projects;
      const selectedTeams = state.teams;
      const swimlanes = buildSwimlaneList(
        selectedProjects,
        selectedTeams,
        expansionState,
        visibleFeatures
      );

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

      // Render each swimlane band independently and accumulate vertical offsets
      renderList = [];
      let currentTop = 0;
      const swimlaneGeometry = [];

      for (const swimlane of swimlanes) {
        const bucket = buckets.get(swimlane.id) || [];
        const swimlaneTop = currentTop;
        let swimlaneHeight = 0;

        if (isPacked) {
          // Per-swimlane greedy packing
          const bars = [];
          for (const feature of bucket) {
            const pos = computePosition(feature, months);
            if (!pos) continue;
            bars.push({ left: pos.left, width: pos.width, feature });
          }
          bars.sort((a, b) => a.left - b.left);
          const rows = this._packIntoRows(bars);
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
          // Per-swimlane hierarchical sort
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
          // Reserve at least one lane height even for empty swimlanes so the
          // label and coloured band always render with a minimum visible height.
          swimlaneHeight = Math.max(bucket.length, 1) * laneHeight();
        }

        // The band height includes the gap that visually separates this lane
        // from the next one below it.
        const bandHeightWithGap = swimlaneHeight + SWIMLANE_BAND_GAP_PX;
        swimlaneGeometry.push({
          ...swimlane,
          topPx: swimlaneTop,
          heightPx: bandHeightWithGap,
        });
        currentTop = swimlaneTop + bandHeightWithGap;
      }

      this._swimlanes = swimlaneGeometry;
      totalHeight = currentTop;
    } else {
      // -----------------------------------------------------------------------
      // Standard (non-swimlane) mode — unchanged from original implementation
      // -----------------------------------------------------------------------
      this._swimlanes = [];

      if (isPacked) {
        // --- Packed mode: features with non-overlapping dates share a lane ---
        // Order by date to maximise packing efficiency (earlier starts first)
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
        const rows = this._packIntoRows(filtered);
        renderList = [];
        rows.forEach((row, rowIndex) => {
          const top = rowIndex * laneHeight();
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
        totalHeight = rows.length * laneHeight();
      } else {
        // --- Normal / Compact mode: one lane per feature, sorted by rank or date ---
        const ordered = this._orderFeaturesHierarchically(
          sourceFeatures,
          state._viewService.featureSortMode
        );
        renderList = [];
        let laneIndex = 0;
        for (const feature of ordered) {
          if (!this._featurePassesFilters(feature, childrenMap, sourceFeatures)) continue;
          const pos = computePosition(feature, months) || {};
          feature._left = pos.left;
          feature._width = pos.width;
          renderList.push({
            feature,
            left: pos.left ?? feature._left ?? feature.left,
            width: pos.width ?? feature._width ?? feature.width,
            top: laneIndex * laneHeight(),
            teams: state.teams,
            condensed: state._viewService.condensedCards,
            hideGhostTitle: false,
            project: state.projects.find((p) => p.id === feature.project),
          });
          laneIndex++;
        }
        totalHeight = renderList.length * laneHeight();
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

export async function initBoard() {
  const board = findInBoard('feature-board');
  if (!board) {
    console.warn('feature-board element not found');
    return;
  }

  let _boardReady = false;
  const renderFeatures = () => {
    if (!board || !_boardReady) return;
    if (typeof board.renderFeatures === 'function') board.renderFeatures();
  };

  const updateFeatures = (payload) => {
    if (!board || !_boardReady || typeof board.updateCardsById !== 'function') return;
    const ids = payload?.ids;
    if (Array.isArray(ids) && ids.length > 0) {
      board.updateCardsById(ids);
    } else {
      board.renderFeatures();
    }
  };

  const handleScenarioActivation = ({ scenarioId }) => {
    if (!board) return;
    const activeScenario = state.scenarios.find((s) => s.id === scenarioId);
    // Apply scenario-mode class on #board-area (the background container) so
    // the correct stripe colour is shown.
    const boardArea = findInBoard('#board-area');
    if (activeScenario && !activeScenario.readonly) {
      board.classList.add('scenario-mode');
      boardArea?.classList.add('scenario-mode');
    } else {
      board.classList.remove('scenario-mode');
      boardArea?.classList.remove('scenario-mode');
    }
  };

  bus.on(ProjectEvents.CHANGED, renderFeatures);
  bus.on(TeamEvents.CHANGED, renderFeatures);
  bus.on(TimelineEvents.MONTHS, renderFeatures);
  bus.on(TimelineEvents.SCALE_CHANGED, renderFeatures);
  bus.on(FeatureEvents.UPDATED, updateFeatures);
  bus.on(FilterEvents.CHANGED, renderFeatures);
  bus.on(ViewEvents.SORT_MODE, renderFeatures);
  bus.on(ScenarioEvents.ACTIVATED, handleScenarioActivation);

  // Connected-set handling: request, selection within set, and clear on details hide
  bus.on(FeatureEvents.REQUEST_CONNECTED_SET, (feature) => {
    if (!board) return;
    const set = board._computeConnectedSet(feature);
    board._connectedSet = set;
    board._connectedPrimary = String(feature.id);
    board._connectedCurrent = String(feature.id);
    bus.emit(FeatureEvents.CONNECTED_SET_UPDATED, {
      ids: set,
      primary: board._connectedPrimary,
      current: board._connectedCurrent,
    });
  });

  bus.on(FeatureEvents.SELECTED_IN_CONNECTED_SET, (feature) => {
    if (!board || !board._connectedSet || board._connectedSet.length === 0) return;
    const id = String(feature.id);
    board._connectedCurrent = id;
    bus.emit(FeatureEvents.CONNECTED_SET_UPDATED, {
      ids: board._connectedSet,
      primary: board._connectedPrimary,
      current: board._connectedCurrent,
    });
    bus.emit(FeatureEvents.SELECTED, feature);
  });

  bus.on(UIEvents.DETAILS_HIDE, () => {
    if (!board) return;
    board._connectedSet = [];
    board._connectedPrimary = null;
    board._connectedCurrent = null;
    bus.emit(FeatureEvents.CONNECTED_SET_UPDATED, {
      ids: [],
      primary: null,
      current: null,
    });
  });

  bus.once(AppEvents.READY, () => {
    _boardReady = true;
    renderFeatures();
  });
}
