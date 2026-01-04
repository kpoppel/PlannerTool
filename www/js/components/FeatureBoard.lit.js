import { LitElement, html, css } from '../vendor/lit.js';
import { ProjectEvents, TeamEvents, TimelineEvents, FeatureEvents, FilterEvents, ScenarioEvents, ViewEvents, DragEvents } from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { getTimelineMonths } from './Timeline.lit.js';
import { formatDate, parseDate, addMonths } from './util.js';
import { laneHeight, computePosition, getBoardOffset, _test_resetCache } from './board-utils.js';
import { startDragMove, startResize } from './dragManager.js';
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

  disconnectedCallback() {
    super.disconnectedCallback();
    this._boundHandlers.forEach((handler, event) => {
      bus.off(event, handler);
    });
    this._boundHandlers.clear();
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
    
    return ordered;
  }

  // Helper: check if feature is unplanned (no dates set)
  _isUnplanned(feature) {
    return !feature.start || !feature.end;
  }

  // Helper: check if feature passes filters
  _featurePassesFilters(feature, childrenMap) {
    const project = state.projects.find(p => p.id === feature.project && p.selected);
    if (!project) return false;

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
  renderFeatures() {
    const sourceFeatures = state.getEffectiveFeatures();
    // Use ViewService for sort mode
    const ordered = this._orderFeaturesHierarchically(sourceFeatures, state._viewService.featureSortMode);
    const childrenMap = this._buildChildrenMap(sourceFeatures);
    const months = getTimelineMonths();

    const renderList = [];
    let laneIndex = 0;

    for (const feature of ordered) {
      if (!this._featurePassesFilters(feature, childrenMap)) continue;

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

      // Update card properties
      existing.feature = feature;
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
  }

  _selectFeature(feature) {
    this.dispatchEvent(new CustomEvent('feature-selected', { 
      detail: { feature }, 
      bubbles: true, 
      composed: true 
    }));
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

  const renderFeatures = () => {
    if (board && typeof board.renderFeatures === 'function') {
      board.renderFeatures();
    }
  };

  const updateFeatures = (payload) => {
    if (!board || typeof board.updateCardsById !== 'function') return;
    
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

  // Register event handlers
  bus.on(ProjectEvents.CHANGED, renderFeatures);
  bus.on(TeamEvents.CHANGED, renderFeatures);
  bus.on(TimelineEvents.MONTHS, renderFeatures);
  bus.on(FeatureEvents.UPDATED, updateFeatures);
  bus.on(FilterEvents.CHANGED, renderFeatures);
  bus.on(ViewEvents.SORT_MODE, renderFeatures);
  bus.on(ScenarioEvents.ACTIVATED, handleScenarioActivation);

  // Initial render
  renderFeatures();
}

