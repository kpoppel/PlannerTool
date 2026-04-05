import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import {
  FeatureEvents,
  ProjectEvents,
  TeamEvents,
  FilterEvents,
  ViewEvents,
  TimelineEvents,
} from '../core/EventRegistry.js';
import { state } from '../services/State.js';
import { featureFlags } from '../config.js';

export class EmptyBoardModal extends LitElement {
  static properties = { reasons: { type: Array }, open: { type: Boolean } };

  static styles = css`
    :host {
      display: contents;
    }
    .info-box {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(0, 0, 0, 0.06);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
      padding: 16px 18px;
      border-radius: 10px;
      max-width: 560px;
      width: calc(100% - 48px);
      font-size: 14px;
      color: #111;
      z-index: 200;
      pointer-events: auto;
      opacity: 0;
      transition:
        opacity 220ms ease-in-out,
        transform 220ms ease-in-out;
      display: none;
    }
    .info-box[open] {
      display: block;
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    .info-box h4 {
      margin: 0 0 6px 0;
      font-size: 14px;
    }
    .info-box ul {
      margin: 6px 0 0 18px;
      padding: 0;
    }
    .info-box li {
      margin: 4px 0;
    }
  `;

  constructor() {
    super();
    this.reasons = [];
    this.open = false;
    this._boundClose = this._boundClose.bind(this);
    this._recomputeAndMaybeClose = this._recomputeAndMaybeClose.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    // Listen for state changes that might make the board non-empty
    bus.on(FeatureEvents.UPDATED, this._recomputeAndMaybeClose);
    bus.on(ProjectEvents.CHANGED, this._recomputeAndMaybeClose);
    bus.on(TeamEvents.CHANGED, this._recomputeAndMaybeClose);
    bus.on(FilterEvents.CHANGED, this._recomputeAndMaybeClose);
    bus.on(ViewEvents.SORT_MODE, this._recomputeAndMaybeClose);
    bus.on(TimelineEvents.MONTHS, this._recomputeAndMaybeClose);
    // initial compute
    setTimeout(() => this._recomputeAndMaybeClose(), 50);
  }

  disconnectedCallback() {
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
    const selectedProjects = state.projects.filter((p) => p.selected);
    if (!selectedProjects.length) {
      reasons.push(
        'No projects/plans selected. Select one or more projects to display tasks.'
      );
    }

    // Feature state filter
    const stateFilter =
      state.selectedFeatureStateFilter instanceof Set ?
        state.selectedFeatureStateFilter
      : new Set(
          state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []
        );
    if (stateFilter.size === 0) {
      reasons.push('Feature state filter excludes all states (no state selected).');
    }

    // View options — check if all task types are hidden
    if (state._viewService) {
      const hiddenTypes = state._viewService.hiddenTypes;
      const availableTypes = (state.availableTaskTypes || ['epic', 'feature']);
      const allHidden = availableTypes.every((t) => hiddenTypes.has(t));
      if (allHidden) {
        reasons.push('All task types are hidden in view options.');
      } else {
        const hiddenLabels = availableTypes.filter((t) => hiddenTypes.has(t));
        for (const t of hiddenLabels) {
          reasons.push(`${t.charAt(0).toUpperCase() + t.slice(1)}s are hidden in view options.`);
        }
      }
    }

    // Unplanned work visibility
    if (featureFlags.SHOW_UNPLANNED_WORK && !state._viewService.showUnplannedWork) {
      reasons.push('Unplanned work is hidden (unplanned features filtered out).');
    }

    // Team selection + capacity filtering
    const selectedTeams = state.teams.filter((t) => t.selected);
    if (state.teams && state.teams.length && !selectedTeams.length) {
      reasons.push('No teams selected — capacity-based filtering may exclude tasks.');
    }

    // If only teams are selected (no projects) and team-allocation expansion is disabled,
    // explain that team-only selection won't surface tasks unless expansion is enabled.
    if (
      selectedTeams.length > 0 &&
      (!selectedProjects || selectedProjects.length === 0) &&
      !state.expansionState.expandTeamAllocated
    ) {
      reasons.push(
        "Only teams selected and 'Team Allocated' expansion is disabled — enable the expansion or select projects to show team-allocated tasks."
      );
    }

    // Dimensional task filters (schedule, allocation, hierarchy, relations)
    try {
      const taskFilters =
        (
          state.taskFilterService &&
          typeof state.taskFilterService.getFilters === 'function'
        ) ?
          state.taskFilterService.getFilters()
        : null;
      if (taskFilters) {
        Object.keys(taskFilters).forEach((dim) => {
          const opts = taskFilters[dim];
          const allFalse = Object.keys(opts).every((k) => !opts[k]);
          if (allFalse) {
            reasons.push(
              `${dim.charAt(0).toUpperCase() + dim.slice(1)} filter excludes all options.`
            );
          }
        });
      }
    } catch (e) {
      /* ignore filter read errors */
    }

    // Hierarchical/project-hierarchy filter
    if (state._viewService.showOnlyProjectHierarchy) {
      reasons.push(
        'Hierarchy filter enabled — only epics from selected project-type plans are shown.'
      );
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
      // Use state's expanded feature ids to determine the base visible set (respects expansion options)
      const sourceFeatures = state.getEffectiveFeatures() || [];
      if (!sourceFeatures.length) return false;

      const expandedIds = state.getExpandedFeatureIds();
      if (!expandedIds || expandedIds.size === 0) return false;

      // State filter (preserve configured casing; compare case-insensitively)
      const stateFilter =
        state.selectedFeatureStateFilter instanceof Set ?
          state.selectedFeatureStateFilter
        : new Set(
            state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []
          );
      const stateFilterLower = new Set(
        Array.from(stateFilter).map((s) => String(s).toLowerCase())
      );

      // Task/dimensional filters
      const taskFilterSvc = state.taskFilterService;

      for (const feature of sourceFeatures) {
        if (!expandedIds.has(feature.id)) continue;

        // state filter (case-insensitive using configured state names)
        if (stateFilter.size === 0) continue;
        const featureStateLower = (feature.state || '').toLowerCase();
        if (!stateFilterLower.has(featureStateLower)) continue;

        // view options
        if (state._viewService && !state._viewService.isTypeVisible(feature.type)) continue;

        // unplanned work
        if (featureFlags.SHOW_UNPLANNED_WORK) {
          const isUnplanned = !feature.start || !feature.end;
          if (isUnplanned && !state._viewService.showUnplannedWork) continue;
        }

        // Task/dimensional filters: if service exists, use it to validate feature
        try {
          if (taskFilterSvc && typeof taskFilterSvc.featurePassesFilters === 'function') {
            if (!taskFilterSvc.featurePassesFilters(feature)) continue;
          }
        } catch (e) {
          /* ignore filter errors */
        }

        // If we reached here, feature would be visible
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  _recomputeAndMaybeClose() {
    // If no baseline features have been loaded yet (likely missing credentials),
    // do not show the empty-board modal — wait until data finishes loading.
    const baselineLoaded =
      Array.isArray(state.baselineFeatures) && state.baselineFeatures.length > 0;
    if (!baselineLoaded) {
      if (this.open) {
        this.open = false;
        this.requestUpdate();
      }
      return;
    }
    if (this._hasVisibleFeatures()) {
      this.dispatchEvent(
        new CustomEvent('modal-close', { bubbles: true, composed: true })
      );
      return;
    }
    // still empty — recompute reasons and update UI
    const reasons = this._computeReasons();
    this.reasons = reasons;
    // show modal only after reasons are computed to avoid flashing
    if (!this.open) this.open = true;
    this.requestUpdate();
  }

  // Allow external callers to programmatically close
  _boundClose() {
    this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div class="info-box" ?open=${this.open} role="status" aria-live="polite">
        <h4>No tasks to display</h4>
        <div>Possible reasons:</div>
        <ul>
          ${this.reasons && this.reasons.length ?
            this.reasons.map((r) => html`<li>${r}</li>`)
          : html`<li>No matching tasks.</li>`}
        </ul>
        <div style="margin-top:8px;color:#444;font-size:12px;">
          Adjust view options or select different plans/teams.
        </div>
      </div>
    `;
  }
}

customElements.define('empty-board-modal', EmptyBoardModal);
