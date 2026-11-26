import { LitElement, html, css, repeat } from '../vendor/lit.js';
import { cmd, sel } from '../application/imports.js';
import { StoreController } from '../core/StoreController.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents } from '../core/EventRegistry.js';
import { getIconTemplate } from '../services/IconService.js';

const INDENT_STEP = 12;

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
      color: #222; font-size: calc(13px * var(--board-zoom, 1)); cursor: pointer;
      background: color-mix(in srgb, var(--group-color) 8%, transparent); }
    .row:hover, .row.highlighted, .row:focus-within { background: #e4eef7; }
    .row.selected { background: #d3e6f8; box-shadow: inset 3px 0 #347ab3; }
    .row.virtual { background-image: repeating-linear-gradient(135deg,
      transparent 0 5px, #526d7914 5px 8px); }
    .group { font-weight: 600; }
    .hierarchy-controls { flex: 0 0 20px; display: flex; flex-direction: column;
      justify-content: center; height: 100%; margin-inline-start: var(--hierarchy-indent); }
    .hierarchy-controls button { display: grid; place-items: center; min-height: 0;
      flex: 0 1 16px; padding: 0; border: 0; border-radius: 3px;
      background: transparent; color: #435b70; cursor: pointer; }
    .hierarchy-controls button:hover { background: #347ab321; }
    .hierarchy-controls button::before { content: ''; width: 5px; height: 5px;
      border-right: 1.5px solid; border-bottom: 1.5px solid; transform: rotate(45deg); }
    .hierarchy-controls .parent-reveal::before { transform: rotate(225deg); }
    .hierarchy-controls .fold[aria-expanded='false']::before { transform: rotate(-45deg); }
    .branch-lines { position: absolute; inset: 0; z-index: 1; pointer-events: none;
      color: #8295a6; }
    .branch-rail, .branch-elbow { position: absolute; }
    .branch-rail { border-inline-start: 1px solid; }
    .branch-elbow { width: 6px; border-top: 1px solid; }
    .task-title { border: 0; background: transparent; color: inherit; text-align: left;
      font: inherit; padding: 0; cursor: pointer; width: 100%; min-width: 0;
      display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      line-height: 1.1; }
    .task-copy { flex: 1; min-width: 0; }
    .task-meta { display: block; margin-top: calc(1px * var(--board-zoom, 1)); line-height: 1.1;
      font-size: calc(10px * var(--board-zoom, 1));
      color: #626d78; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .task-type { flex: 0 0 calc(16px * var(--board-zoom, 1)); display: inline-flex; }
    .task-type svg { width: 100%; height: calc(16px * var(--board-zoom, 1)); }
    button:focus-visible { outline: 2px solid #347ab3; outline-offset: -2px; }
    .count { font-size: 10px; color: #626d78; }
    .band { position: absolute; left: 0; right: 0; pointer-events: none;
      border-top: 2px solid; opacity: .7; }
    .group-band { position: absolute; left: 0; width: 3px; border-left: 3px solid;
      pointer-events: none; box-sizing: border-box; }
    .actions { display: flex; max-width: 48px; flex: 0 0 auto; overflow: hidden; }
  `;

  constructor() {
    super();
    this.layout = {
      height: 0, rows: [], hierarchyRows: null, swimlanes: [], groups: [], searchFeatures: [],
    };
    this.query = '';
    this.highlightedId = '';
    this._matchIndex = -1;
    this._selection = new StoreController(this, (state) => state.featureDisplay.selectedId);
    this._features = new StoreController(this, sel.feature.getEffectiveFeatures);
    this._projects = new StoreController(this, sel.selection.getProjects);
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
    if (String(this._selection.value) === String(feature.id)) {
      this._emit('task-navigate', { id: String(feature.id), align: 'start' });
      return;
    }
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

  _displayedHierarchy() {
    const { rows, hierarchyRows } = this.layout;
    const source = hierarchyRows === null ? rows : hierarchyRows;
    if (this._hierarchySource === source) return this._hierarchy;
    const depths = new Map();
    const rails = new Map();
    const elbows = [];
    const branch = [];
    for (const row of source) {
      if (row.isGroup === true) {
        branch.length = 0;
        continue;
      }
      if (branch.length > 0 && branch[0].laneTop !== row.laneTop) branch.length = 0;
      const parentIndex = branch.findIndex((entry) =>
        String(entry.feature.id) === String(row.feature.parentId));
      const depth = parentIndex + 1;
      depths.set(row.id, depth);
      if (parentIndex >= 0) {
        const parent = branch[parentIndex];
        const left = 16 + parentIndex * INDENT_STEP;
        const top = parent.top + parent.height;
        const center = row.top + row.height / 2;
        rails.set(parent.id, { left, top, height: center - top });
        elbows.push({ childId: row.id, left, top: center });
      }
      branch.length = depth;
      branch.push(row);
    }
    this._hierarchySource = source;
    this._hierarchy = { depths, rails: [...rails.values()], elbows };
    return this._hierarchy;
  }

  render() {
    const byId = new Map(this._features.value.map((feature) => [String(feature.id), feature]));
    const { depths, rails, elbows } = this._displayedHierarchy();
    const { rows } = this.layout;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const inWindow = (top, bottom) => rows.length > 0 && bottom >= first.top
      && top <= last.top + last.height;
    return html`<div class="rows" style="height:${this.layout.height}px" role="list" aria-label="Tasks"
      @mousedown=${(event) => event.stopPropagation()}>
      ${this.layout.swimlanes.map((lane) => html`<div class="band" style="top:${lane.topPx}px;
        height:${lane.heightPx}px;border-color:${lane.color}" title=${lane.name}></div>`)}
      ${this.layout.groups.map((group) => html`<div class="group-band" style="top:${group.top}px;
        height:${group.height}px;border-color:${group.color}"></div>`)}
      ${repeat(rows, (row) => row.id, (row) => {
        const group = row.isGroup === true;
        const virtual = row.presentation !== undefined && row.presentation !== null
          && row.presentation.kind === 'virtual';
        const title = group ? row.groupObj.name : row.feature.title;
        const ancestry = group ? [] : this._ancestry(row.feature, byId);
        const foldable = group || row.foldCount > 0;
        const folded = group ? row.collapsed : row.folded;
        const indent = group ? 0 : depths.get(row.id) * INDENT_STEP;
        const parentReveal = group || virtual ? undefined : row.taskContext.find(({ relation }) =>
          relation === 'parents');
        const groupColor = group ? row.groupObj.color : row.groupColor;
        const metadata = [];
        if (virtual) metadata.push('Other plan');
        if (!group) {
          metadata.push(`#${row.feature.id}`);
          if (row.feature.parentId !== null && row.feature.parentId !== undefined) {
            metadata.push(`Parent #${row.feature.parentId}`);
          }
          const owningPlan = this._projects.value.find((project) =>
            String(project.id) === String(row.feature.project));
          // Context-only tasks have no configured owning plan.
          if (owningPlan !== undefined) metadata.push(owningPlan.name);
          else if (row.feature.sourcePlanName) metadata.push(row.feature.sourcePlanName);
        }
        return html`<div class="row ${group ? 'group' : ''} ${virtual ? 'virtual' : ''} ${this._selection.value === row.id ? 'selected' : ''}
          ${this.highlightedId === row.id ? 'highlighted' : ''}" data-task-id=${row.id}
          style="top:${row.top}px;height:${row.height}px;--hierarchy-indent:${indent}px;--group-color:${groupColor === null || groupColor === undefined ? 'transparent' : groupColor}" role="listitem"
          @click=${() => group ? this._emit('group-toggle', { groupId: row.id, collapsed: !folded }) : this._select(row.feature)}
          @mouseenter=${() => this._emit('task-highlight', { id: row.id })}
          @mouseleave=${() => this._emit('task-highlight', { id: '' })}
          @focusin=${() => this._emit('task-highlight', { id: row.id })}
          @focusout=${() => this._emit('task-highlight', { id: '' })}
          @contextmenu=${(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (virtual) return;
            this._emit(group ? 'group-context-menu' : 'feature-context-menu', {
              group: group ? row.groupObj : null, feature: group ? null : row.feature,
              clientX: event.clientX, clientY: event.clientY,
            });
          }}>
          <div class="hierarchy-controls">
            ${parentReveal === undefined ? '' : html`<button type="button" class="parent-reveal"
              title="Reveal parent" aria-label=${parentReveal.label} aria-expanded=${String(parentReveal.open)}
              @click=${(event) => {
                event.stopPropagation();
                this._emit('task-context-toggle', { featureId: row.id, relation: parentReveal.relation });
              }}></button>`}
            ${foldable ? html`<button type="button" class="fold" aria-expanded=${String(!folded)}
              title=${folded ? 'Expand' : 'Collapse'} aria-label=${`${folded ? 'Expand' : 'Collapse'} ${title}`}
              @click=${(event) => {
                event.stopPropagation();
                this._emit(group ? 'group-toggle' : 'feature-fold-toggle', group
                  ? { groupId: row.id, collapsed: !folded } : { featureId: row.id });
              }}></button>` : ''}
          </div>
          ${group ? '' : html`<span class="task-type" title=${row.feature.type} role="img"
            aria-label=${row.feature.type}>${getIconTemplate(row.feature.type)}</span>`}
          <div class="task-copy"><button class="task-title" title=${[...ancestry, title].join(' / ')}>${title}</button>
            ${group ? '' : html`<span class="task-meta" title=${metadata.join(' - ')}>${metadata.join(' \u00b7 ')}</span>`}
          </div>
          ${folded && !group ? html`<span class="count">${row.foldCount}</span>` : ''}
          ${virtual ? '' : html`<span class="actions" @click=${(event) => event.stopPropagation()}>
            <slot name=${`actions-${row.id}`}></slot></span>`}
        </div>`;
      })}
      <div class="branch-lines" aria-hidden="true">
        ${rails.filter(({ top, height }) => inWindow(top, top + height))
          .map(({ left, top, height }) => html`<span class="branch-rail"
          style="left:${left}px;top:${top}px;height:${height}px"></span>`)}
        ${elbows.filter(({ top }) => inWindow(top, top))
          .map(({ childId, left, top }) => html`<span class="branch-elbow" data-child-id=${childId}
          style="left:${left}px;top:${top}px"></span>`)}
      </div>
    </div>`;
  }
}

customElements.define('task-list', TaskList);