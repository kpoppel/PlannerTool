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
 *   { type: 'board',   planId, insertion, clientX, clientY }
 *   { type: 'group',   group, clientX, clientY }
 *   { type: 'feature', feature, clientX, clientY }
 *
 * `insertion` is the slot resolved by <feature-board>:
 *   { planId, parentId, rank, caretTop, rankUpdates, container }
 */

import { LitElement, html } from '../vendor/lit.js';
import { cmd, sel } from '../application/imports.js';
import { RANK_GAP } from '../application/shared/ordering.js';
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
    this._createSlot = null;
    this._onOutsideClick = this._onOutsideClick.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Static singleton API
  // ---------------------------------------------------------------------------

  /** Mount singleton into document.body. Call once. */
  static init() {
    if (GroupContextMenu._instance) return;
    const el = /** @type {any} */ (document.createElement('group-context-menu'));
    document.body.appendChild(el);
    GroupContextMenu._instance = el;
  }

  /**
   * Show the context menu.
   * @param {{ type:'board'|'group'|'feature', planId?:string, group?:object, feature?:object, clientX:number, clientY:number }} config
   */
  static show(config) {
    if (!GroupContextMenu._instance) GroupContextMenu.init();
    const instance = GroupContextMenu._instance;
    if (!instance) return;
    instance._show(config);
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
    this._createSlot = null;
    this._open = true;
    // Close on any outside click
    setTimeout(() => document.addEventListener('click', this._onOutsideClick, { once: true }), 0);
  }

  _close() {
    this._open = false;
    this._showCreate = false;
    this._showUpdate = false;
    document.removeEventListener('click', this._onOutsideClick);
    // TimelineBoard listens for this to clear the board insertion caret.
    document.dispatchEvent(new CustomEvent('group-menu-closed'));
  }

  _onOutsideClick() {
    this._close();
  }

  // ---------------------------------------------------------------------------
  // Board background actions
  // ---------------------------------------------------------------------------

  /**
   * Begin the create form for a resolved insertion slot.
   * @param {{ parentId: string|null, rank: number, rankUpdates?: Array, caretTop?: number }} slot
   */
  _startCreateGroup(slot) {
    this._createSlot = slot;
    this._parentId = slot.parentId;
    this._showCreate = true;
    if (Number.isInteger(slot.caretTop)) this._moveCaret(slot.caretTop);
  }

  /** Slot for a new first child of `parentGroupId`, ranked ahead of its contents. */
  _subGroupSlot(parentGroupId, caretTop) {
    return {
      parentId: String(parentGroupId),
      rank: RANK_GAP,
      rankUpdates: [],
      caretTop,
    };
  }

  /** Ask TimelineBoard to move the board insertion caret. */
  _moveCaret(caretTop) {
    document.dispatchEvent(new CustomEvent('group-menu-caret', { detail: { caretTop } }));
  }

  async _saveNewGroup() {
    const name = (this._name || '').trim();
    if (!name) return;
    const cfg = this._config;
    if (!cfg) return;
    // planId comes from board-background config or from the parent group's plan_id
    const planId = cfg.type === 'board' ? cfg.planId : cfg.group.plan_id;
    if (!planId) return;
    const slot = this._createSlot;
    if (!slot) return;
    const parentId = slot.parentId;
    const rank = slot.rank;
    const rankUpdates = slot.rankUpdates;
    // Create the group in the active scenario — it lives in scenario.scenarioGroups
    // until the user publishes via the save dialog, at which point it is promoted
    // to the baseline group store.
    cmd.group.createGroupInScenario(
      planId,
      name,
      this._color,
      parentId,
      rank,
      rankUpdates
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
    cmd.group.updateGroupInScenario(group.id, fields);
    this._close();
  }

  _deleteGroup() {
    const group = this._config?.group;
    if (!group) return;
    // Detect sub-groups so we can warn the user.
    const planGroups = sel.group.getEffectiveGroups(group.plan_id || '');
    const subGroups = planGroups.filter((g) => String(g.parent_id) === String(group.id));
    const subMsg = subGroups.length > 0
      ? `\nThis will also delete ${subGroups.length} sub-group(s).`
      : '';
    if (!window.confirm(`Delete group "${group.name}"? Features will become ungrouped.${subMsg}`)) return;
    this._close();
    // Use the new scenario-aware delete — handles both scenario-local and baseline groups.
    // The cascade to sub-groups is handled inside deleteGroupInScenario.
    cmd.group.deleteGroupInScenario(group.id);
  }

  _getFeatureBoard() {
    const timelineBoard = document.querySelector('timeline-board');
    if (!timelineBoard || !timelineBoard.shadowRoot) return null;
    return timelineBoard.shadowRoot.querySelector('feature-board');
  }

  _resolveMoveSlot(direction) {
    const config = this._config;
    if (!config || !config.group) return null;
    const group = config.group;
    if (!group) return null;
    const board = this._getFeatureBoard();
    if (!board || typeof board.getGroupMoveSlot !== 'function') return null;
    return board.getGroupMoveSlot(group.id, direction);
  }

  _moveGroupByDirection(direction) {
    const config = this._config;
    if (!config || !config.group) return;
    const group = config.group;
    if (!group) return;
    const slot = this._resolveMoveSlot(direction);
    if (!slot) return;
    cmd.group.moveGroupInScenario(group.id, {
      parentId: slot.parentId,
      rank: slot.rank,
      rankUpdates: slot.rankUpdates,
    });
    this._close();
  }

  _renderMoveMenuItem(label, enabled, direction) {
    if (!enabled) {
      return html`<div class="menu-item disabled">${label}</div>`;
    }
    return html`<button class="menu-item" @click=${() => this._moveGroupByDirection(direction)}>${label}</button>`;
  }

  // ---------------------------------------------------------------------------
  // Feature card actions
  // ---------------------------------------------------------------------------

  _getFeaturePlanGroups(feature) {
    const features = sel.feature.getEffectiveFeatures();
    const selectedPlanIds = sel.selection.getProjects()
      .filter((plan) => plan.selected)
      .map((plan) => String(plan.id));
    return sel.group.getDisplayGroupsForSelectedPlans(selectedPlanIds, features);
  }

  _getFeatureAndDescendants(feature) {
    const features = sel.feature.getEffectiveFeatures();
    const childrenByParent = new Map();
    for (const item of features) {
      if (!item.parentId) continue;
      const parentId = String(item.parentId);
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(item);
    }

    const result = [feature];
    const queue = [feature];
    const visited = new Set([String(feature.id)]);
    while (queue.length > 0) {
      const current = queue.shift();
      const children = childrenByParent.get(String(current.id)) || [];
      for (const child of children) {
        if (visited.has(String(child.id))) continue;
        visited.add(String(child.id));
        result.push(child);
        queue.push(child);
      }
    }
    return result;
  }

  _assignToGroup(groupId) {
    const feature = this._config?.feature;
    if (!feature) return;
    this._close();
    // Remove from current group first so the card doesn't appear in both groups.
    const planGroups = this._getFeaturePlanGroups(feature);
    for (const task of this._getFeatureAndDescendants(feature)) {
      for (const g of planGroups) {
        if (String(g.id) === String(groupId)) continue; // skip the target
        if ((g.members || []).includes(String(task.id))) {
          cmd.group.removeMemberFromGroup(g.id, task.id);
          break;
        }
      }
      cmd.group.addMemberToGroup(groupId, task.id);
    }
  }

  _removeFromGroup() {
    const feature = this._config?.feature;
    if (!feature) return;
    this._close();
    // Use getEffectiveGroups so scenario-local groups are included in the search.
    const planGroups = this._getFeaturePlanGroups(feature);
    for (const g of planGroups) {
      if ((g.members || []).includes(String(feature.id))) {
        cmd.group.removeMemberFromGroup(g.id, feature.id);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * After every render, re-measure the actual menu element and clamp its
   * position so it never overflows past the right or bottom edge of the
   * viewport (content height varies with submenus / inline forms, so the
   * clamp can't be computed from static estimates in `render()`).
   */
  updated() {
    if (!this._open) return;
    const menuEl = this.shadowRoot && this.shadowRoot.querySelector('.menu');
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const margin = 8;
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    const clampedLeft = Math.max(margin, Math.min(this._x, maxLeft));
    const clampedTop = Math.max(margin, Math.min(this._y, maxTop));
    menuEl.style.left = `${clampedLeft}px`;
    menuEl.style.top = `${clampedTop}px`;
  }

  render() {
    if (!this._open) return html``;

    const cfg = this._config || {};
    const type = cfg.type;

    // Initial position at cursor; `updated()` clamps to the viewport once
    // the menu's real dimensions are known (avoids relying on a fixed
    // estimated width/height that doesn't match variable content).
    const x = this._x;
    const y = this._y;

    if (!sel.scenario.isActiveScenarioMutable()) {
      return html`
        <div class="menu" style="left:${x}px; top:${y}px;" @click=${(e) => e.stopPropagation()}>
          <div class="menu-item" style="pointer-events:none; color:#888; font-size:0.8rem;">
            Switch to an editable scenario to change groups
          </div>
        </div>
      `;
    }

    return html`
      <div class="menu" style="left:${x}px; top:${y}px;" @click=${(e) => e.stopPropagation()}>
        ${type === 'board' ? this._renderBoardMenu() : ''}
        ${type === 'group' ? this._renderGroupMenu() : ''}
        ${type === 'feature' ? this._renderFeatureMenu() : ''}
      </div>
    `;
  }

  _renderBoardMenu() {
    const selectedPlans = sel.selection.getSelectedProjects();
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

    const insertion = this._config.insertion;
    const parentGroup = insertion.parentId === null
      ? null
      : sel.group.getGroupById(insertion.parentId);
    const siblingLabel = parentGroup === null
      ? `New group here in "${selectedPlans[0].name}"`
      : `New group here inside "${parentGroup.name}"`;
    const container = insertion.container;
    // The container is the band the cursor is inside; nesting into it is a
    // different placement from the sibling slot, so both are offered.
    const showNested = container !== null && container.id !== insertion.parentId;

    return html`
      <button
        class="menu-item"
        @mouseenter=${() => this._moveCaret(insertion.caretTop)}
        @click=${() => this._startCreateGroup(insertion)}
      >
        ➕ ${siblingLabel}
      </button>
      ${showNested ? html`
        <button
          class="menu-item"
          @mouseenter=${() => this._moveCaret(container.caretTop)}
          @click=${() => this._startCreateGroup(this._subGroupSlot(container.id, container.caretTop))}
        >
          ➕ New sub-group in "${container.name}"
        </button>
      ` : ''}
    `;
  }

  _renderGroupMenu() {
    const group = this._config?.group;
    if (!group) return html``;
    const canMoveUp = this._resolveMoveSlot('up') !== null;
    const canMoveDown = this._resolveMoveSlot('down') !== null;

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
      const planGroups = sel.group.getEffectiveGroups(planId);
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
      <button class="menu-item" @click=${() => this._startCreateGroup(this._subGroupSlot(group.id))}>➕ Add sub-group</button>
      ${this._renderMoveMenuItem('⬆️ Move up', canMoveUp, 'up')}
      ${this._renderMoveMenuItem('⬇️ Move down', canMoveDown, 'down')}
      <button class="menu-item" @click=${this._startUpdateGroup.bind(this)}>✏️ Update group</button>
      <div class="menu-separator"></div>
      <button class="menu-item danger" @click=${this._deleteGroup.bind(this)}>🗑 Delete group</button>
    `;
  }

  _renderFeatureMenu() {
    const feature = this._config?.feature;
    if (!feature) return html``;

    // Resolve the nearest ancestor plan so Child Context tasks can use mother-plan groups.
    const planGroups = this._getFeaturePlanGroups(feature);

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
GroupContextMenu._instance = null;
export { GroupContextMenu };
