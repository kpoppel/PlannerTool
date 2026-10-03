import { LitElement, html, css } from '../../vendor/lit.js';
import { cmd } from '../../application/imports.js';
import { bus } from '../../core/EventBus.js';
import { UIEvents } from '../../core/EventRegistry.js';
import { findInBoard } from '../../components/board-utils.js';
import { reconciliation } from './runtime.js';
import { CATEGORIES, changeLabel, statusText, taskLabel, projectLabel } from './presentation.js';

let review = null;

export function openReconciliationReview(category = 'all', selectedId = null) {
  if (review) {
    review.category = category;
    review.selectedId = selectedId;
    review.selectedType = null;
    return;
  }
  review = document.createElement('reconciliation-review');
  review.category = category;
  review.selectedId = selectedId;
  document.body.appendChild(review);
}

export function closeReconciliationReview() {
  if (review) review.close();
}

export class ReconciliationReview extends LitElement {
  static properties = { snapshot: { state: true }, category: { state: true },
    query: { state: true }, selectedId: { state: true }, selectedType: { state: true } };

  static styles = css`
    :host { color: var(--color-text, #222); font-family: inherit; }
    dialog { width: min(1100px, calc(100vw - 80px)); height: min(720px, calc(100vh - 80px));
      padding: 0; border: 1px solid #aeb7bb; border-radius: 6px;
      background: var(--color-bg, #fff); color: inherit; box-sizing: border-box; }
    dialog::backdrop { background: #0006; }
    header { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #ddd; }
    h2 { font-size: 18px; margin: 0; } h3 { font-size: 16px; margin: 0 0 12px; }
    p { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    button, input, select { font: inherit; font-size: 13px; border: 1px solid #b8c2c8;
      border-radius: 4px; color: inherit; background: transparent; padding: 8px 10px; }
    button { cursor: pointer; } button:hover { background: #edf4f1; }
    button:disabled { color: #78848b; background: #f4f6f7; border-color: #d7dde0; cursor: default; }
    button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #167d69; outline-offset: 2px; }
    .close { margin-left: auto; font-size: 20px; width: 36px; height: 36px; padding: 0; }
    .filters { display: flex; gap: 12px; padding: 12px 20px; border-bottom: 1px solid #ddd; }
    input { flex: 1; min-width: 100px; }
    .workspace { display: grid; grid-template-columns: minmax(260px, 38%) minmax(0, 1fr); height: calc(100% - 160px); }
    .list, .detail { overflow: auto; padding: 16px 20px; }
    .list { border-right: 1px solid #ddd; }
    .issue-group { border-top: 1px solid #ddd; padding: 10px 0; }
    summary { cursor: pointer; font-size: 13px; font-weight: 600; line-height: 1.5;
      overflow-wrap: anywhere; }
    summary:focus-visible { outline: 2px solid #167d69; outline-offset: 2px; }
    .count { display: inline-block; margin-left: 6px; color: #58646c; font-weight: 400; }
    .instances { padding-top: 10px; }
    .item { display: block; width: 100%; text-align: left; margin-bottom: 8px; overflow-wrap: anywhere; }
    .item[aria-pressed='true'] { border-color: #167d69; background: #eaf5f1; }
    .item strong, .item small { display: block; line-height: 1.5; }
    .muted { color: #58646c; font-size: 12px; }
    .relationship { border-top: 1px solid #ddd; padding: 12px 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
    dl { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px; font-size: 13px; }
    dt { color: #58646c; } dd { margin: 0; overflow-wrap: anywhere; }
  `;

  constructor() {
    super();
    this.snapshot = reconciliation.snapshot;
    this.category = 'all';
    this.query = '';
    this.selectedId = null;
    this.selectedType = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.snapshot = reconciliation.snapshot;
    this._unsubscribe = reconciliation.subscribe((snapshot) => { this.snapshot = snapshot; });
  }

  disconnectedCallback() {
    this._unsubscribe();
    if (review === this) review = null;
    super.disconnectedCallback();
  }

  firstUpdated() {
    this.shadowRoot.querySelector('dialog').showModal();
  }

  close() {
    this.shadowRoot.querySelector('dialog').close();
    this.remove();
  }

  _onTaskOpen(featureId) {
    const feature = this.snapshot.featuresById.get(featureId);
    if (!feature) throw new Error(`Cannot open unloaded task ${featureId}`);
    cmd.feature.setSelectedFeature(feature);
    bus.emit(UIEvents.DETAILS_SHOW);
    this.close();
  }

  _onLocate(featureId) {
    findInBoard('feature-board').centerFeatureById(featureId);
    this.close();
  }

  _renderDates(featureId) {
    const feature = this.snapshot.featuresById.get(featureId);
    if (!feature) return html`<p>Task data unavailable.</p>`;
    const source = this.snapshot.sourceById.get(featureId);
    const dates = (task) => `${task.start ? task.start : 'Unplanned'} to ${task.end ? task.end : 'Unplanned'}`;
    return html`<dl>
      <dt>Project</dt><dd>${projectLabel(this.snapshot, featureId)}</dd>
      <dt>Effective dates</dt><dd>${dates(feature)}</dd>
      ${source ? html`<dt>Source dates</dt><dd>${dates(source)}</dd>` : ''}
    </dl>`;
  }

  render() {
    const snapshot = this.snapshot;
    const query = this.query.trim().toLowerCase();
    const groups = snapshot.groups.flatMap((group) => {
      const types = new Map();
      for (const issue of group.issues) {
        if (!types.has(issue.type)) types.set(issue.type, []);
        types.get(issue.type).push(issue);
      }
      return [...types].map(([type, issues]) => ({ ...group, type,
        title: issues[0].title,
        severity: issues.some((issue) => issue.severity === 'high') ? 'high' : issues[0].severity,
        change: issues.some((issue) => issue.change === 'new') ? 'new'
          : issues.some((issue) => issue.change === 'worsened') ? 'worsened' : issues[0].change,
        issues }));
    }).filter((group) =>
      (this.category === 'all' || group.category === this.category)
      && [taskLabel(snapshot, group.featureId), projectLabel(snapshot, group.featureId),
        group.title, ...group.issues.map((issue) => issue.description)]
        .join(' ').toLowerCase().includes(query));
    const types = new Map();
    for (const group of groups) {
      if (!types.has(group.type)) types.set(group.type, { title: group.title, groups: [], count: 0 });
      const type = types.get(group.type);
      type.groups.push(group);
      type.count += group.issues.length;
    }
    const selected = groups.find((group) => group.id === this.selectedId
      && (this.selectedType === null || group.type === this.selectedType));
    const current = selected === undefined ? groups[0] : selected;
    return html`<dialog aria-labelledby="review-heading" @cancel=${(event) => {
      event.preventDefault();
      this.close();
    }}>
      <header><h2 id="review-heading">Reconciliation</h2><span>${snapshot.scenarioName}</span>
        <button class="close" aria-label="Close review" title="Close review" @click=${() => this.close()}>&times;</button>
      </header>
      <div class="filters">
        <select aria-label="Issue category"
          @change=${(event) => { this.category = event.target.value; }}>
          <option value="all" ?selected=${this.category === 'all'}>All issues</option>
          ${CATEGORIES.map((category) => html`<option value=${category.id}
            ?selected=${this.category === category.id}>${category.label}</option>`)}
        </select>
        <input type="search" aria-label="Search issues" placeholder="Search tasks or projects" .value=${this.query}
          @input=${(event) => { this.query = event.target.value; }}>
      </div>
      <div class="workspace">
        <section class="list" aria-label="Plan issues">
          <p role="status">${statusText(snapshot)}</p>
          ${groups.length === 0 && snapshot.status === 'ready' && snapshot.groups.length > 0
            ? html`<p>No matching issues.</p>` : ''}
          ${[...types].map(([type, section]) => html`<details class="issue-group" data-issue-type=${type} open>
            <summary>${section.title}<span class="count">${section.count}</span></summary>
            <div class="instances">
              ${section.groups.map((group) => html`<button class="item"
                aria-pressed=${current === group ? 'true' : 'false'}
                @click=${() => { this.selectedId = group.id; this.selectedType = group.type; }}>
                <strong>${taskLabel(snapshot, group.featureId)}</strong>
                <small>${projectLabel(snapshot, group.featureId)}</small>
                <small>${group.severity === 'high' ? 'High impact - ' : ''}${changeLabel(group.change)}</small>
              </button>`)}
            </div>
          </details>`)}
        </section>
        <section class="detail" aria-label="Issue details">
          ${current ? html`<h3>${taskLabel(snapshot, current.featureId)}</h3>
            ${this._renderDates(current.featureId)}
            <div class="actions">
              <button data-action="open-task" @click=${() => this._onTaskOpen(current.featureId)}>Open task</button>
              <button ?disabled=${!snapshot.visibleIds.has(current.featureId)}
                @click=${() => this._onLocate(current.featureId)}>Locate on board</button>
            </div>
            ${current.issues.map((issue) => html`<div class="relationship">
              <p>${issue.description}</p>
              <p class="muted">${issue.path.map((id) => taskLabel(snapshot, id)).join(' / ')}</p>
              ${issue.category === 'schedule' ? html`<p>${issue.earlyDays} days early / ${issue.lateDays} days late</p>` : ''}
              ${issue.relatedId !== null && snapshot.featuresById.has(issue.relatedId) ? html`
                ${this._renderDates(issue.relatedId)}
                <div class="actions">
                  <button @click=${() => this._onTaskOpen(issue.relatedId)}>Open related task</button>
                  <button ?disabled=${!snapshot.visibleIds.has(issue.relatedId)}
                    @click=${() => this._onLocate(issue.relatedId)}>Locate related task</button>
                </div>
              ` : ''}
            </div>`)}` : ''}
        </section>
      </div>
    </dialog>`;
  }
}

customElements.define('reconciliation-review', ReconciliationReview);