import { LitElement, html, css } from '../../vendor/lit.js';
import { reconciliation } from './runtime.js';
import { changeLabel, projectLabel } from './presentation.js';
import { openReconciliationReview } from './ReconciliationReview.lit.js';

export class ReconciliationTaskMarker extends LitElement {
  static properties = { featureId: { type: String } };
  static styles = css`
    :host { position: absolute; top: -6px; right: -6px; z-index: 12; }
    .markers { display: flex; gap: 3px; }
    button { display: grid; place-items: center; width: 18px; height: 18px;
      padding: 0; border: 1px solid #805e05; border-radius: 4px;
      background: #ffe19a; color: #4f3900; font: bold 13px sans-serif; cursor: pointer; }
    button[data-change='new'], button[data-change='worsened'] { background: #ffbf69; border-color: #975200; }
    button:focus-visible { outline: 2px solid #167d69; outline-offset: 2px; }
    button[data-marker='exception'] { background: #e4edf2; color: #234957; border-color: #426673; }
    .shield { display: grid; place-items: center; width: 13px; height: 14px;
      background: #234957; color: white; font-size: 10px;
      clip-path: polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%); }
    button[data-marker='exception'][data-save='pending'] { border-style: dashed; }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._unsubscribe = reconciliation.subscribe(() => this.requestUpdate());
  }

  disconnectedCallback() {
    this._unsubscribe();
    super.disconnectedCallback();
  }

  render() {
    const snapshot = reconciliation.snapshot;
    if (!snapshot.markersVisible) return html``;
    const id = String(this.featureId);
    const issues = reconciliation.issuesForFeature(id);
    if (!snapshot.visibleIds.has(id) || issues.length === 0) return html``;
    const warnings = issues.filter((issue) => issue.acceptance === null);
    const accepted = issues.filter((issue) => issue.acceptance !== null);
    const change = warnings.some((issue) => issue.change === 'new') ? 'new'
      : warnings.some((issue) => issue.change === 'worsened') ? 'worsened' : 'existing';
    const label = warnings.map((issue) => {
      const status = changeLabel(issue.change);
      const relatedPlan = issue.relatedId === null ? '' : ` / ${projectLabel(snapshot, issue.relatedId)}`;
      return `${status === '' ? '' : `${status}: `}${issue.description} ${projectLabel(snapshot, issue.featureId)}${relatedPlan}`;
    }).join('\n');
    const pending = accepted.some((issue) => issue.acceptance.status === 'pending');
    const acceptedLabel = accepted.map((issue) => `Accepted exception: ${issue.title}. ${issue.acceptance.status === 'pending'
      ? 'Acceptance not saved' : 'Saved in this scenario'}. ${issue.acceptance.reason}`).join('\n');
    const marker = (findings, title, kind) => html`<button title=${title} aria-label=${title}
      data-marker=${kind} data-change=${change} data-save=${pending ? 'pending' : 'saved'}
      @mousedown=${(event) => event.stopPropagation()}
      @pointerdown=${(event) => event.stopPropagation()}
      @dblclick=${(event) => event.stopPropagation()}
      @click=${(event) => {
        event.stopPropagation();
        const issue = findings[0];
        openReconciliationReview(issue.category,
          issue.category === 'schedule' ? `schedule:${issue.featureId}` : issue.id);
      }}>${kind === 'warning' ? '!' : html`<span class="shield" aria-hidden="true">${'\u2713'}</span>`}</button>`;
    return html`<span class="markers">
      ${warnings.length > 0 ? marker(warnings, label, 'warning') : ''}
      ${accepted.length > 0 ? marker(accepted, acceptedLabel, 'exception') : ''}
    </span>`;
  }
}

customElements.define('reconciliation-task-marker', ReconciliationTaskMarker);