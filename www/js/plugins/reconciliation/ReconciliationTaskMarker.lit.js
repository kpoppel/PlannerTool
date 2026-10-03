import { LitElement, html, css } from '../../vendor/lit.js';
import { reconciliation } from './runtime.js';
import { changeLabel, projectLabel } from './presentation.js';
import { openReconciliationReview } from './ReconciliationReview.lit.js';

export class ReconciliationTaskMarker extends LitElement {
  static properties = { featureId: { type: String } };
  static styles = css`
    :host { position: absolute; top: -6px; right: -6px; z-index: 12; }
    button { display: grid; place-items: center; width: 18px; height: 18px;
      padding: 0; border: 1px solid #805e05; border-radius: 4px;
      background: #ffe19a; color: #4f3900; font: bold 13px sans-serif; cursor: pointer; }
    button[data-change='new'], button[data-change='worsened'] { background: #ffbf69; border-color: #975200; }
    button:focus-visible { outline: 2px solid #167d69; outline-offset: 2px; }
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
    const id = String(this.featureId);
    const issues = reconciliation.issuesForFeature(id).filter((issue) => issue.category === 'schedule');
    if (!snapshot.visibleIds.has(id) || issues.length === 0) return html``;
    const change = issues.some((issue) => issue.change === 'new') ? 'new'
      : issues.some((issue) => issue.change === 'worsened') ? 'worsened' : 'existing';
    const label = issues.map((issue) =>
      `${changeLabel(issue.change)}: ${issue.description} ${projectLabel(snapshot, issue.featureId)} / ${projectLabel(snapshot, issue.relatedId)}`
    ).join('\n');
    return html`<button title=${label} aria-label=${label} data-change=${change}
      @mousedown=${(event) => event.stopPropagation()}
      @pointerdown=${(event) => event.stopPropagation()}
      @dblclick=${(event) => event.stopPropagation()}
      @click=${(event) => {
        event.stopPropagation();
        openReconciliationReview('schedule', `schedule:${issues[0].featureId}`);
      }}>!</button>`;
  }
}

customElements.define('reconciliation-task-marker', ReconciliationTaskMarker);