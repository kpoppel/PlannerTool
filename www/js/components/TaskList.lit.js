import { LitElement, html, css, repeat } from '../vendor/lit.js';
import { cmd, sel } from '../application/imports.js';
import { StoreController } from '../core/StoreController.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents } from '../core/EventRegistry.js';

export class TaskList extends LitElement {
  static properties = {
    layout: { attribute: false }, query: { type: String }, highlightedId: { type: String },
  };

  static styles = css`
    :host { display: block; position: sticky; left: 0; z-index: 20; min-width: 0;
      background: var(--color-bg, #f7f7f7); border-right: 1px solid #bec8d2;
      box-sizing: border-box; cursor: default; }
    .rows { position: relative; min-height: 100%; }
    .row { position: absolute; left: 0; right: 0; display: flex; align-items: center;
      gap: 4px; padding: 0 8px; box-sizing: border-box; border-bottom: 1px solid #dde1e5;
      color: #222; font-size: calc(13px * var(--board-zoom, 1)); }
    .row:hover, .row.highlighted, .row:focus-within { background: #e4eef7; }
    .row.selected { background: #d3e6f8; box-shadow: inset 3px 0 #347ab3; }
    .group { background: #e2e7ec; font-weight: 600; }
    .fold { flex: 0 0 24px; width: 24px; height: 24px; padding: 0; border: 0;
      background: transparent; color: inherit; cursor: pointer; }
    .fold:disabled { visibility: hidden; }
    .task-title { border: 0; background: transparent; color: inherit; text-align: left;
      font: inherit; padding: 2px 0; cursor: pointer; min-width: 0; flex: 1;
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
      overflow: hidden; overflow-wrap: anywhere; }
    button:focus-visible { outline: 2px solid #347ab3; outline-offset: -2px; }
    .level { flex: 0 0 24px; text-align: center; color: #626d78; font-size: 10px; }
    .count { font-size: 10px; color: #626d78; }
    .band { position: absolute; left: 0; right: 0; pointer-events: none;
      border-top: 2px solid; opacity: .7; }
    .group-band { position: absolute; left: 0; width: 3px; border-left: 3px solid;
      pointer-events: none; box-sizing: border-box; }
    .actions { display: flex; max-width: 48px; flex: 0 0 auto; overflow: hidden; }
  `;

  constructor() {
    super();
    this.layout = { height: 0, rows: [], swimlanes: [], groups: [], searchFeatures: [] };
    this.query = '';
    this.highlightedId = '';
    this._matchIndex = -1;
    this._selection = new StoreController(this, (state) => state.featureDisplay.selectedId);
    this._features = new StoreController(this, sel.feature.getEffectiveFeatures);
  }

  updated(changed) {
    const previousLayout = changed.get('layout');
    if (changed.has('query') || (changed.has('layout') && (previousLayout === undefined ||
      previousLayout.searchFeatures !== this.layout.searchFeatures))) {
      this._matchIndex = -1;
      this._emit('search-status-changed', { count: this.getMatches().length, index: 0 });
    }
  }

  getMatches() {
    const query = this.query.trim().toLowerCase();
    if (query === '') return [];
    const ids = [];
    const titles = [];
    for (const feature of this.layout.searchFeatures) {
      if (String(feature.id).toLowerCase().includes(query)) ids.push(feature);
      else if (feature.title.toLowerCase().includes(query)) titles.push(feature);
    }
    return [...ids, ...titles];
  }

  navigateMatch(direction) {
    const matches = this.getMatches();
    if (matches.length === 0) return;
    this._matchIndex = this._matchIndex < 0 ? (direction > 0 ? 0 : matches.length - 1)
      : (this._matchIndex + direction + matches.length) % matches.length;
    this._emit('task-navigate', { id: String(matches[this._matchIndex].id) });
    this._emit('search-status-changed', { count: matches.length, index: this._matchIndex + 1 });
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  _select(feature) {
    if (sel.view.getHighlightFeatureRelationMode()) bus.emit(FeatureEvents.REQUEST_CONNECTED_SET, feature);
    cmd.feature.setSelectedFeature(feature);
  }

  _ancestry(feature, byId) {
    const titles = [];
    const seen = new Set([String(feature.id)]);
    let parentId = feature.parentId;
    while (parentId !== null && parentId !== undefined && byId.has(String(parentId))) {
      const key = String(parentId);
      if (seen.has(key)) break;
      seen.add(key);
      const parent = byId.get(key);
      titles.unshift(parent.title);
      parentId = parent.parentId;
    }
    return titles;
  }

  render() {
    const byId = new Map(this._features.value.map((feature) => [String(feature.id), feature]));
    return html`<div class="rows" style="height:${this.layout.height}px" role="list" aria-label="Tasks"
      @mousedown=${(event) => event.stopPropagation()}>
      ${this.layout.swimlanes.map((lane) => html`<div class="band" style="top:${lane.topPx}px;
        height:${lane.heightPx}px;border-color:${lane.color}" title=${lane.name}></div>`)}
      ${this.layout.groups.map((group) => html`<div class="group-band" style="top:${group.top}px;
        height:${group.height}px;border-color:${group.color}"></div>`)}
      ${repeat(this.layout.rows, (row) => row.id, (row) => {
        const group = row.isGroup === true;
        const title = group ? row.groupObj.name : row.feature.title;
        const ancestry = group ? [] : this._ancestry(row.feature, byId);
        const foldable = group || row.foldCount > 0;
        const folded = group ? row.collapsed : row.folded;
        return html`<div class="row ${group ? 'group' : ''} ${this._selection.value === row.id ? 'selected' : ''}
          ${this.highlightedId === row.id ? 'highlighted' : ''}" data-task-id=${row.id}
          style="top:${row.top}px;height:${row.height}px" role="listitem"
          @mouseenter=${() => this._emit('task-highlight', { id: row.id })}
          @mouseleave=${() => this._emit('task-highlight', { id: '' })}
          @focusin=${() => this._emit('task-highlight', { id: row.id })}
          @focusout=${() => this._emit('task-highlight', { id: '' })}
          @contextmenu=${(event) => {
            event.preventDefault();
            event.stopPropagation();
            this._emit(group ? 'group-context-menu' : 'feature-context-menu', {
              group: group ? row.groupObj : null, feature: group ? null : row.feature,
              clientX: event.clientX, clientY: event.clientY,
            });
          }}>
          <button class="fold" ?disabled=${!foldable} aria-expanded=${foldable ? String(!folded) : 'false'}
            aria-label=${`${folded ? 'Expand' : 'Collapse'} ${title}`}
            @click=${() => this._emit(group ? 'group-toggle' : 'feature-fold-toggle', group
              ? { groupId: row.id, collapsed: !folded } : { featureId: row.id })}>
            ${folded ? html`&#9656;` : html`&#9662;`}</button>
          <span class="level" title=${ancestry.join(' / ')}>${ancestry.length > 0 ? ancestry.length : ''}</span>
          <button class="task-title" title=${[...ancestry, title].join(' / ')}
            @click=${() => group ? this._emit('group-toggle', { groupId: row.id, collapsed: !folded })
              : this._select(row.feature)}>${title}</button>
          ${folded && !group ? html`<span class="count">${row.foldCount}</span>` : ''}
          <span class="actions"><slot name=${`actions-${row.id}`}></slot></span>
        </div>`;
      })}
    </div>`;
  }
}

customElements.define('task-list', TaskList);