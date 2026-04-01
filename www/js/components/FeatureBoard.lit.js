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
class FeatureBoard extends LitElement {
  static properties = {
    features: { type: Array },
  };

  constructor() {
    super();
    this.features = [];
    this._cardMap = new Map();
    this._boundHandlers = new Map();
  }

  static styles = css`
    :host {
      display: block;
      flex: 1;
      position: relative;
      overflow: auto;
      padding: 0;
      /* Alternating month background aligned with card lanes */
      background: repeating-linear-gradient(
        to right,
        var(--color-bg, #f7f7f7) 0,
        var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
        var(--color-month-alt, #ececec) var(--timeline-month-width, 120px),
        var(--color-month-alt, #ececec) calc(var(--timeline-month-width, 120px) * 2)
      );
      background-position: 0 0; /* align stripes with card origin */
    }

    /* Keep native vertical scrollbar sizing unchanged (restore previous styling) */
    :host::-webkit-scrollbar {
      width: 12px;
      height: 12px;
    }
    :host {
      scrollbar-width: auto;
    }

    /* Placeholder styles for internal controls (we render fixed controls in body) */
    .scroll-controls {
      display: none;
    }

    .scroll-button {
      width: 36px;
      height: 36px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(0, 0, 0, 0.08);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #333;
      transition:
        transform 120ms ease,
        background 120ms ease;
    }

    .scroll-button:hover {
      transform: translateY(-2px);
    }
    .scroll-button:active {
      transform: translateY(0);
    }

    .scroll-button[aria-disabled='true'] {
      opacity: 0.5;
      pointer-events: none;
    }
    :host(.scenario-mode) {
      background: repeating-linear-gradient(
        to right,
        var(--color-bg, #f7f7f7) 0,
        var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
        var(--color-month-alt-scenario, #e2e2e2) var(--timeline-month-width, 120px),
        var(--color-month-alt-scenario, #e2e2e2)
          calc(var(--timeline-month-width, 120px) * 2)
      );
      background-position: 0 0;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('role')) {
      this.setAttribute('role', 'list');
    }
    // Defer creating the fixed scrollbar so document.body exists
    requestAnimationFrame(() => {
      this._ensureFixedScrollbar();
    });
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
      if (f.parentEpic) {
        const p = idKey(f.parentEpic);
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
      if (f.parentEpic) {
        const p = idKey(f.parentEpic);
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
    return html`${this.features.map(
      (featureObj) =>
        html`<feature-card-lit
          .feature=${featureObj.feature}
          .bus=${bus}
          .teams=${featureObj.teams}
          .condensed=${featureObj.condensed}
          .project=${featureObj.project}
          style="position:absolute; left:${featureObj.left}px; top:${featureObj.top}px; width:${featureObj.width}px"
        ></feature-card-lit>`
    )} `;
  }

  _scrollToTop() {
    this.scrollTo({ top: 0, behavior: 'smooth' });
  }

  _scrollToBottom() {
    this.scrollTo({ top: this.scrollHeight, behavior: 'smooth' });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._boundHandlers.forEach((handler, event) => {
      bus.off(event, handler);
    });
    this._boundHandlers.clear();
    this._destroyFixedScrollbar?.();
  }

  // ---- Fixed scrollbar ----

  _ensureFixedScrollbar() {
    if (this._fixedRail) return;

    const rail = document.createElement('div');
    rail.className = 'fb-fixed-rail';
    rail.setAttribute('aria-hidden', 'false');
    Object.assign(rail.style, {
      position: 'fixed',
      right: '4px',
      top: '72px',
      bottom: '20px',
      width: '12px',
      zIndex: 29,
      pointerEvents: 'auto',
    });

    const thumb = document.createElement('div');
    thumb.className = 'fb-fixed-thumb';
    Object.assign(thumb.style, {
      position: 'absolute',
      left: '0px',
      width: '100%',
      borderRadius: '6px',
      background: 'rgba(0,0,0,0.12)',
      cursor: 'pointer',
    });
    rail.appendChild(thumb);

    const controls = document.createElement('div');
    controls.className = 'fb-fixed-controls';
    Object.assign(controls.style, {
      position: 'fixed',
      right: '16px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      zIndex: 29,
    });

    const btnTop = document.createElement('button');
    btnTop.className = 'fb-btn-top';
    btnTop.title = 'Scroll to top';
    btnTop.innerText = '\u25B2';
    Object.assign(btnTop.style, {
      width: '36px',
      height: '36px',
      borderRadius: '18px',
      border: '1px solid rgba(0,0,0,0.08)',
      background: 'white',
      cursor: 'pointer',
    });

    const btnBottom = document.createElement('button');
    btnBottom.className = 'fb-btn-bottom';
    btnBottom.title = 'Scroll to bottom';
    btnBottom.innerText = '\u25BC';
    Object.assign(btnBottom.style, {
      width: '36px',
      height: '36px',
      borderRadius: '18px',
      border: '1px solid rgba(0,0,0,0.08)',
      background: 'white',
      cursor: 'pointer',
    });

    controls.appendChild(btnTop);
    controls.appendChild(btnBottom);
    document.body.appendChild(rail);
    document.body.appendChild(controls);

    // Initially hidden - show on proximity
    rail.style.opacity = '0';
    rail.style.transition = 'opacity 180ms ease';
    rail.style.pointerEvents = 'none';
    controls.style.opacity = '0';
    controls.style.transition = 'opacity 180ms ease';
    controls.style.pointerEvents = 'none';

    const onScroll = () => {
      if (this._thumbUpdateScheduled) return;
      this._thumbUpdateScheduled = true;
      requestAnimationFrame(() => {
        this._thumbUpdateScheduled = false;
        this._updateFixedThumb();
      });
    };

    const onResize = () => {
      this._updateRailPosition();
      this._updateFixedThumb();
    };

    const onDetailsShow = () => {
      hideRail();
      this._detailsOpen = true;
    };

    const onDetailsHide = () => {
      showRail();
      this._detailsOpen = false;
      this._updateFixedThumb();
    };

    let hideTimer = null;
    const proximityPx = 50;

    const showRail = () => {
      if (this._dragging) return;
      rail.style.opacity = '1';
      rail.style.pointerEvents = 'auto';
      controls.style.opacity = '1';
      controls.style.pointerEvents = 'auto';
    };

    const hideRail = () => {
      if (this._dragging) return;
      rail.style.opacity = '0';
      rail.style.pointerEvents = 'none';
      controls.style.opacity = '0';
      controls.style.pointerEvents = 'none';
    };

    const onMouseMove = (ev) => {
      const vw = window.innerWidth;
      if (vw - ev.clientX <= proximityPx) {
        showRail();
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      } else {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          hideRail();
          hideTimer = null;
        }, 10);
      }
    };

    const onRailEnter = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      showRail();
    };

    const onRailLeave = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideRail();
        hideTimer = null;
      }, 10);
    };

    thumb.addEventListener('pointerdown', (e) => this._startThumbDrag(e));
    btnTop.addEventListener('click', () => this._scrollToTop());
    btnBottom.addEventListener('click', () => this._scrollToBottom());
    this.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('mousemove', onMouseMove);
    rail.addEventListener('pointerenter', onRailEnter);
    rail.addEventListener('pointerleave', onRailLeave);
    bus.on(UIEvents.DETAILS_SHOW, onDetailsShow);
    bus.on(UIEvents.DETAILS_HIDE, onDetailsHide);

    this._fixedRail = rail;
    this._fixedThumb = thumb;
    this._fixedControls = controls;
    this._fixedHandlers = {
      onScroll,
      onResize,
      onMouseMove,
      onRailEnter,
      onRailLeave,
      onDetailsShow,
      onDetailsHide,
    };
    this._updateRailPosition();
    this._updateFixedThumb();
  }

  _updateRailPosition() {
    if (!this._fixedRail) return;
    const timelineHeader = findInBoard('timeline-lit');
    const rect = timelineHeader.getBoundingClientRect();
    this._fixedRail.style.top = Math.max(8, rect.bottom + 6) + 'px';
  }

  _destroyFixedScrollbar() {
    this._fixedRail.remove();
    this._fixedRail = null;
    this._fixedControls.remove();
    this._fixedControls = null;
    this._fixedThumb = null;
    this.removeEventListener('scroll', this._fixedHandlers.onScroll);
    window.removeEventListener('resize', this._fixedHandlers.onResize);
    document.removeEventListener('mousemove', this._fixedHandlers.onMouseMove);
    document.removeEventListener('mousemove', this._fixedHandlers.onMouseMove);
    bus.off?.(UIEvents.DETAILS_SHOW, this._fixedHandlers.onDetailsShow);
    bus.off?.(UIEvents.DETAILS_HIDE, this._fixedHandlers.onDetailsHide);
    this._fixedHandlers = null;
  }

  _updateFixedThumb() {
    if (!this._fixedRail || !this._fixedThumb) return;
    const railRect = this._fixedRail.getBoundingClientRect();
    const clientH = this.clientHeight || 0;
    const scrollH = this.scrollHeight || 0;
    if (scrollH <= clientH) {
      this._fixedThumb.style.display = 'none';
      return;
    }
    this._fixedThumb.style.display = '';
    const railHeight = Math.max(20, railRect.height);
    const thumbH = Math.max(20, Math.round(railHeight * (clientH / scrollH)));
    const maxTop = railHeight - thumbH;
    const frac = (this.scrollTop || 0) / (scrollH - clientH);
    this._fixedThumb.style.height = thumbH + 'px';
    this._fixedThumb.style.top = Math.round(frac * maxTop) + 'px';
  }

  _startThumbDrag(e) {
    e.preventDefault();
    this._dragging = true;
    const onMove = (ev) => this._onThumbMove(ev);
    const onUp = () => {
      this._dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  _onThumbMove(ev) {
    if (!this._dragging || !this._fixedRail || !this._fixedThumb) return;
    const railRect = this._fixedRail.getBoundingClientRect();
    const thumbH = this._fixedThumb.getBoundingClientRect().height;
    const y = ev.clientY - railRect.top - thumbH / 2;
    const maxY = Math.max(0, railRect.height - thumbH);
    const frac = Math.max(0, Math.min(maxY, y)) / (railRect.height - thumbH || 1);
    this.scrollTop = Math.round(frac * (this.scrollHeight - this.clientHeight));
    this._updateFixedThumb();
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

  _buildChildrenMap(features) {
    const childrenMap = new Map();
    features.forEach((f) => {
      if (f.type === 'feature' && f.parentEpic) {
        if (!childrenMap.has(f.parentEpic)) childrenMap.set(f.parentEpic, []);
        childrenMap.get(f.parentEpic).push(f);
      }
    });
    return childrenMap;
  }

  _orderFeaturesHierarchically(sourceFeatures, sortMode) {
    const sortFn =
      sortMode === 'rank' ? this._sortByRank.bind(this) : this._sortByDate.bind(this);
    const epics = sortFn(sourceFeatures.filter((f) => f.type === 'epic'));
    const childrenMap = this._buildChildrenMap(sourceFeatures);
    childrenMap.forEach((children) => sortFn(children));
    const standalone = sortFn(
      sourceFeatures.filter((f) => f.type === 'feature' && !f.parentEpic)
    );

    const ordered = [];
    for (const epic of epics) {
      ordered.push(epic);
      ordered.push(...(childrenMap.get(epic.id) || []));
    }
    ordered.push(...standalone);

    const included = new Set(ordered.map((f) => f.id));
    const remaining = sortFn(sourceFeatures.filter((f) => !included.has(f.id)));
    if (remaining.length) ordered.push(...remaining);
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
    if (feature.parentEpic) {
      const parent = allFeatures.find((f) => f.id === feature.parentEpic);
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
          .filter((f) => f.type === 'epic' && projectTypePlanIds.has(f.project))
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

    if (feature.type === 'epic' && !state._viewService.showEpics) return false;
    if (feature.type === 'feature' && !state._viewService.showFeatures) return false;

    if (featureFlags.SHOW_UNPLANNED_WORK) {
      if (this._isUnplanned(feature) && !state._viewService.showUnplannedWork)
        return false;
    }

    // If a project/plan is selected, show tasks from that project regardless of team selection.
    const selectedProjectIds = new Set(
      state.projects.filter((p) => p.selected).map((p) => String(p.id))
    );

    if (feature.type === 'epic') {
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

  async renderFeatures() {
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

  // After render, update card map and scrollbar
  updated() {
    if (!this.shadowRoot) return;
    const cards = this.shadowRoot.querySelectorAll('feature-card-lit');
    this._cardMap.clear();
    cards.forEach((node) => {
      if (node.feature?.id) this._cardMap.set(node.feature.id, node);
    });
    this._ensureFixedScrollbar();
    this._updateFixedThumb();
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
    const timeline = findInBoard('#timelineSection');
    if (!card || !timeline) return;

    const cardCenterX = (card.offsetLeft || 0) + (card.clientWidth || 0) / 2;
    const cardCenterY = (card.offsetTop || 0) + (card.clientHeight || 0) / 2;
    timeline.scrollTo({
      left: Math.max(0, Math.round(cardCenterX - timeline.clientWidth / 2)),
      behavior: 'smooth',
    });
    this.scrollTo({
      top: Math.max(0, Math.round(cardCenterY - this.clientHeight / 2)),
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
    if (activeScenario && !activeScenario.readonly) {
      board.classList.add('scenario-mode');
    } else {
      board.classList.remove('scenario-mode');
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
