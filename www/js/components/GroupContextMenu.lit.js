/**
 * GroupContextMenu.lit.js
 *
 * Singleton right-click context menu for group operations.
 *
 * Invoked from three places:
 *   1. Right-click on board background  → "New group" for the plan at that position
 *   2. Right-click on a group pill      → "Rename", "Delete group"
 *   3. Right-click on a feature card   → "Add to group …", "Remove from group"
 *
 * The component is mounted once into document.body and shown/hidden as needed.
 * It positions itself at the cursor location and auto-closes on outside click.
 *
 * Usage (static helper):
 *   GroupContextMenu.init()   — call once after DOM ready (done by TimelineBoard)
 *   GroupContextMenu.show(config)  — show menu at cursor position
 *
 * Config shape:
 *   { type: 'board',   planId, clientX, clientY }
 *   { type: 'group',   group, clientX, clientY }
 *   { type: 'feature', feature, clientX, clientY }
 */

import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import { groupService } from '../services/GroupService.js';
import { state } from '../services/State.js';
import './Modal.lit.js';

/** Default colour palette used when creating a new group. */
const GROUP_COLORS = [
  '#4c8ef5', '#34a853', '#fbbc04', '#ea4335',
  '#9c27b0', '#00acc1', '#ff7043', '#78909c',
];

class GroupContextMenu extends LitElement {
  static properties = {
    _open:    { state: true },
    _x:       { state: true },
    _y:       { state: true },
    _config:  { state: true },
    /** For create-group flow: name / color inputs */
    _name:    { state: true },
    _color:   { state: true },
    _showCreate: { state: true },
    /** Parent group id when creating a sub-group (null = top-level). */
    _parentId: { state: true },
  };

  static styles = css`
    :host {
      position: fixed;
      z-index: 9000;
      pointer-events: none;
    }
    .menu {
      position: fixed;
      background: #fff;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
      padding: 4px 0;
      min-width: 180px;
      pointer-events: auto;
      font-family: inherit;
    }
    .menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      font-size: 0.85rem;
      color: #222;
      cursor: pointer;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      border-radius: 4px;
    }
    .menu-item:hover { background: #f0f4ff; }
    .menu-item.danger { color: #c0392b; }
    .menu-item.danger:hover { background: #fff0f0; }
    .menu-separator {
      height: 1px;
      background: rgba(0,0,0,0.08);
      margin: 3px 0;
    }
    /* Inline create form */
    .create-form {
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .create-form input[type='text'] {
      width: 100%;
      box-sizing: border-box;
      padding: 5px 8px;
      font-size: 0.85rem;
      border: 1px solid #ccc;
      border-radius: 4px;
    }
    .swatch-row {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .swatch {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      border: 2px solid transparent;
      cursor: pointer;
      box-sizing: border-box;
    }
    .swatch.selected { border-color: #fff; box-shadow: 0 0 0 2px #0078d4; }
    .create-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    .btn {
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid #ccc;
      cursor: pointer;
      font-size: 0.8rem;
      background: #fff;
    }
    .btn.primary { background: #0078d4; color: #fff; border-color: #0078d4; }
  `;

  constructor() {
    super();
    this._open = false;
    this._x = 0;
    this._y = 0;
    this._config = null;
    this._name = '';
    this._color = GROUP_COLORS[0];
    this._showCreate = false;
    this._parentId = null;
    this._onOutsideClick = this._onOutsideClick.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Static singleton API
  // ---------------------------------------------------------------------------

  static _instance = null;

  /** Mount singleton into document.body. Call once. */
  static init() {
    if (GroupContextMenu._instance) return;
    const el = document.createElement('group-context-menu');
    document.body.appendChild(el);
    GroupContextMenu._instance = el;
  }

  /**
   * Show the context menu.
   * @param {{ type:'board'|'group'|'feature', planId?:string, group?:object, feature?:object, clientX:number, clientY:number }} config
   */
  static show(config) {
    if (!GroupContextMenu._instance) GroupContextMenu.init();
    GroupContextMenu._instance._show(config);
  }

  // ---------------------------------------------------------------------------
  // Instance methods
  // ---------------------------------------------------------------------------

  _show(config) {
    this._config = config;
    this._x = config.clientX;
    this._y = config.clientY;
    this._name = '';
    this._color = GROUP_COLORS[0];
    this._showCreate = false;
    this._parentId = null;
    this._open = true;
    // Close on any outside click
    setTimeout(() => document.addEventListener('click', this._onOutsideClick, { once: true }), 0);
  }

  _close() {
    this._open = false;
    this._showCreate = false;
    document.removeEventListener('click', this._onOutsideClick);
  }

  _onOutsideClick() {
    this._close();
  }

  // ---------------------------------------------------------------------------
  // Board background actions
  // ---------------------------------------------------------------------------

  _startCreateGroup(parentId = null) {
    this._parentId = parentId;
    this._showCreate = true;
  }

  async _saveNewGroup() {
    const name = (this._name || '').trim();
    if (!name) return;
    // planId comes from board-background config or from the parent group's plan_id
    const planId = this._config?.planId ?? this._config?.group?.plan_id;
    if (!planId) return;
    // Generate a temporary local ID — swapped for the real server ID when the
    // user accepts the changes through the save dialog.
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const group = {
      id: tempId,
      plan_id: planId,
      name,
      color: this._color,
      rank: Date.now(),
      ...(this._parentId ? { parent_id: this._parentId } : {}),
    };
    groupService.addLocal(planId, group);
    state.addPendingGroupChange({ type: 'create', group });
    this._close();
  }

  // ---------------------------------------------------------------------------
  // Group pill actions
  // ---------------------------------------------------------------------------

  _renameGroup() {
    const group = this._config?.group;
    if (!group) return;
    this._close();
    const newName = window.prompt('Rename group:', group.name);
    if (newName && newName.trim() && newName.trim() !== group.name) {
      const fields = { name: newName.trim() };
      groupService.updateLocal(group.id, fields);
      state.addPendingGroupChange({ type: 'update', groupId: group.id, fields });
    }
  }

  _deleteGroup() {
    const group = this._config?.group;
    if (!group) return;
    // Detect sub-groups so we can warn the user.
    const planGroups = groupService.getGroupsForPlan(group.plan_id || '');
    const subGroups = planGroups.filter((g) => String(g.parent_id) === String(group.id));
    const subMsg = subGroups.length > 0
      ? `\nThis will also delete ${subGroups.length} sub-group(s).`
      : '';
    if (!window.confirm(`Delete group "${group.name}"? Features will become ungrouped.${subMsg}`)) return;
    this._close();
    // Collect all groups to remove (parent + sub-groups, recursively)
    const toRemove = new Set([String(group.id)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const g of planGroups) {
        if (g.parent_id && toRemove.has(String(g.parent_id)) && !toRemove.has(String(g.id))) {
          toRemove.add(String(g.id));
          changed = true;
        }
      }
    }
    // Clear group assignment from all features belonging to any removed group.
    const features = (state.getEffectiveFeatures() || []).filter(
      (f) => f.groupId && toRemove.has(String(f.groupId))
    );
    for (const f of features) {
      groupService.assignFeature(f.id, null, state);
    }
    // removeLocal cascades sub-group removal automatically.
    groupService.removeLocal(group.id);
    state.addPendingGroupChange({ type: 'delete', groupId: group.id, groupName: group.name });
  }

  // ---------------------------------------------------------------------------
  // Feature card actions
  // ---------------------------------------------------------------------------

  _assignToGroup(groupId) {
    const feature = this._config?.feature;
    if (!feature) return;
    this._close();
    groupService.assignFeature(feature.id, groupId, state);
  }

  _removeFromGroup() {
    const feature = this._config?.feature;
    if (!feature) return;
    this._close();
    groupService.assignFeature(feature.id, null, state);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  render() {
    if (!this._open) return html``;

    const cfg = this._config || {};
    const type = cfg.type;

    // Clamp menu to viewport
    const menuW = 200;
    const x = Math.min(this._x, window.innerWidth - menuW - 8);
    const y = this._y;

    return html`
      <div class="menu" style="left:${x}px; top:${y}px;" @click=${(e) => e.stopPropagation()}>
        ${type === 'board' ? this._renderBoardMenu() : ''}
        ${type === 'group' ? this._renderGroupMenu() : ''}
        ${type === 'feature' ? this._renderFeatureMenu() : ''}
      </div>
    `;
  }

  _renderBoardMenu() {
    const selectedPlans = state.projects.filter((p) => p.selected);
    // Multiple plans selected — can't determine which plan to create group in
    if (selectedPlans.length !== 1) {
      return html`
        <div class="menu-item" style="pointer-events:none; color:#888; font-size:0.8rem;">
          Select a single plan to create groups
        </div>
      `;
    }

    if (this._showCreate) {
      return html`
        <div class="create-form">
          <input
            type="text"
            placeholder="Group name"
            .value=${this._name}
            @input=${(e) => { this._name = e.target.value; }}
            @keydown=${(e) => { if (e.key === 'Enter') this._saveNewGroup(); if (e.key === 'Escape') this._close(); }}
            autofocus
          />
          <div class="swatch-row">
            ${GROUP_COLORS.map((c) => html`
              <button
                class="swatch ${this._color === c ? 'selected' : ''}"
                style="background:${c}"
                @click=${() => { this._color = c; }}
                title="${c}"
              ></button>
            `)}
          </div>
          <div class="create-actions">
            <button class="btn" @click=${this._close.bind(this)}>Cancel</button>
            <button class="btn primary" @click=${this._saveNewGroup.bind(this)}>Create</button>
          </div>
        </div>
      `;
    }

    return html`
      <button class="menu-item" @click=${this._startCreateGroup.bind(this)}>
        ➕ New group for "${selectedPlans[0].name}"
      </button>
    `;
  }

  _renderGroupMenu() {
    const group = this._config?.group;
    if (!group) return html``;

    if (this._showCreate) {
      const parentLabel = `sub-group of "${group.name}"`;
      return html`
        <div class="create-form">
          <div style="font-size:0.75rem; color:#555; margin-bottom:2px;">New ${parentLabel}</div>
          <input
            type="text"
            placeholder="Sub-group name"
            .value=${this._name}
            @input=${(e) => { this._name = e.target.value; }}
            @keydown=${(e) => { if (e.key === 'Enter') this._saveNewGroup(); if (e.key === 'Escape') this._close(); }}
            autofocus
          />
          <div class="swatch-row">
            ${GROUP_COLORS.map((c) => html`
              <button
                class="swatch ${this._color === c ? 'selected' : ''}"
                style="background:${c}"
                @click=${() => { this._color = c; }}
                title="${c}"
              ></button>
            `)}
          </div>
          <div class="create-actions">
            <button class="btn" @click=${this._close.bind(this)}>Cancel</button>
            <button class="btn primary" @click=${this._saveNewGroup.bind(this)}>Create</button>
          </div>
        </div>
      `;
    }

    return html`
      <button class="menu-item" @click=${() => this._startCreateGroup(group.id)}>➕ Add sub-group</button>
      <button class="menu-item" @click=${this._renameGroup.bind(this)}>✏️ Rename group</button>
      <div class="menu-separator"></div>
      <button class="menu-item danger" @click=${this._deleteGroup.bind(this)}>🗑 Delete group</button>
    `;
  }

  _renderFeatureMenu() {
    const feature = this._config?.feature;
    if (!feature) return html``;

    // Only show groups for the feature's plan
    const planGroups = groupService.getGroupsForPlan(feature.project);
    const currentGroupId = feature.groupId ?? null;

    return html`
      ${currentGroupId ? html`
        <button class="menu-item" @click=${this._removeFromGroup.bind(this)}>
          Remove from group
        </button>
        <div class="menu-separator"></div>
      ` : ''}
      ${planGroups.length === 0
        ? html`<div class="menu-item" style="pointer-events:none; color:#888; font-size:0.8rem;">No groups — right-click board to create one</div>`
        : html`
          <div class="menu-item" style="pointer-events:none; font-size:0.75rem; color:#888; padding-bottom:2px;">Add to group:</div>
          ${planGroups
            .filter((g) => String(g.id) !== String(currentGroupId))
            .map((g) => html`
              <button class="menu-item" @click=${() => this._assignToGroup(g.id)}>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.color || '#888'};flex-shrink:0;"></span>
                ${g.name}
              </button>
            `)
          }
        `
      }
    `;
  }
}

customElements.define('group-context-menu', GroupContextMenu);
export { GroupContextMenu };
