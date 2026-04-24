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
  PlanSummaryEvents,
} from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { getTimelineMonths } from './Timeline.lit.js';
import { laneHeight, computePosition } from './board-utils.js';
import { featureFlags } from '../config.js';
import { findInBoard } from './board-utils.js';

class FeatureBoard extends LitElement {
  static properties = {
    features: { type: Array },
  };

  constructor() {
    super();
    this.features = [];
    this._cardMap = new Map();
    this._boundHandlers = new Map();
    // Swimlane drag-to-group state — used by board-level event delegation handlers
    this._dragOverCard = null;
    this._summaryGroupService = null; // cached after first load
    // Stable bound handlers for swimlane drag delegation (added once, never re-bound)
    this._onBoardDragOver = this._onBoardDragOver.bind(this);
    this._onBoardDragLeave = this._onBoardDragLeave.bind(this);
    this._onBoardDrop = this._onBoardDrop.bind(this);
    this._onBoardDragEnd = this._onBoardDragEnd.bind(this);
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

    }

    .scroll-button {
      width: 36px;
      height: 36px;
      border-radius: 18px;
  `;

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('role')) {
      this.setAttribute('role', 'list');
    }
    // Board-level drag delegation for swimlane group creation.
    // Binding here (not in the Lit template) means these listeners survive
    // every board re-render, eliminating the race window where Lit removes +
    // re-adds per-card arrow-function listeners between dragover and drop.
    this.addEventListener('dragover', this._onBoardDragOver);
    this.addEventListener('dragleave', this._onBoardDragLeave);
    this.addEventListener('drop', this._onBoardDrop);
    this.addEventListener('dragend', this._onBoardDragEnd);
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

  render() {
    if (!this.features?.length) {
      return html`<slot></slot>`;
    }
    const inSwimlaneMode = !!state._viewService?.planSummaryMode;
    return html`${this.features.map((featureObj) => {
      // Swimlane mode: render group bars alongside feature cards
      if (featureObj._layoutType === 'background') {
        // Full-width tinted band that visually identifies each swimlane row.
        // Use 8-digit hex alpha so background and border opacity are independent.
        const bc = featureObj.color;
        const bgColor = bc ? `${bc}1a` : 'transparent'; // ~10% opacity tint
        const borderColor = bc ? `${bc}55` : 'rgba(0,0,0,0.1)'; // ~33% opacity separator
        return html`<div
          style="position:absolute; left:0; right:0; top:${featureObj.top}px; height:${featureObj.height}px; background:${bgColor}; border-bottom:2px solid ${borderColor}; pointer-events:none"
          aria-hidden="true"
        ></div>`;
      }
      if (featureObj._layoutType === 'group') {
        return html`<summary-group-bar
          .group=${featureObj.group}
          .left=${featureObj.left}
          .width=${featureObj.width}
          .project=${featureObj.project}
          .condensed=${featureObj.condensed}
          style="position:absolute; left:${featureObj.left}px; top:${featureObj.top}px; width:${featureObj.width}px"
        ></summary-group-bar>`;
      }
      if (inSwimlaneMode) {
        // In swimlane mode feature cards are HTML5 drag sources so they can be
        // dropped onto other cards or group bars to create/join groups.
        // dragover/dragleave/drop are handled via board-level event delegation
        // (see connectedCallback) so per-card bindings are not used — this avoids
        // the race where Lit removes + re-adds arrow-function listeners on every
        // render, which could cause a dropped dragover and silently prevent drops.
        // Ghost titles (overflow labels) are hidden to keep the swimlane clean.
        return html`<feature-card-lit
          .feature=${featureObj.feature}
          .bus=${bus}
          .teams=${featureObj.teams}
          .condensed=${featureObj.condensed}
          .project=${featureObj.project}
          .hideGhostTitle=${true}
          .groupColor=${featureObj.groupColor}
          draggable="true"
          data-feature-id="${featureObj.feature?.id}"
          @dragstart=${(e) => this._onCardDragStart(e, featureObj.feature)}
          style="position:absolute; left:${featureObj.left}px; top:${featureObj.top}px; width:${featureObj.width}px"
        ></feature-card-lit>`;
      }

      return html`<feature-card-lit
        .feature=${featureObj.feature}
        .bus=${bus}
        .teams=${featureObj.teams}
        .condensed=${featureObj.condensed}
        .project=${featureObj.project}
        style="position:absolute; left:${featureObj.left}px; top:${featureObj.top}px; width:${featureObj.width}px"
      ></feature-card-lit>`;
    })} `;
  }

  // ---- Drag-to-group handlers (swimlane mode only, board-level delegation) ----

  /**
   * Find the nearest feature-card-lit element in a composed event path.
   * Using composedPath() works across shadow DOM boundaries.
   * @param {EventTarget[]} path
   * @returns {HTMLElement|null}
   */
  _findFeatureCard(path) {
    for (const el of path) {
      if (el.tagName?.toUpperCase() === 'FEATURE-CARD-LIT') return el;
    }
    return null;
  }

  _clearDragHighlight() {
    if (this._dragOverCard) {
      this._dragOverCard.style.outline = '';
      this._dragOverCard.style.outlineOffset = '';
      this._dragOverCard = null;
    }
  }

  _onBoardDragOver(e) {
    if (!state._viewService?.planSummaryMode) return;
    e.preventDefault();
    const card = this._findFeatureCard(e.composedPath());
    if (card !== this._dragOverCard) {
      this._clearDragHighlight();
      if (card) {
        card.style.outline = '2px dashed rgba(92, 107, 192, 0.7)';
        card.style.outlineOffset = '2px';
        this._dragOverCard = card;
      }
    }
  }

  _onBoardDragLeave(e) {
    if (!state._viewService?.planSummaryMode) return;
    // Only clear when the cursor actually leaves the board, not when moving
    // between internal children (shadow DOM retargeting makes relatedTarget
    // a board child in that case).
    const related = e.relatedTarget;
    if (!related || !this.contains(related)) {
      this._clearDragHighlight();
    }
  }

  _onBoardDragEnd() {
    this._clearDragHighlight();
  }

  _onCardDragStart(e, feature) {
    if (!feature?.id) return;
    e.dataTransfer.setData('text/feature-id', String(feature.id));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/feature-project', String(feature.project ?? ''));
  }

  async _onBoardDrop(e) {
    if (!state._viewService?.planSummaryMode) return;
    e.preventDefault();
    this._clearDragHighlight();

    // Capture transferable data synchronously before any await.
    const draggedFeatureId = e.dataTransfer.getData('text/feature-id');
    const draggedProjectId = e.dataTransfer.getData('text/feature-project');

    const card = this._findFeatureCard(e.composedPath());
    const targetFeatureId = card?.getAttribute('data-feature-id') ?? '';

    if (!draggedFeatureId || !targetFeatureId || draggedFeatureId === targetFeatureId) return;

    // Load service lazily on first use; reuse cached reference thereafter.
    if (!this._summaryGroupService) {
      const mod = await import('../services/SummaryGroupService.js');
      this._summaryGroupService = mod.summaryGroupService;
    }
    const svc = this._summaryGroupService;
    const existingGroup = svc.getGroupForFeature(targetFeatureId);

    if (existingGroup) {
      svc.addMember(existingGroup.id, draggedFeatureId);
    } else {
      // Resolve project: try the drag-source's stored project ID first, then look
      // up the target card's project from the current render list.
      const projectId =
        draggedProjectId ||
        this.features.find(
          (f) => f._layoutType === 'feature' && String(f.feature?.id) === targetFeatureId
        )?.project?.id;
      if (projectId) {
        svc.createGroup([draggedFeatureId, targetFeatureId], String(projectId));
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('dragover', this._onBoardDragOver);
    this.removeEventListener('dragleave', this._onBoardDragLeave);
    this.removeEventListener('drop', this._onBoardDrop);
    this.removeEventListener('dragend', this._onBoardDragEnd);
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
   * Swimlane render path — used when plan summary mode is active.
   * Imports layout engine and group service lazily to avoid loading them during
   * normal board operation.
   */
  async _renderSwimlaneModeFeatures() {
    const [{ buildSwimlaneLayout, flattenSwimlaneLayout }, { summaryGroupService }] =
      await Promise.all([
        import('./SwimlaneLayout.js'),
        import('../services/SummaryGroupService.js'),
      ]);

    // Cache the service reference so _onBoardDrop can act synchronously
    // (no await) on subsequent drops once the board has rendered at least once.
    this._summaryGroupService = summaryGroupService;

    // Load the custom elements if not already defined
    if (!customElements.get('summary-group-bar')) {
      await import('./SummaryGroupBar.lit.js');
    }

    const allEffectiveFeatures = state.getEffectiveFeatures();
    const months = getTimelineMonths();

    // Apply the same type-visibility and state filters that normal board mode uses,
    // so hidden types and excluded states don't appear as extra cards.
    const _stateFilter =
      state.selectedFeatureStateFilter instanceof Set ?
        state.selectedFeatureStateFilter
      : new Set(
          state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []
        );
    const _stateFilterLower = new Set(
      Array.from(_stateFilter).map((s) => String(s).toLowerCase())
    );
    const sourceFeatures = allEffectiveFeatures.filter((f) => {
      if (!state._viewService.isTypeVisible(f.type)) return false;
      if (_stateFilter.size > 0 && !_stateFilterLower.has((f.state || '').toLowerCase()))
        return false;
      return true;
    });

    const selectedProjects = state.projects.filter((p) => p.selected);
    const groups = summaryGroupService.getGroups();

    const layout = buildSwimlaneLayout(sourceFeatures, groups, selectedProjects, months);

    // Emit swimlane layout so SwimlaneLabels can update (TimelineBoard listens)
    bus.emit(PlanSummaryEvents.LAYOUT_UPDATED, { swimlanes: layout.swimlanes });

    // Prepend background-band items (one per swimlane) so they render behind cards.
    // These are full-width tinted divs that clearly delineate each project's lane.
    const backgrounds = layout.swimlanes.map((lane) => ({
      _layoutType: 'background',
      top: lane.offsetY,
      height: lane.totalHeight,
      color: lane.project?.color ?? null,
    }));

    const renderList = [...backgrounds, ...flattenSwimlaneLayout(layout, state.teams, state._viewService.condensedCards)];
    this.features = renderList;

    const totalHeight = layout.totalHeight;
    try {
      const sc = findInBoard('#scroll-container');
      const minH = sc && sc.clientHeight ? sc.clientHeight : 0;
      this.style.height = Math.max(totalHeight, minH) + 'px';
    } catch (e) {
      this.style.height = totalHeight + 'px';
    }
    this.requestUpdate();
  }

  async renderFeatures() {
    // Branch to swimlane renderer when plan summary mode is active
    if (state._viewService?.planSummaryMode) {
      return this._renderSwimlaneModeFeatures();
    }

    const sourceFeatures = state.getEffectiveFeatures();
    const ordered = this._orderFeaturesHierarchically(
      sourceFeatures,
      state._viewService.featureSortMode
    );
    const childrenMap = this._buildChildrenMap(sourceFeatures);
    const months = getTimelineMonths();

    const renderList = [];
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
        project: state.projects.find((p) => p.id === feature.project),
      });
      laneIndex++;
    }

    this.features = renderList;
    // Explicitly size the host so #board-area (the positioned parent) has the
    // correct dimensions, allowing position:absolute overlays with inset:0 to
    // cover the full card area. Ensure we never shrink below the visible
    // scroll-container height so the background stripes always fill the screen.
    const totalHeight = renderList.length * laneHeight();
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

  // Plan summary mode: re-render when mode toggles or groups change
  bus.on(PlanSummaryEvents.MODE_CHANGED, renderFeatures);
  bus.on(PlanSummaryEvents.GROUP_CREATED, renderFeatures);
  bus.on(PlanSummaryEvents.GROUP_UPDATED, renderFeatures);
  bus.on(PlanSummaryEvents.GROUP_DISSOLVED, renderFeatures);

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
