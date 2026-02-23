import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents, ProjectEvents, TeamEvents, FilterEvents, ViewEvents, TimelineEvents } from '../core/EventRegistry.js';
import { state } from '../services/State.js';
import { featureFlags } from '../config.js';

export class EmptyBoardModal extends LitElement {
  static properties = { reasons: { type: Array }, open: { type: Boolean } };

  static styles = css`
    :host { display: contents; }
    .info-box {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255,255,255,0.98);
      border: 1px solid rgba(0,0,0,0.06);
      box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      padding: 16px 18px;
      border-radius: 10px;
      max-width: 560px;
      width: calc(100% - 48px);
      font-size: 14px;
      color: #111;
      z-index: 1200;
      pointer-events: auto;
      opacity: 0;
      transition: opacity 220ms ease-in-out, transform 220ms ease-in-out;
      display: none;
    }
    .info-box[open] {
      display: block;
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    .info-box h4 { margin:0 0 6px 0; font-size:14px; }
    .info-box ul { margin:6px 0 0 18px; padding:0; }
    .info-box li { margin:4px 0; }
  `;

  constructor(){
    super();
    this.reasons = [];
    this.open = false;
    this._boundClose = this._boundClose.bind(this);
    this._recomputeAndMaybeClose = this._recomputeAndMaybeClose.bind(this);
  }

  connectedCallback(){
    super.connectedCallback();
    // Listen for state changes that might make the board non-empty
    bus.on(FeatureEvents.UPDATED, this._recomputeAndMaybeClose);
    bus.on(ProjectEvents.CHANGED, this._recomputeAndMaybeClose);
    bus.on(TeamEvents.CHANGED, this._recomputeAndMaybeClose);
    bus.on(FilterEvents.CHANGED, this._recomputeAndMaybeClose);
    bus.on(ViewEvents.SORT_MODE, this._recomputeAndMaybeClose);
    bus.on(TimelineEvents.MONTHS, this._recomputeAndMaybeClose);
    // initial compute
    setTimeout(()=>this._recomputeAndMaybeClose(), 50);
  }

  disconnectedCallback(){
    super.disconnectedCallback();
    bus.off(FeatureEvents.UPDATED, this._recomputeAndMaybeClose);
    bus.off(ProjectEvents.CHANGED, this._recomputeAndMaybeClose);
    bus.off(TeamEvents.CHANGED, this._recomputeAndMaybeClose);
    bus.off(FilterEvents.CHANGED, this._recomputeAndMaybeClose);
    bus.off(ViewEvents.SORT_MODE, this._recomputeAndMaybeClose);
    bus.off(TimelineEvents.MONTHS, this._recomputeAndMaybeClose);
  }

  _computeReasons() {
    const reasons = [];

    // Projects / plans selection
    const selectedProjects = state.projects.filter(p => p.selected);
    if (!selectedProjects.length) {
      reasons.push('No projects/plans selected. Select one or more projects to display tasks.');
    }

    // Feature state filter
    const stateFilter = state.selectedFeatureStateFilter instanceof Set 
      ? state.selectedFeatureStateFilter 
      : new Set(state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []);
    if (stateFilter.size === 0) {
      reasons.push('Feature state filter excludes all states (no state selected).');
    }

    // View options
    if (!state._viewService.showFeatures && !state._viewService.showEpics) {
      reasons.push('Both features and epics are hidden in view options.');
    } else if (!state._viewService.showFeatures) {
      reasons.push('Features are hidden in view options.');
    } else if (!state._viewService.showEpics) {
      reasons.push('Epics are hidden in view options.');
    }

    // Unplanned work visibility
    if (featureFlags.SHOW_UNPLANNED_WORK && !state._viewService.showUnplannedWork) {
      reasons.push('Unplanned work is hidden (unplanned features filtered out).');
    }

    // Team selection + capacity filtering
    const selectedTeams = state.teams.filter(t => t.selected);
    if (state.teams && state.teams.length && !selectedTeams.length) {
      reasons.push('No teams selected — capacity-based filtering may exclude tasks.');
    }

    // Hierarchical/project-hierarchy filter
    if (state._viewService.showOnlyProjectHierarchy) {
      reasons.push('Hierarchy filter enabled — only epics from selected project-type plans are shown.');
    }

    // Fallback generic hint
    if (!reasons.length) {
      reasons.push('No tasks match the current filters and view options.');
    }

    return reasons;
  }

  // Determine whether any features would be visible under current filters
  _hasVisibleFeatures() {
    try {
      const sourceFeatures = state.getEffectiveFeatures() || [];
      if (!sourceFeatures.length) return false;

      // Build lookup map for parent relations
      const byId = new Map(sourceFeatures.map(f => [f.id, f]));

      const stateFilter = state.selectedFeatureStateFilter instanceof Set 
        ? state.selectedFeatureStateFilter 
        : new Set(state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []);

      const selectedProjectIds = new Set(state.projects.filter(p => p.selected).map(p => p.id));
      const selectedTeams = state.teams.filter(t => t.selected);

      const visited = new Set();

      const isHierarchicallyLinked = (feature, projectTypeEpicIds, localVisited = new Set()) => {
        if (!feature) return false;
        if (localVisited.has(feature.id)) return false;
        localVisited.add(feature.id);
        if (projectTypeEpicIds.has(feature.id)) return true;
        if (feature.parentEpic) {
          const parent = byId.get(feature.parentEpic);
          if (parent) return isHierarchicallyLinked(parent, projectTypeEpicIds, localVisited);
        }
        if (Array.isArray(feature.relations)) {
          const parentRel = feature.relations.find(r => r.type === 'Parent');
          if (parentRel && parentRel.id) {
            const parent = byId.get(parentRel.id);
            if (parent) return isHierarchicallyLinked(parent, projectTypeEpicIds, localVisited);
          }
        }
        return false;
      };

      for (const feature of sourceFeatures) {
        // project selected?
        const project = state.projects.find(p => p.id === feature.project && p.selected);
        if (!project) continue;

        // hierarchical filter
        if (state._viewService.showOnlyProjectHierarchy) {
          const projectTypePlans = state.projects.filter(p => { const planType = p.type ? String(p.type) : 'project'; return p.selected && planType === 'project'; });
          const projectTypePlanIds = new Set(projectTypePlans.map(p => p.id));
          const projectTypeEpicIds = new Set(sourceFeatures.filter(f => f.type === 'epic' && projectTypePlanIds.has(f.project)).map(f => f.id));
          if (!isHierarchicallyLinked(feature, projectTypeEpicIds)) continue;
        }

        // state filter
        if (stateFilter.size === 0) continue;
        const featureState = feature.status || feature.state;
        if (!stateFilter.has(featureState)) continue;

        // view options
        if (feature.type === 'epic' && !state._viewService.showEpics) continue;
        if (feature.type === 'feature' && !state._viewService.showFeatures) continue;

        // unplanned work
        if (featureFlags.SHOW_UNPLANNED_WORK) {
          const isUnplanned = !feature.start || !feature.end;
          if (isUnplanned && !state._viewService.showUnplannedWork) continue;
        }

        if (feature.type === 'epic') {
          const children = sourceFeatures.filter(f => f.parentEpic === feature.id || (Array.isArray(f.relations) && f.relations.some(r => r.type === 'Parent' && r.id === feature.id)));
          const anyChildVisible = children.some(child => {
            const childProject = state.projects.find(p => p.id === child.project && p.selected);
            if (!childProject) return false;
            if (featureFlags.SHOW_UNPLANNED_WORK) {
              const isChildUnplanned = !child.start || !child.end;
              if (isChildUnplanned && !state._viewService.showUnplannedWork) return false;
            }
            const hasCapacity = child.capacity && child.capacity.length > 0;
            if (!hasCapacity) return state._viewService.showUnassignedCards;
            return child.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected));
          });
          const hasCapacity = feature.capacity && feature.capacity.length > 0;
          const epicVisible = hasCapacity ? feature.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected)) : state._viewService.showUnassignedCards;
          if (epicVisible || anyChildVisible) return true;
          continue;
        } else {
          const hasCapacity = feature.capacity && feature.capacity.length > 0;
          if (!hasCapacity) {
            if (!state._viewService.showUnassignedCards) continue;
            return true;
          } else {
            if (feature.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected))) return true;
            continue;
          }
        }
      }
      return false;
    } catch (e) { return false; }
  }

  _recomputeAndMaybeClose(){
    try {
      if (this._hasVisibleFeatures()) {
        this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true, composed: true }));
        return;
      }
      // still empty — recompute reasons and update UI
      const reasons = this._computeReasons();
      this.reasons = reasons;
      // show modal only after reasons are computed to avoid flashing
      if (!this.open) this.open = true;
      try { this.requestUpdate(); } catch(e){}
    } catch (e) { /* ignore */ }
  }

  // Allow external callers to programmatically close
  _boundClose(){
    this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true, composed: true }));
  }

  render(){
    return html`
      <div class="info-box" ?open=${this.open} role="status" aria-live="polite">
        <h4>No tasks to display</h4>
        <div>Possible reasons:</div>
        <ul>
          ${this.reasons && this.reasons.length ? this.reasons.map(r => html`<li>${r}</li>`) : html`<li>No matching tasks.</li>`}
        </ul>
        <div style="margin-top:8px;color:#444;font-size:12px;">Adjust view options or select different plans/teams.</div>
      </div>
    `;
  }
}

customElements.define('empty-board-modal', EmptyBoardModal);
