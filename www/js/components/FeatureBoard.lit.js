import { LitElement, html, css } from '../vendor/lit.js';
import { ProjectEvents, TeamEvents, TimelineEvents, FeatureEvents, FilterEvents, ScenarioEvents, ViewEvents, AppEvents, UIEvents } from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { getTimelineMonths } from './Timeline.lit.js';
import { laneHeight, computePosition } from './board-utils.js';
import { featureFlags } from '../config.js';
 
// Helper to locate elements inside timeline-board's render root when TimelineBoard
// uses shadow DOM. Falls back to document queries for older behavior.
function findInBoard(selector){
  try{
    const boardEl = document.querySelector('timeline-board');
    if(boardEl){
      const root = boardEl.renderRoot || boardEl.shadowRoot || boardEl;
      const found = root && root.querySelector ? root.querySelector(selector) : null;
      if(found) return found;
    }
  }catch(e){}
  return document.querySelector(selector) || document.getElementById(selector.replace(/^#/,'')) || null;
}

class FeatureBoard extends LitElement {
  static properties = {
    features: { type: Array }
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
      background:
        repeating-linear-gradient(to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) calc(var(--timeline-month-width, 120px) * 2)
        );
      background-position: 0 0; /* align stripes with card origin */
    }

    /* Keep native vertical scrollbar sizing unchanged (restore previous styling) */
    :host::-webkit-scrollbar { width: 12px; height: 12px; }
    :host { scrollbar-width: auto; }

    /* Placeholder styles for internal controls (we render fixed controls in body) */
    .scroll-controls { display: none; }

    .scroll-button {
      width: 36px;
      height: 36px;
      border-radius: 18px;
      background: rgba(255,255,255,0.9);
      border: 1px solid rgba(0,0,0,0.08);
      box-shadow: 0 2px 6px rgba(0,0,0,0.08);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #333;
      transition: transform 120ms ease, background 120ms ease;
    }

    .scroll-button:hover { transform: translateY(-2px); }
    .scroll-button:active { transform: translateY(0); }

    .scroll-button[aria-disabled="true"] { opacity: 0.5; pointer-events: none; }
    :host(.scenario-mode) {
      background:
        repeating-linear-gradient(to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2) calc(var(--timeline-month-width, 120px) * 2)
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
    try {
      requestAnimationFrame(() => { try { this._ensureFixedScrollbar(); } catch (e) {} });
    } catch (e) {}
  }

  render() {
    if (!this.features?.length) {
      return html`<slot></slot>`;
    }
    return html`${this.features.map(featureObj => html`<feature-card-lit
        .feature=${featureObj.feature}
        .bus=${bus}
        .teams=${featureObj.teams}
        .condensed=${featureObj.condensed}
        .project=${featureObj.project}
        style="position:absolute; left:${featureObj.left}px; top:${featureObj.top}px; width:${featureObj.width}px"
      ></feature-card-lit>`)}
    `;
  }

  _scrollToTop() {
    try { this.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (e) { this.scrollTop = 0; }
  }

  _scrollToBottom() {
    try { this.scrollTo({ top: this.scrollHeight, behavior: 'smooth' }); }
    catch (e) { this.scrollTop = this.scrollHeight || 0; }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._boundHandlers.forEach((handler, event) => {
      bus.off(event, handler);
    });
    this._boundHandlers.clear();
    try { this._destroyFixedScrollbar?.(); } catch (e) {}
  }

  // ---- Fixed scrollbar ----

  _ensureFixedScrollbar() {
    if (this._fixedRail) return;

    const rail = document.createElement('div');
    rail.className = 'fb-fixed-rail';
    rail.setAttribute('aria-hidden', 'false');
    Object.assign(rail.style, {
      position: 'fixed', right: '4px', top: '72px', bottom: '20px',
      width: '12px', zIndex: 29, pointerEvents: 'auto'
    });

    const thumb = document.createElement('div');
    thumb.className = 'fb-fixed-thumb';
    Object.assign(thumb.style, {
      position: 'absolute', left: '0px', width: '100%',
      borderRadius: '6px', background: 'rgba(0,0,0,0.12)', cursor: 'pointer'
    });
    rail.appendChild(thumb);

    const controls = document.createElement('div');
    controls.className = 'fb-fixed-controls';
    Object.assign(controls.style, {
      position: 'fixed', right: '16px', top: '50%', transform: 'translateY(-50%)',
      display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 29
    });

    const btnTop = document.createElement('button');
    btnTop.className = 'fb-btn-top';
    btnTop.title = 'Scroll to top';
    btnTop.innerText = '\u25B2';
    Object.assign(btnTop.style, {
      width: '36px', height: '36px', borderRadius: '18px',
      border: '1px solid rgba(0,0,0,0.08)', background: 'white', cursor: 'pointer'
    });

    const btnBottom = document.createElement('button');
    btnBottom.className = 'fb-btn-bottom';
    btnBottom.title = 'Scroll to bottom';
    btnBottom.innerText = '\u25BC';
    Object.assign(btnBottom.style, {
      width: '36px', height: '36px', borderRadius: '18px',
      border: '1px solid rgba(0,0,0,0.08)', background: 'white', cursor: 'pointer'
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

    const onScroll = () => this._updateFixedThumb();
    const onResize = () => { this._updateRailPosition(); this._updateFixedThumb(); };
    const onDetailsShow = () => { try { hideRail(); this._detailsOpen = true; } catch (e) {} };
    const onDetailsHide = () => { try { showRail(); this._detailsOpen = false; this._updateFixedThumb(); } catch (e) {} };

    let hideTimer = null;
    const proximityPx = 50;
    const showRail = () => {
      try {
        if (this._dragging) return;
        rail.style.opacity = '1'; rail.style.pointerEvents = 'auto';
        controls.style.opacity = '1'; controls.style.pointerEvents = 'auto';
      } catch (e) {}
    };
    const hideRail = () => {
      try {
        if (this._dragging) return;
        rail.style.opacity = '0'; rail.style.pointerEvents = 'none';
        controls.style.opacity = '0'; controls.style.pointerEvents = 'none';
      } catch (e) {}
    };
    const onMouseMove = (ev) => {
      try {
        const vw = window.innerWidth || document.documentElement.clientWidth;
        if (vw - ev.clientX <= proximityPx) {
          showRail();
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        } else {
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => { hideRail(); hideTimer = null; }, 10);
        }
      } catch (e) {}
    };
    const onRailEnter = () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } showRail(); };
    const onRailLeave = () => { if (hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(() => { hideRail(); hideTimer = null; }, 10); };

    thumb.addEventListener('pointerdown', (e) => this._startThumbDrag(e));
    btnTop.addEventListener('click', () => this._scrollToTop());
    btnBottom.addEventListener('click', () => this._scrollToBottom());
    this.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousemove', onMouseMove);
    rail.addEventListener('pointerenter', onRailEnter);
    rail.addEventListener('pointerleave', onRailLeave);
    try { bus.on(UIEvents.DETAILS_SHOW, onDetailsShow); bus.on(UIEvents.DETAILS_HIDE, onDetailsHide); } catch (e) {}

    this._fixedRail = rail;
    this._fixedThumb = thumb;
    this._fixedControls = controls;
    this._fixedHandlers = { onScroll, onResize, onMouseMove, onRailEnter, onRailLeave, onDetailsShow, onDetailsHide };
    this._updateRailPosition();
    this._updateFixedThumb();
  }

  _updateRailPosition() {
    try {
      if (!this._fixedRail) return;
      const timelineHeader = findInBoard('timeline-lit');
      if (timelineHeader) {
        const rect = timelineHeader.getBoundingClientRect();
        this._fixedRail.style.top = Math.max(8, rect.bottom + 6) + 'px';
      } else {
        this._fixedRail.style.top = '72px';
      }
    } catch (e) {}
  }

  _destroyFixedScrollbar() {
    try { this._fixedRail?.remove(); } catch (e) {} this._fixedRail = null;
    try { this._fixedControls?.remove(); } catch (e) {} this._fixedControls = null;
    this._fixedThumb = null;
    if (this._fixedHandlers) {
      try { this.removeEventListener('scroll', this._fixedHandlers.onScroll); } catch (e) {}
      try { window.removeEventListener('resize', this._fixedHandlers.onResize); } catch (e) {}
      try { document.removeEventListener('mousemove', this._fixedHandlers.onMouseMove); } catch (e) {}
      try { bus.off?.(UIEvents.DETAILS_SHOW, this._fixedHandlers.onDetailsShow); } catch (e) {}
      try { bus.off?.(UIEvents.DETAILS_HIDE, this._fixedHandlers.onDetailsHide); } catch (e) {}
      this._fixedHandlers = null;
    }
  }

  _updateFixedThumb() {
    try {
      if (!this._fixedRail || !this._fixedThumb) return;
      const railRect = this._fixedRail.getBoundingClientRect();
      const clientH = this.clientHeight || 0;
      const scrollH = this.scrollHeight || 0;
      if (scrollH <= clientH) { this._fixedThumb.style.display = 'none'; return; }
      this._fixedThumb.style.display = '';
      const railHeight = Math.max(20, railRect.height);
      const thumbH = Math.max(20, Math.round(railHeight * (clientH / scrollH)));
      const maxTop = railHeight - thumbH;
      const frac = (this.scrollTop || 0) / (scrollH - clientH);
      this._fixedThumb.style.height = thumbH + 'px';
      this._fixedThumb.style.top = Math.round(frac * maxTop) + 'px';
    } catch (e) {}
  }

  _startThumbDrag(e) {
    try {
      e.preventDefault();
      this._dragging = true;
      const onMove = (ev) => this._onThumbMove(ev);
      const onUp = () => { this._dragging = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    } catch (e) { this._dragging = false; }
  }

  _onThumbMove(ev) {
    try {
      if (!this._dragging || !this._fixedRail || !this._fixedThumb) return;
      const railRect = this._fixedRail.getBoundingClientRect();
      const thumbH = this._fixedThumb.getBoundingClientRect().height;
      const y = ev.clientY - railRect.top - (thumbH / 2);
      const maxY = Math.max(0, railRect.height - thumbH);
      const frac = Math.max(0, Math.min(maxY, y)) / (railRect.height - thumbH || 1);
      this.scrollTop = Math.round(frac * (this.scrollHeight - this.clientHeight));
      this._updateFixedThumb();
    } catch (e) {}
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
    features.forEach(f => {
      if (f.type === 'feature' && f.parentEpic) {
        if (!childrenMap.has(f.parentEpic)) childrenMap.set(f.parentEpic, []);
        childrenMap.get(f.parentEpic).push(f);
      }
    });
    return childrenMap;
  }

  _orderFeaturesHierarchically(sourceFeatures, sortMode) {
    const sortFn = sortMode === 'rank' ? this._sortByRank.bind(this) : this._sortByDate.bind(this);
    const epics = sortFn(sourceFeatures.filter(f => f.type === 'epic'));
    const childrenMap = this._buildChildrenMap(sourceFeatures);
    childrenMap.forEach(children => sortFn(children));
    const standalone = sortFn(sourceFeatures.filter(f => f.type === 'feature' && !f.parentEpic));

    const ordered = [];
    for (const epic of epics) {
      ordered.push(epic);
      ordered.push(...(childrenMap.get(epic.id) || []));
    }
    ordered.push(...standalone);

    const included = new Set(ordered.map(f => f.id));
    const remaining = sortFn(sourceFeatures.filter(f => !included.has(f.id)));
    if (remaining.length) ordered.push(...remaining);
    return ordered;
  }

  _isUnplanned(feature) {
    return !feature.start || !feature.end;
  }

  _isHierarchicallyLinkedToSelectedProjectEpics(feature, allFeatures, selectedProjectEpicIds, visited = new Set()) {
    if (!feature) return false;
    if (visited.has(feature.id)) return false;
    visited.add(feature.id);
    if (selectedProjectEpicIds.has(feature.id)) return true;
    if (feature.parentEpic) {
      const parent = allFeatures.find(f => f.id === feature.parentEpic);
      if (parent) return this._isHierarchicallyLinkedToSelectedProjectEpics(parent, allFeatures, selectedProjectEpicIds, visited);
    }
    if (Array.isArray(feature.relations)) {
      const parentRel = feature.relations.find(r => r.type === 'Parent');
      if (parentRel?.id) {
        const parent = allFeatures.find(f => f.id === parentRel.id);
        if (parent) return this._isHierarchicallyLinkedToSelectedProjectEpics(parent, allFeatures, selectedProjectEpicIds, visited);
      }
    }
    return false;
  }

  _featurePassesFilters(feature, childrenMap, allFeatures = []) {
    // Basic filters that always apply
    const stateFilter = state.selectedFeatureStateFilter instanceof Set
      ? state.selectedFeatureStateFilter
      : new Set(state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []);
    if (stateFilter.size === 0) return false;
    const featureState = feature.status || feature.state;
    if (!stateFilter.has(featureState)) return false;

    if (feature.type === 'epic' && !state._viewService.showEpics) return false;
    if (feature.type === 'feature' && !state._viewService.showFeatures) return false;

    if (featureFlags.SHOW_UNPLANNED_WORK) {
      if (this._isUnplanned(feature) && !state._viewService.showUnplannedWork) return false;
    }

    // Build base set: features belonging to selected plans
    const selectedProjects = state.projects.filter(p => p.selected).map(p => p.id);
    const baseSet = new Set();
    
    for (const f of allFeatures) {
      if (selectedProjects.includes(f.project)) {
        baseSet.add(f.id);
      }
    }

    // Apply showOnlyProjectHierarchy if enabled (filters base set)
    let visibleFeatureIds = new Set(baseSet);
    
    if (state._viewService.showOnlyProjectHierarchy) {
      const projectTypePlans = state.projects.filter(p => {
        const planType = p.type ? String(p.type) : 'project';
        return p.selected && planType === 'project';
      });
      const projectTypePlanIds = new Set(projectTypePlans.map(p => p.id));
      const projectTypeEpicIds = new Set(
        allFeatures.filter(f => f.type === 'epic' && projectTypePlanIds.has(f.project)).map(f => f.id)
      );
      
      // Filter baseSet to only include hierarchically linked features
      visibleFeatureIds = new Set();
      for (const fid of baseSet) {
        const feat = allFeatures.find(f => f.id === fid);
        if (feat && this._isHierarchicallyLinkedToSelectedProjectEpics(feat, allFeatures, projectTypeEpicIds)) {
          visibleFeatureIds.add(fid);
        }
      }
    }

    // Additive filtering: expand the visible set based on enabled filters
    
    // Expand with parent-child tree if enabled
    if (state._viewService.showParentChildTree && visibleFeatureIds.size > 0) {
      const expanded = state.featureService.getFeaturesByParentChildLinks(visibleFeatureIds);
      for (const id of expanded) {
        visibleFeatureIds.add(id);
      }
    }

    // Expand with dependency links if enabled
    if (state._viewService.showDependencyLinks && visibleFeatureIds.size > 0) {
      const expanded = state.featureService.getFeaturesByDependencies(visibleFeatureIds);
      for (const id of expanded) {
        visibleFeatureIds.add(id);
      }
    }

    // Expand with team allocations if enabled
    if (state._viewService.showAllTeamAllocations) {
      const selectedTeams = state.teams.filter(t => t.selected).map(t => t.id);
      const teamFeatures = state.featureService.getFeaturesByTeamAllocation(new Set(selectedTeams));
      for (const id of teamFeatures) {
        visibleFeatureIds.add(id);
      }
    }

    // Check if current feature is in the visible set
    if (!visibleFeatureIds.has(feature.id)) {
      // If showUnlinkedTasks is disabled, hide this feature
      if (!state._viewService.showUnlinkedTasks) {
        return false;
      }
      // Feature is not in visible set - check if it belongs to selected project
      const project = state.projects.find(p => p.id === feature.project && p.selected);
      if (!project) return false;
    }

    // Check team/capacity visibility for epics and features
    if (feature.type === 'epic') {
      const children = childrenMap.get(feature.id) || [];
      const anyChildVisible = children.some(child => {
        const childProject = state.projects.find(p => p.id === child.project && p.selected);
        if (!childProject) return false;
        if (featureFlags.SHOW_UNPLANNED_WORK && this._isUnplanned(child) && !state._viewService.showUnplannedWork) return false;
        const hasCapacity = child.capacity?.length > 0;
        if (!hasCapacity) return state._viewService.showUnassignedCards;
        return child.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected));
      });
      const hasCapacity = feature.capacity?.length > 0;
      const epicVisible = hasCapacity
        ? feature.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected))
        : state._viewService.showUnassignedCards;
      if (!epicVisible && !anyChildVisible) return false;
    } else {
      const hasCapacity = feature.capacity?.length > 0;
      if (!hasCapacity) {
        if (!state._viewService.showUnassignedCards) return false;
      } else {
        if (!feature.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected))) return false;
      }
    }
    
    return true;
  }

  // ---- Render features ----

  async renderFeatures() {
    const sourceFeatures = state.getEffectiveFeatures();
    const ordered = this._orderFeaturesHierarchically(sourceFeatures, state._viewService.featureSortMode);
    const childrenMap = this._buildChildrenMap(sourceFeatures);
    const months = getTimelineMonths();

    // Precompute lookups to avoid O(N^2) operations during per-feature checks
    const featureById = new Map(sourceFeatures.map(f => [f.id, f]));

    // Build reverse dependency map once if dependency expansion is enabled
    let reverseDeps = null;
    if (state._viewService.showDependencyLinks) {
      reverseDeps = new Map();
      for (const f of sourceFeatures) {
        if (Array.isArray(f.relations)) {
          for (const rel of f.relations) {
            if ((rel.type === 'Predecessor' || rel.type === 'Successor') && rel.id) {
              if (!reverseDeps.has(rel.id)) reverseDeps.set(rel.id, []);
              reverseDeps.get(rel.id).push(f.id);
            }
          }
        }
      }
    }

    // Compute base set of visible features (by selected projects)
    const selectedProjects = new Set(state.projects.filter(p => p.selected).map(p => p.id));
    const baseSet = new Set();
    for (const f of sourceFeatures) {
      if (selectedProjects.has(f.project)) baseSet.add(f.id);
    }

    // Apply project-hierarchy filter if enabled
    let visibleFeatureIds = new Set(baseSet);
    if (state._viewService.showOnlyProjectHierarchy) {
      const projectTypePlans = state.projects.filter(p => {
        const planType = p.type ? String(p.type) : 'project';
        return p.selected && planType === 'project';
      });
      const projectTypePlanIds = new Set(projectTypePlans.map(p => p.id));
      const projectTypeEpicIds = new Set(sourceFeatures.filter(f => f.type === 'epic' && projectTypePlanIds.has(f.project)).map(f => f.id));

      visibleFeatureIds = new Set();
      for (const fid of baseSet) {
        const feat = featureById.get(fid);
        if (feat && this._isHierarchicallyLinkedToSelectedProjectEpics(feat, sourceFeatures, projectTypeEpicIds)) {
          visibleFeatureIds.add(fid);
        }
      }
    }

    // Helper: expand via parent-child traversal using childrenMap and featureById
    const expandParentChild = (startIds) => {
      const res = new Set(startIds);
      const visited = new Set();
      const stack = [...startIds];
      while (stack.length) {
        const id = stack.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        res.add(id);
        // children
        const childIds = childrenMap.get(id) || [];
        for (const cid of childIds) if (!visited.has(cid)) stack.push(cid);
        // parent via parentEpic or Parent relation
        const f = featureById.get(id);
        if (f) {
          if (f.parentEpic) { if (!visited.has(f.parentEpic)) stack.push(f.parentEpic); }
          if (Array.isArray(f.relations)) {
            const parentRel = f.relations.find(r => r.type === 'Parent');
            if (parentRel?.id && !visited.has(parentRel.id)) stack.push(parentRel.id);
          }
        }
      }
      return res;
    };

    // Helper: expand via dependency traversal using featureById and reverseDeps
    const expandDependencies = (startIds) => {
      const res = new Set(startIds);
      const visited = new Set();
      const stack = [...startIds];
      while (stack.length) {
        const id = stack.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        res.add(id);
        const f = featureById.get(id);
        if (f && Array.isArray(f.relations)) {
          for (const rel of f.relations) {
            if ((rel.type === 'Predecessor' || rel.type === 'Successor') && rel.id && !visited.has(rel.id)) stack.push(rel.id);
          }
        }
        const dependents = (reverseDeps && reverseDeps.get(id)) || [];
        for (const depId of dependents) if (!visited.has(depId)) stack.push(depId);
      }
      return res;
    };

    // Expand visible set based on additive filters
    if (state._viewService.showParentChildTree && visibleFeatureIds.size > 0) {
      const expanded = expandParentChild(Array.from(visibleFeatureIds));
      for (const id of expanded) visibleFeatureIds.add(id);
    }

    if (state._viewService.showDependencyLinks && visibleFeatureIds.size > 0) {
      const expanded = expandDependencies(Array.from(visibleFeatureIds));
      for (const id of expanded) visibleFeatureIds.add(id);
    }

    let teamFeatureSet = null;
    if (state._viewService.showAllTeamAllocations) {
      const selectedTeams = new Set(state.teams.filter(t => t.selected).map(t => t.id));
      teamFeatureSet = new Set();
      for (const f of sourceFeatures) {
        if (Array.isArray(f.capacity)) {
          for (const tl of f.capacity) {
            if (tl && tl.team && selectedTeams.has(tl.team) && (Number(tl.capacity) || 0) > 0) {
              teamFeatureSet.add(f.id);
              break;
            }
          }
        }
      }
      for (const id of teamFeatureSet) visibleFeatureIds.add(id);
    }

    const renderList = [];
    let laneIndex = 0;

    for (const feature of ordered) {
      // Quick membership check against precomputed visible set
      if (!visibleFeatureIds.has(feature.id)) continue;

      // Per-feature state and type checks (still required)
      const stateFilter = state.selectedFeatureStateFilter instanceof Set
        ? state.selectedFeatureStateFilter
        : new Set(state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []);
      if (stateFilter.size === 0) continue;
      const featureState = feature.status || feature.state;
      if (!stateFilter.has(featureState)) continue;

      if (feature.type === 'epic' && !state._viewService.showEpics) continue;
      if (feature.type === 'feature' && !state._viewService.showFeatures) continue;

      if (featureFlags.SHOW_UNPLANNED_WORK) {
        if (this._isUnplanned(feature) && !state._viewService.showUnplannedWork) continue;
      }

      // Team allocation visibility (when not globally expanded)
      if (!state._viewService.showAllTeamAllocations) {
        if (feature.type === 'epic') {
          // Epic visible if it or any child has selected team capacity
          const childIds = childrenMap.get(feature.id) || [];
          const anyChildVisible = childIds.some(cid => {
            const child = featureById.get(cid);
            if (!child) return false;
            const hasCapacity = child.capacity?.length > 0;
            if (!hasCapacity) return state._viewService.showUnassignedCards;
            return child.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected));
          });
          const hasCapacity = feature.capacity?.length > 0;
          const epicVisible = hasCapacity
            ? feature.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected))
            : state._viewService.showUnassignedCards;
          if (!epicVisible && !anyChildVisible) continue;
        } else {
          const hasCapacity = feature.capacity?.length > 0;
          if (!hasCapacity) {
            if (!state._viewService.showUnassignedCards) continue;
          } else {
            if (!feature.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected))) continue;
          }
        }
      }

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
        project: state.projects.find(p => p.id === feature.project)
      });
      laneIndex++;
    }

    this.features = renderList;
    this.requestUpdate();

    if (renderList.length === 0) {
      try {
        const mh = await import('./modalHelpers.js');
        if (typeof mh?.openEmptyBoardModal === 'function') {
          mh.openEmptyBoardModal({ parent: document.body }).catch(() => {});
        }
      } catch (e) {}
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
      const left = geom.left !== undefined ? (typeof geom.left === 'number' ? `${geom.left}px` : geom.left) : '';
      const width = geom.width !== undefined ? (typeof geom.width === 'number' ? `${geom.width}px` : geom.width) : '';
      const project = state.projects.find(p => p.id === feature.project);

      existing.feature = { ...feature };
      existing.selected = !!feature.selected;
      existing.project = project;
      existing.applyVisuals({ left, width, selected: !!feature.selected, dirty: !!feature.dirty, project });
    }
  }

  // After render, update card map and scrollbar
  updated() {
    if (!this.shadowRoot) return;
    const cards = this.shadowRoot.querySelectorAll('feature-card-lit');
    this._cardMap.clear();
    cards.forEach(node => {
      if (node.feature?.id) this._cardMap.set(node.feature.id, node);
    });
    try { this._ensureFixedScrollbar(); this._updateFixedThumb(); } catch (e) {}
  }

  _selectFeature(feature) {
    this.dispatchEvent(new CustomEvent('feature-selected', {
      detail: { feature }, bubbles: true, composed: true
    }));
  }

  centerFeatureById(featureId) {
    try {
      const card = this._cardMap.get(String(featureId))
        || this.shadowRoot?.querySelector(`feature-card-lit[data-feature-id="${featureId}"]`);
      const timeline = findInBoard('#timelineSection');
      if (!card || !timeline) return;

      const cardCenterX = (card.offsetLeft || 0) + (card.clientWidth || 0) / 2;
      const cardCenterY = (card.offsetTop || 0) + (card.clientHeight || 0) / 2;
      timeline.scrollTo({ left: Math.max(0, Math.round(cardCenterX - timeline.clientWidth / 2)), behavior: 'smooth' });
      this.scrollTo({ top: Math.max(0, Math.round(cardCenterY - this.clientHeight / 2)), behavior: 'smooth' });

      try {
        card.classList.add('search-highlight');
        setTimeout(() => { try { card.classList.remove('search-highlight'); } catch (e) {} }, 950);
      } catch (e) {}
    } catch (e) { console.warn('centerFeatureById failed', e); }
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
  if (!board) { console.warn('feature-board element not found'); return; }

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
    const activeScenario = state.scenarios.find(s => s.id === scenarioId);
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
  bus.on(ViewEvents.PARENT_CHILD_TREE, renderFeatures);
  bus.on(ViewEvents.DEPENDENCY_LINKS, renderFeatures);
  bus.on(ViewEvents.UNLINKED_TASKS, renderFeatures);
  bus.on(ViewEvents.TEAM_ALLOCATIONS, renderFeatures);
  bus.on(ScenarioEvents.ACTIVATED, handleScenarioActivation);

  bus.once(AppEvents.READY, () => {
    _boardReady = true;
    renderFeatures();
  });
}
