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

import { LitElement, html } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import { groupService } from '../services/GroupService.js';
import { state } from '../services/State.js';
import { groupContextMenuStyles } from './GroupContextMenu.styles.js';
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
    /** Whether the inline update-group form is open (group pill right-click). */
    _showUpdate: { state: true },
  };

  static styles = groupContextMenuStyles;

  constructor() {
    super();
    this._open = false;
    this._x = 0;
    this._y = 0;
    this._config = null;
    this._name = '';
    this._color = GROUP_COLORS[0];
    this._showCreate = false;
    this._showUpdate = false;
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
    this._showUpdate = false;
    this._parentId = null;
    this._open = true;
    // Close on any outside click
    setTimeout(() => document.addEventListener('click', this._onOutsideClick, { once: true }), 0);
  }

  _close() {
    this._open = false;
    this._showCreate = false;
    this._showUpdate = false;
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
    // Create the group in the active scenario — it lives in scenario.scenarioGroups
    // until the user publishes via the save dialog, at which point it is promoted
    // to the baseline group store.
    state.createGroupInScenario(
      planId,
      name,
      this._color || null,
      this._parentId || null
    );
    this._close();
  }

  // ---------------------------------------------------------------------------
  // Group pill actions
  // ---------------------------------------------------------------------------

  /** Open the inline update form, pre-filling from the group's current values. */
  _startUpdateGroup() {
    const group = this._config?.group;
    if (!group) return;
    this._name = group.name || '';
    this._color = group.color || GROUP_COLORS[0];
    this._parentId = group.parent_id || null;
    this._showUpdate = true;
  }

  _saveUpdateGroup() {
    const name = (this._name || '').trim();
    if (!name) return;
    const group = this._config?.group;
    if (!group) return;
    const fields = { name, color: this._color };
    // Only write parent_id when it has actually changed to avoid polluting the
    // group override with no-op parent updates.
    const newParent = this._parentId || null;
    const oldParent = group.parent_id || null;
    if (newParent !== oldParent) {
      fields.parent_id = newParent;
    }
    // Use the new scenario-aware update — works for both scenario-local and baseline groups.
    state.updateGroupInScenario(group.id, fields);
    this._close();
  }

  _deleteGroup() {
    const group = this._config?.group;
    if (!group) return;
    // Detect sub-groups so we can warn the user.
    const activeScenario = state.getActiveScenario();
    const planGroups = groupService.getEffectiveGroups(group.plan_id || '', activeScenario);
    const subGroups = planGroups.filter((g) => String(g.parent_id) === String(group.id));
    const subMsg = subGroups.length > 0
      ? `\nThis will also delete ${subGroups.length} sub-group(s).`
      : '';
    if (!window.confirm(`Delete group "${group.name}"? Features will become ungrouped.${subMsg}`)) return;
    this._close();
    // Use the new scenario-aware delete — handles both scenario-local and baseline groups.
    // The cascade to sub-groups is handled inside deleteGroupInScenario.
    state.deleteGroupInScenario(group.id);
  }

  // ---------------------------------------------------------------------------
  // Feature card actions
  // ---------------------------------------------------------------------------

  _assignToGroup(groupId) {
    const feature = this._config?.feature;
    if (!feature) return;
    this._close();
    const activeScenario = state.getActiveScenario();
    // Remove from current group first so the card doesn't appear in both groups.
    const planGroups = groupService.getEffectiveGroups(feature.project, activeScenario);
    for (const g of planGroups) {
      if (String(g.id) === String(groupId)) continue; // skip the target
      const effectiveMembers =
        activeScenario?.groupOverrides?.[g.id]?.members ?? (g.members || []);
      if (effectiveMembers.includes(String(feature.id))) {
        groupService.removeMemberFromGroup(g.id, feature.id, state);
        break;
      }
    }
    groupService.addMemberToGroup(groupId, feature.id, state);
  }

  _removeFromGroup() {
    const feature = this._config?.feature;
    if (!feature) return;
    this._close();
    // Use getEffectiveGroups so scenario-local groups are included in the search.
    const activeScenario = state.getActiveScenario();
    const planGroups = groupService.getEffectiveGroups(feature.project, activeScenario);
    for (const g of planGroups) {
      const effectiveMembers =
        activeScenario?.groupOverrides?.[g.id]?.members ?? (g.members || []);
      if (effectiveMembers.includes(String(feature.id))) {
        groupService.removeMemberFromGroup(g.id, feature.id, state);
        break;
      }
    }
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

    // --- Inline sub-group creation form ---
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

    // --- Inline update form ---
    if (this._showUpdate) {
      // Build list of eligible parents: all groups in this plan except the
      // group itself and any of its descendants (to avoid cycles).
      const planId = group.plan_id || '';
      const activeScenario = state.getActiveScenario();
      const planGroups = groupService.getEffectiveGroups(planId, activeScenario);
      // Collect descendant IDs so we can exclude them from the parent selector.
      const descendants = new Set([String(group.id)]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const g of planGroups) {
          if (g.parent_id && descendants.has(String(g.parent_id)) && !descendants.has(String(g.id))) {
            descendants.add(String(g.id));
            changed = true;
          }
        }
      }
      const eligibleParents = planGroups.filter((g) => !descendants.has(String(g.id)));

      return html`
        <div class="create-form">
          <div style="font-size:0.75rem; color:#555; margin-bottom:2px; font-weight:600;">Update group</div>
          <input
            type="text"
            placeholder="Group name"
            .value=${this._name}
            @input=${(e) => { this._name = e.target.value; }}
            @keydown=${(e) => { if (e.key === 'Enter') this._saveUpdateGroup(); if (e.key === 'Escape') this._close(); }}
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
          ${eligibleParents.length > 0 ? html`
            <div>
              <label style="font-size:0.75rem; color:#555; display:block; margin-bottom:3px;">Parent group</label>
              <select
                style="width:100%; box-sizing:border-box; padding:4px 6px; font-size:0.82rem; border:1px solid #ccc; border-radius:4px;"
                .value=${this._parentId || ''}
                @change=${(e) => { this._parentId = e.target.value || null; }}
              >
                <option value="">— None (top level) —</option>
                ${eligibleParents.map((g) => html`
                  <option value="${g.id}" ?selected=${this._parentId === g.id}>${g.name}</option>
                `)}
              </select>
            </div>
          ` : ''}
          <div class="create-actions">
            <button class="btn" @click=${this._close.bind(this)}>Cancel</button>
            <button class="btn primary" @click=${this._saveUpdateGroup.bind(this)}>Save</button>
          </div>
        </div>
      `;
    }

    // --- Default menu ---
    return html`
      <button class="menu-item" @click=${() => this._startCreateGroup(group.id)}>➕ Add sub-group</button>
      <button class="menu-item" @click=${this._startUpdateGroup.bind(this)}>✏️ Update group</button>
      <div class="menu-separator"></div>
      <button class="menu-item danger" @click=${this._deleteGroup.bind(this)}>🗑 Delete group</button>
    `;
  }

  _renderFeatureMenu() {
    const feature = this._config?.feature;
    if (!feature) return html``;

    // Use getEffectiveGroups so scenario-local groups (scenarioGroups) are included.
    const activeScenario = state.getActiveScenario();
    const planGroups = groupService.getEffectiveGroups(feature.project, activeScenario);

    // Determine if this feature is already in a group by checking group.members
    const currentGroup = planGroups.find(
      (g) => (g.members || []).includes(String(feature.id))
    ) || null;
    const currentGroupId = currentGroup?.id ?? null;

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
