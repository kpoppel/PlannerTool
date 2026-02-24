import { LitElement, html, css } from '../vendor/lit.js';
import { ProjectEvents, TeamEvents, TimelineEvents, FeatureEvents, FilterEvents, ScenarioEvents, ViewEvents, AppEvents, UIEvents } from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { getTimelineMonths } from './Timeline.lit.js';
import { laneHeight, computePosition, _test_resetCache } from './board-utils.js';
import { featureFlags } from '../config.js';

class FeatureBoard extends LitElement {
  static properties = {
    features: { type: Array }
  };

  constructor() {
    super();
    this.features = [];
    this._cardMap = new Map();
    this._boundHandlers = new Map();
    // Board-level ResizeObserver and observed inner-elements map
    this._ro = null;
    this._observedMap = new Map(); // Map<hostCard, innerElement>
    this._measureScheduled = false;
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

  // Use shadow DOM so component-scoped `static styles` apply.
  // Render a slot so any existing light-DOM children (or imperative
  // appendChild calls) will still be projected into the component.

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('role')) {
      this.setAttribute('role', 'list');
    }
    // Create a single ResizeObserver for all child cards' inner elements
    try {
      this._ro = new ResizeObserver((entries) => {
        if (this._measureScheduled) return;
        // schedule a single batched measurement
        this._measureScheduled = true;
        requestAnimationFrame(() => {
          this._measureScheduled = false;
          this._processMeasurements(entries);
        });
      });
    } catch (e) {
      // ResizeObserver may not be available in some test envs
      this._ro = null;
    }
    // Defer creating the fixed scrollbar so document.body exists
    try {
      requestAnimationFrame(() => { try { this._ensureFixedScrollbar(); } catch (e) { } });
    } catch (e) { }
  }

  render() {
    console.log('[FeatureBoard] render - features count:', this.features?.length);
    // When no features are to be shown we render the slot only; the
    // dedicated modal helper will be invoked from `renderFeatures()`.
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
    try {
      this.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { this.scrollTop = 0; }
  }

  _scrollToBottom() {
    try {
      this.scrollTo({ top: this.scrollHeight, behavior: 'smooth' });
    } catch (e) { this.scrollTop = this.scrollHeight || 0; }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._boundHandlers.forEach((handler, event) => {
      bus.off(event, handler);
    });
    this._boundHandlers.clear();
    try {
      if (this._ro) {
        // unobserve all
        for (const inner of this._observedMap.values()) {
          try { this._ro.unobserve(inner); } catch (e) { }
        }
        this._observedMap.clear();
        this._ro.disconnect && this._ro.disconnect();
        this._ro = null;
      }
    } catch (e) { }
    // Remove fixed controls if we created them
    try {
      this._destroyFixedScrollbar && this._destroyFixedScrollbar();
    } catch (e) { }
  }

  // Create a fixed scrollbar & buttons at browser edge and sync with this element
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
      zIndex: 29, // 1 below the details panel
      pointerEvents: 'auto'
    });

    const thumb = document.createElement('div');
    thumb.className = 'fb-fixed-thumb';
    Object.assign(thumb.style, {
      position: 'absolute',
      left: '0px',
      width: '100%',
      borderRadius: '6px',
      background: 'rgba(0,0,0,0.12)',
      cursor: 'pointer'
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
      zIndex: 29 // 1 below the details panel
    });

    const btnTop = document.createElement('button');
    btnTop.className = 'fb-btn-top';
    btnTop.title = 'Scroll to top';
    btnTop.innerText = '▲';
    Object.assign(btnTop.style, {
      width: '36px', height: '36px', borderRadius: '18px', border: '1px solid rgba(0,0,0,0.08)', background: 'white', cursor: 'pointer'
    });

    const btnBottom = document.createElement('button');
    btnBottom.className = 'fb-btn-bottom';
    btnBottom.title = 'Scroll to bottom';
    btnBottom.innerText = '▼';
    Object.assign(btnBottom.style, {
      width: '36px', height: '36px', borderRadius: '18px', border: '1px solid rgba(0,0,0,0.08)', background: 'white', cursor: 'pointer'
    });

    controls.appendChild(btnTop);
    controls.appendChild(btnBottom);

    document.body.appendChild(rail);
    document.body.appendChild(controls);

    // Mouse hover hiding - Initial hide state — show controls only on proximity
    rail.style.opacity = '0';
    rail.style.transition = 'opacity 180ms ease';
    rail.style.pointerEvents = 'none';
    controls.style.opacity = '0';
    controls.style.transition = 'opacity 180ms ease';
    controls.style.pointerEvents = 'none';
    // ^^ Controls mouse hover hiding

    // Handlers
    const onScroll = () => this._updateFixedThumb();
    const onResize = () => { this._updateRailPosition(); this._updateFixedThumb(); };
    const onDetailsShow = () => {
      try {
        if (!this._fixedRail) return;
        // Hide the fixed rail while details panel is open to avoid collision
        hideRail();
        this._detailsOpen = true;
      } catch (e) { }
    };
    const onDetailsHide = () => {
      try {
        // Restore visibility after details panel closes
        showRail();
        this._detailsOpen = false;
        this._updateFixedThumb();
      } catch (e) { }
    };
    const onTop = () => this._scrollToTop();
    const onBottom = () => this._scrollToBottom();

    // Mouse hover hiding
    let hideTimer = null;
    const proximityPx = 50; // pixels from right edge to reveal controls
    const showRail = () => {
      try {
        if (this._dragging) return; // keep visible during drag
        rail.style.opacity = '1';
        rail.style.pointerEvents = 'auto';
        controls.style.opacity = '1';
        controls.style.pointerEvents = 'auto';
      } catch (e) { }
    };
    const hideRail = () => {
      try {
        if (this._dragging) return;
        rail.style.opacity = '0';
        rail.style.pointerEvents = 'none';
        controls.style.opacity = '0';
        controls.style.pointerEvents = 'none';
      } catch (e) { }
    };

    const onMouseMove = (ev) => {
      try {
        const x = ev.clientX;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        if (vw - x <= proximityPx) {
          showRail();
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        } else {
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => { hideRail(); hideTimer = null; }, 10);
        }
      } catch (e) { }
    };

    const onRailEnter = () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } showRail(); };
    const onRailLeave = () => { if (hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(()=>{ hideRail(); hideTimer = null; }, 10); };
    // ^^ Mouse hover hiding

    thumb.addEventListener('pointerdown', (e) => this._startThumbDrag(e));
    btnTop.addEventListener('click', onTop);
    btnBottom.addEventListener('click', onBottom);
    this.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onResize);
    // Mouse hover hiding
    document.addEventListener('mousemove', onMouseMove);
    rail.addEventListener('pointerenter', onRailEnter);
    rail.addEventListener('pointerleave', onRailLeave);
    // Listen for details panel open/close to avoid overlap
    try { bus.on(UIEvents.DETAILS_SHOW, onDetailsShow); bus.on(UIEvents.DETAILS_HIDE, onDetailsHide); } catch (e) {}
    // ^^ Store references for cleanup

    this._fixedRail = rail;
    this._fixedThumb = thumb;
    this._fixedControls = controls;
    // No mouse houver hidding: this._fixedHandlers = { onScroll, onResize };
    this._fixedHandlers = { onScroll, onResize, onMouseMove, onRailEnter, onRailLeave, onDetailsShow, onDetailsHide };

    // Initial update
    this._updateRailPosition();
    this._updateFixedThumb();
  }

  _updateRailPosition() {
    try {
      if (!this._fixedRail) return;
      // Find the timeline header element and position the rail just below it
      const timelineHeader = document.querySelector('timeline-lit');
      if (timelineHeader) {
        const rect = timelineHeader.getBoundingClientRect();
        // Add small gap so rail doesn't touch header
        const gap = 6;
        const topPx = Math.max(8, rect.bottom + gap) + 'px';
        this._fixedRail.style.top = topPx;
      } else {
        // fallback to a sensible default near top
        this._fixedRail.style.top = '72px';
      }
    } catch (e) { }
  }

  _destroyFixedScrollbar() {
    if (this._fixedRail) {
      try { this._fixedRail.remove(); } catch (e) { }
      this._fixedRail = null;
    }
    if (this._fixedControls) {
      try { this._fixedControls.remove(); } catch (e) { }
      this._fixedControls = null;
    }
    if (this._fixedThumb) this._fixedThumb = null;
    if (this._fixedHandlers) {
      try { this.removeEventListener('scroll', this._fixedHandlers.onScroll); } catch (e) { }
      try { window.removeEventListener('resize', this._fixedHandlers.onResize); } catch (e) { }
      // Mouse hover hiding:
      try { document.removeEventListener('mousemove', this._fixedHandlers.onMouseMove); } catch (e) { }
      try { this._fixedRail && this._fixedRail.removeEventListener('pointerenter', this._fixedHandlers.onRailEnter); } catch (e) { }
      try { this._fixedRail && this._fixedRail.removeEventListener('pointerleave', this._fixedHandlers.onRailLeave); } catch (e) { }
      try { bus.off && this._fixedHandlers.onDetailsShow && bus.off(UIEvents.DETAILS_SHOW, this._fixedHandlers.onDetailsShow); } catch (e) { }
      try { bus.off && this._fixedHandlers.onDetailsHide && bus.off(UIEvents.DETAILS_HIDE, this._fixedHandlers.onDetailsHide); } catch (e) { }
      // ^^^ Mouse hover hiding cleanup
      this._fixedHandlers = null;
    }
    // Mouse hover hiding cleanup
    if (this._fixedHideTimer) { try { clearTimeout(this._fixedHideTimer); } catch (e) { } this._fixedHideTimer = null; }
  }

  _updateFixedThumb() {
    try {
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
      const visibleRatio = clientH / scrollH;
      const thumbH = Math.max(20, Math.round(railHeight * visibleRatio));
      const maxThumbTop = railHeight - thumbH;
      const scrollTop = this.scrollTop || 0;
      const topFraction = scrollTop / (scrollH - clientH);
      const thumbTop = Math.round(topFraction * maxThumbTop);
      this._fixedThumb.style.height = thumbH + 'px';
      this._fixedThumb.style.top = thumbTop + 'px';
    } catch (e) { }
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
      const railTop = railRect.top;
      const railHeight = railRect.height;
      const thumbH = this._fixedThumb.getBoundingClientRect().height;
      const y = ev.clientY - railTop - (thumbH / 2);
      const maxY = Math.max(0, railHeight - thumbH);
      const clamped = Math.max(0, Math.min(maxY, y));
      const fraction = clamped / (railHeight - thumbH || 1);
      const targetScroll = Math.round(fraction * (this.scrollHeight - this.clientHeight));
      this.scrollTop = targetScroll;
      this._updateFixedThumb();
    } catch (e) { }
  }

  // Helper: sort features by rank
  _sortByRank(features) {
    const byRank = (a, b) => (a.originalRank || 0) - (b.originalRank || 0);
    return features.sort(byRank);
  }

  // Helper: sort features by date
  _sortByDate(features) {
    return features.sort((a, b) => {
      // Handle unplanned features (no start date) - sort them to the end
      if (!a.start && !b.start) return 0;
      if (!a.start) return 1;  // a goes to end
      if (!b.start) return -1; // b goes to end
      
      return a.start.localeCompare(b.start);
    });
  }

  // Helper: build children map
  _buildChildrenMap(features) {
    const childrenMap = new Map();
    features.forEach(f => {
      if (f.type === 'feature' && f.parentEpic) {
        if (!childrenMap.has(f.parentEpic)) {
          childrenMap.set(f.parentEpic, []);
        }
        childrenMap.get(f.parentEpic).push(f);
      }
    });
    return childrenMap;
  }

  // Helper: order features hierarchically
  _orderFeaturesHierarchically(sourceFeatures, sortMode) {
    const sortFn = sortMode === 'rank' ? this._sortByRank.bind(this) : this._sortByDate.bind(this);
    
    const epics = sortFn(sourceFeatures.filter(f => f.type === 'epic'));
    const childrenMap = this._buildChildrenMap(sourceFeatures);
    
    // Sort children within each epic
    childrenMap.forEach(children => sortFn(children));
    
    const standalone = sortFn(
      sourceFeatures.filter(f => f.type === 'feature' && !f.parentEpic)
    );

    const ordered = [];
    for (const epic of epics) {
      ordered.push(epic);
      const children = childrenMap.get(epic.id) || [];
      ordered.push(...children);
    }
    ordered.push(...standalone);
    
    // Ensure we don't accidentally drop any source features (e.g. when a
    // child references a parent epic that isn't present as type 'epic' in
    // the source set). Append any missing features deterministically.
    const included = new Set(ordered.map(f => f.id));
    const remaining = sortFn(sourceFeatures.filter(f => !included.has(f.id)));
    if (remaining.length) ordered.push(...remaining);

    return ordered;
  }

  // Helper: check if feature is unplanned (no dates set)
  _isUnplanned(feature) {
    return !feature.start || !feature.end;
  }

  /**
   * Helper: check if feature is hierarchically linked to an Epic from selected projects
   * - Show Epics that belong to selected projects
   * - Show Features that are children (direct or indirect) of those Epics
   * @param {Object} feature - Feature to check
   * @param {Array} allFeatures - All features for parent lookup
   * @param {Set} selectedProjectEpicIds - Set of Epic IDs from selected projects
   * @param {Set} visited - Set to track visited feature IDs (prevent circular references)
   * @returns {boolean} True if feature is an Epic from selected project or linked to one
   */
  _isHierarchicallyLinkedToSelectedProjectEpics(feature, allFeatures, selectedProjectEpicIds, visited = new Set()) {
    if (!feature) return false;
    
    // Prevent circular references
    if (visited.has(feature.id)) return false;
    visited.add(feature.id);
    
    // If this feature is itself an Epic from a selected project, show it
    if (selectedProjectEpicIds.has(feature.id)) {
      return true;
    }
    
    // Check if feature has a parent relationship via parentEpic
    if (feature.parentEpic) {
      const parentFeature = allFeatures.find(f => f.id === feature.parentEpic);
      if (parentFeature) {
        // Recursively check if parent is linked to a project Epic
        return this._isHierarchicallyLinkedToSelectedProjectEpics(parentFeature, allFeatures, selectedProjectEpicIds, visited);
      }
    }
    
    // Check relations array for Parent type
    if (Array.isArray(feature.relations)) {
      const parentRelation = feature.relations.find(r => r.type === 'Parent');
      if (parentRelation && parentRelation.id) {
        const parentFeature = allFeatures.find(f => f.id === parentRelation.id);
        if (parentFeature) {
          return this._isHierarchicallyLinkedToSelectedProjectEpics(parentFeature, allFeatures, selectedProjectEpicIds, visited);
        }
      }
    }
    
    return false;
  }

  // Helper: check if feature passes filters
  _featurePassesFilters(feature, childrenMap, allFeatures = []) {
    const project = state.projects.find(p => p.id === feature.project && p.selected);
    if (!project) return false;

    // Check hierarchical filtering if enabled
    if (state._viewService.showOnlyProjectHierarchy) {
      // Get only "project" type plans (not "team" type plans)
      const projectTypePlans = state.projects.filter(p => {
        const planType = p.type ? String(p.type) : 'project';
        return p.selected && planType === 'project';
      });
      
      const projectTypePlanIds = new Set(projectTypePlans.map(p => p.id));
      
      // Build set of Epic IDs from project-type plans only
      const projectTypeEpicIds = new Set(
        allFeatures
          .filter(f => f.type === 'epic' && projectTypePlanIds.has(f.project))
          .map(f => f.id)
      );
      
      const isLinked = this._isHierarchicallyLinkedToSelectedProjectEpics(feature, allFeatures, projectTypeEpicIds);
      if (!isLinked) {
        return false;
      }
    }

    const stateFilter = state.selectedFeatureStateFilter instanceof Set 
      ? state.selectedFeatureStateFilter 
      : new Set(state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []);
    
    if (stateFilter.size === 0) return false;
    
    const featureState = feature.status || feature.state;
    if (!stateFilter.has(featureState)) return false;

    // Use ViewService for visibility checks
    if (feature.type === 'epic' && !state._viewService.showEpics) return false;
    if (feature.type === 'feature' && !state._viewService.showFeatures) return false;

    // Check unplanned work filter (only when feature flag is ON)
    if (featureFlags.SHOW_UNPLANNED_WORK) {
      const isUnplanned = this._isUnplanned(feature);
      if (isUnplanned && !state._viewService.showUnplannedWork) {
        return false;
      }
    }

    if (feature.type === 'epic') {
      const children = childrenMap.get(feature.id) || [];
      const anyChildVisible = children.some(child => {
        const childProject = state.projects.find(p => p.id === child.project && p.selected);
        if (!childProject) return false;
        
        // Check unplanned work for children (when feature flag is ON)
        if (featureFlags.SHOW_UNPLANNED_WORK) {
          const isChildUnplanned = this._isUnplanned(child);
          if (isChildUnplanned && !state._viewService.showUnplannedWork) {
            return false;
          }
        }
        
        // Check if child has capacity
        const hasCapacity = child.capacity && child.capacity.length > 0;
        if (!hasCapacity) {
          // Show/hide based on showUnassignedCards setting
          return state._viewService.showUnassignedCards;
        }
        
        return child.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected));
      });
      
      // Check if epic itself has capacity
      const hasCapacity = feature.capacity && feature.capacity.length > 0;
      const epicVisible = hasCapacity 
        ? feature.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected))
        : state._viewService.showUnassignedCards;
      
      if (!epicVisible && !anyChildVisible) return false;
    } else {
      // For features, check if they have capacity
      const hasCapacity = feature.capacity && feature.capacity.length > 0;
      if (!hasCapacity) {
        // Show/hide based on showUnassignedCards setting
        if (!state._viewService.showUnassignedCards) return false;
      } else {
        // Has capacity - check if any team matches selected teams
        if (!feature.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected))) {
          return false;
        }
      }
    }

    return true;
  }

  // Compute and render features from current state
  async renderFeatures() {
    const sourceFeatures = state.getEffectiveFeatures();
    // Use ViewService for sort mode
    const ordered = this._orderFeaturesHierarchically(sourceFeatures, state._viewService.featureSortMode);
    const childrenMap = this._buildChildrenMap(sourceFeatures);
    const months = getTimelineMonths();

    const renderList = [];
    let laneIndex = 0;

    for (const feature of ordered) {
      if (!this._featurePassesFilters(feature, childrenMap, sourceFeatures)) continue;

      const pos = computePosition(feature, months) || {};
      feature._left = pos.left;
      feature._width = pos.width;

      const left = pos.left ?? feature._left ?? feature.left;
      const width = pos.width ?? feature._width ?? feature.width;
      const project = state.projects.find(p => p.id === feature.project);

      renderList.push({
        feature,
        left,
        width,
        top: laneIndex * laneHeight(),
        teams: state.teams,
        // Use ViewService for condensed cards setting
        condensed: state._viewService.condensedCards,
        project
      });
      laneIndex++;
    }

    this.features = renderList;
    this.requestUpdate();
    // If nothing will be rendered, open the shared empty-board modal to explain why
    if (renderList.length === 0) {
      try {
        const mh = await import('./modalHelpers.js');
        if (mh && typeof mh.openEmptyBoardModal === 'function') {
          // fire-and-forget; modal will compute reasons itself
          mh.openEmptyBoardModal({ parent: document.body }).catch(()=>{});
        }
      } catch (e) { /* ignore modal failures */ }
    }
  }

  // Update a subset of cards by id
  async updateCardsById(ids = [], sourceFeatures = []) {
    const missingIds = new Set();
    const nodeById = new Map();

    // Check cache first
    for (const id of ids) {
      const cached = this._cardMap.get(id);
      if (cached) {
        nodeById.set(id, cached);
      } else {
        missingIds.add(id);
      }
    }

    // Query DOM for missing cards
    if (missingIds.size > 0) {
      const candidatesA = this.shadowRoot 
        ? Array.from(this.shadowRoot.querySelectorAll('feature-card-lit')) 
        : [];
      const candidatesB = Array.from(this.querySelectorAll('feature-card-lit'));
      const candidates = [...candidatesA, ...candidatesB];

      for (const card of candidates) {
        const featureId = card.feature?.id ?? card.dataset?.id;
        if (featureId && missingIds.has(featureId)) {
          nodeById.set(featureId, card);
          this._cardMap.set(featureId, card);
          missingIds.delete(featureId);
          
          if (missingIds.size === 0) break;
        }
      }
    }

    // Update found nodes
    const months = getTimelineMonths();
    for (const id of ids) {
      const feature = state.getEffectiveFeatureById(id);
      if (!feature) continue;

      const existing = nodeById.get(id);
      if (!existing) {
        // Fallback to full render if node isn't present
        this.renderFeatures();
        break;
      }

      // Compute geometry
      let geom = {};
      if (feature._left !== undefined && feature._width !== undefined) {
        geom.left = feature._left;
        geom.width = feature._width;
      } else {
        try {
          geom = computePosition(feature, months) || {};
        } catch (error) {
          console.warn('computePosition failed for feature', id, error);
          geom.left = feature._left ?? feature.left ?? '';
          geom.width = feature._width ?? feature.width ?? '';
        }
      }

      const left = geom.left !== undefined && geom.left !== '' 
        ? (typeof geom.left === 'number' ? `${geom.left}px` : geom.left) 
        : '';
      const width = geom.width !== undefined && geom.width !== '' 
        ? (typeof geom.width === 'number' ? `${geom.width}px` : geom.width) 
        : '';

      const project = state.projects.find(p => p.id === feature.project);

      console.log('[FeatureBoard] updateCardsById - updating card', id, 'dirty:', feature.dirty, 'changedFields:', feature.changedFields);

      // Update card properties - create new object reference to ensure Lit detects change
      existing.feature = { ...feature };
      existing.selected = !!feature.selected;
      existing.project = project;
      existing.applyVisuals({ 
        left, 
        width, 
        selected: !!feature.selected, 
        dirty: !!feature.dirty, 
        project 
      });
    }
  }

  // After render, wire handlers and update card map
  updated() {
    if (!this.shadowRoot) return;

    const cards = this.shadowRoot.querySelectorAll('feature-card-lit');
    cards.forEach((node, index) => {
      const featureObj = this.features[index];
      if (!featureObj) return;

      // Ensure styles and props are set
      if (featureObj.left !== undefined) node.style.left = `${featureObj.left}px`;
      if (featureObj.top !== undefined) node.style.top = `${featureObj.top}px`;
      if (featureObj.width !== undefined) node.style.width = `${featureObj.width}px`;
      
      node.feature = featureObj.feature;
      node.bus = bus;
      node.teams = featureObj.teams || state.teams;
      // Use ViewService for condensed fallback
      node.condensed = featureObj.condensed ?? state._viewService.condensedCards;
      node.project = featureObj.project || state.projects.find(p => p.id === featureObj.feature?.project);

      // Update card map
      if (node.feature?.id) {
        this._cardMap.set(node.feature.id, node);
      }
    });
    // Ensure our ResizeObserver is observing the current inner elements
    this._refreshObserverTargets();
    // Schedule an immediate measurement pass to compute layout-driven flags
    this._scheduleMeasureNow();
    // Ensure fixed scrollbar exists and is in sync
    try { this._ensureFixedScrollbar(); this._updateFixedThumb(); } catch (e) { }
  }

  _refreshObserverTargets() {
    if (!this._ro) return;
    const current = new Set();
    const cards = this.shadowRoot ? Array.from(this.shadowRoot.querySelectorAll('feature-card-lit')) : [];
    for (const card of cards) {
      current.add(card);
      if (this._observedMap.has(card)) continue;
      try {
        // Observe the host element directly. We'll query its shadowRoot '.feature-card' during measurement.
        try { this._ro.observe(card); } catch (e) { }
        this._observedMap.set(card, true);
      } catch (e) { }
    }

    // Unobserve removed cards
    for (const card of Array.from(this._observedMap.keys())) {
      if (!current.has(card)) {
        try { this._ro.unobserve(card); } catch (e) { }
        this._observedMap.delete(card);
      }
    }
  }

  _scheduleMeasureNow() {
    if (this._measureScheduled) return;
    this._measureScheduled = true;
    requestAnimationFrame(() => {
      this._measureScheduled = false;
      this._processMeasurements();
    });
  }

  _processMeasurements(entries) {
    try {
      const board = this;
      const bbox = board.getBoundingClientRect();
      const scrollLeft = board.scrollLeft || 0;
      const verticalContainer = (board.parentElement && board.parentElement.classList && board.parentElement.classList.contains('timeline-section')) ? board.parentElement : board;
      const verticalScrollTop = verticalContainer ? verticalContainer.scrollTop : 0;

      const tolerance = 2;

      const targets = entries && entries.length ? entries.map(e => e.target) : Array.from(this._observedMap.keys());

      // Ensure we include all observed hosts
      const hostSet = new Set(targets);
      for (const host of this._observedMap.keys()) hostSet.add(host);

      for (const host of hostSet) {
        try {
          if (!host) continue;
          // Query inner .feature-card inside the host's shadowRoot for measurements of scrollable children
          const inner = host.shadowRoot && host.shadowRoot.querySelector('.feature-card');
          // Use host offsets for content coordinates (these are stable and avoid viewport/scroll double-counting)
          const cardLeft = typeof host.offsetLeft === 'number' ? host.offsetLeft : 0;
          const cardTop = typeof host.offsetTop === 'number' ? host.offsetTop : 0;
          const cardWidth = typeof host.offsetWidth === 'number' ? host.offsetWidth : (inner ? inner.clientWidth : 0);
          const cardHeight = typeof host.offsetHeight === 'number' ? host.offsetHeight : (inner ? inner.clientHeight : 0);

          const teamRow = inner ? inner.querySelector('.team-load-row') : null;
          const titleEl = inner ? inner.querySelector('.feature-title') : null;

          const teamFits = teamRow ? (teamRow.scrollWidth <= (teamRow.clientWidth + tolerance)) : true;
          const titleFits = titleEl ? (titleEl.scrollWidth <= (titleEl.clientWidth + tolerance)) : true;
          const contentFits = teamFits && titleFits;

          const titleOverflows = !titleFits;
          const smallFeature = cardWidth < 40;
          const culled = cardWidth < 70;

          const borderColor = inner ? window.getComputedStyle(inner).getPropertyValue('border-left-color') : '';

          const layout = {
            width: cardWidth,
            contentFits,
            titleOverflows,
            smallFeature,
            culled,
            cardRect: { left: cardLeft, top: cardTop, width: cardWidth, height: cardHeight },
            boardRect: { left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height },
            borderColor
          };

          try {
            if (typeof host.applyLayout === 'function') {
              host.applyLayout(layout);
            } else {
              // Fallback: set a single property to trigger minimal updates
              host._layout = layout;
            }
          } catch (e) { }
        } catch (e) { }
      }
    } catch (e) { }
  }

  _selectFeature(feature) {
    this.dispatchEvent(new CustomEvent('feature-selected', { 
      detail: { feature }, 
      bubbles: true, 
      composed: true 
    }));
  }

  // Public API: center a feature card by id in the viewport
  centerFeatureById(featureId){
    try{
      const card = this._cardMap.get(String(featureId)) || (this.shadowRoot && this.shadowRoot.querySelector(`feature-card-lit[data-feature-id="${featureId}"]`)) || this.querySelector(`feature-card-lit[data-feature-id="${featureId}"]`);
      const timeline = document.getElementById('timelineSection');
      const featureBoard = this;
      if(!card || !timeline || !featureBoard) return;

      // Compute centers
      const cardCenterX = (card.offsetLeft || 0) + (card.clientWidth || 0) / 2;
      const cardCenterY = (card.offsetTop || 0) + (card.clientHeight || 0) / 2;
      const targetX = Math.max(0, Math.round(cardCenterX - (timeline.clientWidth / 2)));
      const targetY = Math.max(0, Math.round(cardCenterY - (featureBoard.clientHeight / 2)));

      // Smooth scroll timeline (horizontal) and featureBoard (vertical)
      timeline.scrollTo({ left: targetX, behavior: 'smooth' });
      featureBoard.scrollTo({ top: targetY, behavior: 'smooth' });
      // Add temporary highlight class to the host so its internal styles animate
      try{
        card.classList.add('search-highlight');
        setTimeout(()=>{ try{ card.classList.remove('search-highlight'); }catch(e){} }, 950);
      }catch(e){ /* ignore */ }
    }catch(e){ console.warn('centerFeatureById failed', e); }
  }

  // Convenience: append a DOM node or feature data
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

// --- Board-level rendering and helpers moved from FeatureCard.lit.js ---
// helpers moved to `board-utils.js`

// The board rendering is now encapsulated by the `feature-board` component.
// Call the component's instance methods (`renderFeatures`, `updateCardsById`) directly.

export async function initBoard() {
  const board = document.querySelector('feature-board');
  if (!board) {
    console.warn('feature-board element not found');
    return;
  }

  let _boardReady = false;
  const renderFeatures = () => {
    if (!board || ! _boardReady) return;
    if (typeof board.renderFeatures === 'function') {
      board.renderFeatures();
    }
  };

  const updateFeatures = (payload) => {
    if (!board || !_boardReady || typeof board.updateCardsById !== 'function') return;
    const ids = payload?.ids;
    if (Array.isArray(ids) && ids.length > 0) {
      board.updateCardsById(ids, state.getEffectiveFeatures());
    } else {
      board.renderFeatures();
    }
  };

  const handleScenarioActivation = ({ scenarioId }) => {
    if (!board) return;
    
    // Apply scenario-mode styling for non-readonly scenarios
    const activeScenario = state.scenarios.find(s => s.id === scenarioId);
    if (activeScenario && !activeScenario.readonly) {
      board.classList.add('scenario-mode');
    } else {
      board.classList.remove('scenario-mode');
    }
  };

  // Register event handlers (they will be no-ops until app signals readiness)
  bus.on(ProjectEvents.CHANGED, renderFeatures);
  bus.on(TeamEvents.CHANGED, renderFeatures);
  bus.on(TimelineEvents.MONTHS, renderFeatures);
  bus.on(TimelineEvents.SCALE_CHANGED, renderFeatures); // Re-render when zoom changes
  bus.on(FeatureEvents.UPDATED, updateFeatures);
  bus.on(FilterEvents.CHANGED, renderFeatures);
  bus.on(ViewEvents.SORT_MODE, renderFeatures);
  bus.on(ScenarioEvents.ACTIVATED, handleScenarioActivation);

  // Defer initial render until app initialization completes to avoid multiple renders
  bus.once(AppEvents.READY, () => {
    _boardReady = true;
    renderFeatures();
  });
}

