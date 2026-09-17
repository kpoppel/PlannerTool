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
import { sel } from '../application/imports.js';

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
    const selectedProjectIds = sel.selection.getSelectedProjectIds();
    if (!selectedProjectIds.length) {
      reasons.push(
        'No projects/plans selected. Select one or more projects to display tasks.'
      );
    }

    // Feature state filter
    const stateFilter = sel.filter.getSelectedFeatureStateSet();
    if (stateFilter.size === 0) {
      reasons.push('Feature state filter excludes all states (no state selected).');
    }

    // View options — check if all task types are hidden
    {
      const availableTypes = sel.feature.getAvailableTaskTypes() || ['epic', 'feature'];
      const allHidden = availableTypes.every((t) => !sel.view.isTypeVisible(t));
      if (allHidden) {
        reasons.push('All task types are hidden in view options.');
      } else {
        const hiddenLabels = availableTypes.filter((t) => !sel.view.isTypeVisible(t));
        for (const t of hiddenLabels) {
          reasons.push(`${t.charAt(0).toUpperCase() + t.slice(1)}s are hidden in view options.`);
        }
      }
    }

    // Unplanned work visibility
    if (!sel.view.getShowUnplannedWork()) {
      reasons.push('Unplanned work is hidden (unplanned features filtered out).');
    }

    // Team selection + capacity filtering
    const selectedTeamIds = sel.selection.getSelectedTeamIds();
    const teams = sel.selection.getTeams() || [];
    if (teams.length && !selectedTeamIds.length) {
      reasons.push('No teams selected; contextual allocated tasks are hidden.');
    }

    // Dimensional task filters (schedule, allocation, hierarchy, relations)
    try {
      const taskFilters = sel.filter.getTaskFilters();
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
    if (sel.view.getShowOnlyProjectHierarchy()) {
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
      return sel.scope.getVisibleFeatures().length > 0;
    } catch (e) {
      return false;
    }
  }

  _recomputeAndMaybeClose() {
    // If no baseline features have been loaded yet (likely missing credentials),
    // do not show the empty-board modal — wait until data finishes loading.
    const baselineLoaded = (sel.feature.getBaselineFeatures() || []).length > 0;
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
