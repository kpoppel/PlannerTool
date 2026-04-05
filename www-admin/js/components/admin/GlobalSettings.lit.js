import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

/**
 * GlobalSettings - Admin panel for server-wide settings.
 *
 * Currently manages:
 *   • Task Type Hierarchy — ordered levels defining parent→child relationships
 *     between task types (e.g. Initiative → Epic → Feature → Bug/User Story → Sub-Task).
 *
 * The settings are stored in data/config/global_settings.yml and served to the
 * user client via /api/projects so that every project carries the same hierarchy.
 *
 * Editor design:
 *   - Complete list of task types is sourced from the projects JSON schema enum.
 *   - A "Pool" row at the bottom shows all types not yet placed in any named level.
 *   - Click a named level row to activate it; pool chips then move types into that
 *     level when clicked.
 *   - Clicking × on a named level chip returns the type to the pool.
 *   - "+ Add Level" adds a level above the pool and activates it immediately.
 *   - Each type can only be in one level; moving removes it from any previous level.
 */
export class AdminGlobalSettings extends LitElement {
  static properties = {
    _hierarchy: { type: Array, state: true },
    _allTypes: { type: Array, state: true },
    _activeLevel: { type: Number, state: true },
    _loading: { type: Boolean, state: true },
    _saving: { type: Boolean, state: true },
    _statusMsg: { type: String, state: true },
    _statusType: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    h2 {
      margin-top: 0;
      font-size: 1.1rem;
    }

    .panel {
      padding: 16px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      max-width: 720px;
    }

    .section-title {
      font-weight: 700;
      font-size: 0.95rem;
      color: #374151;
      margin-bottom: 4px;
    }

    .section-hint {
      font-size: 0.82rem;
      color: #6b7280;
      margin-bottom: 10px;
    }

    /* --- hierarchy editor --- */
    .hierarchy-editor {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .hierarchy-level {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid #e6e6e6;
      border-radius: 6px;
      background: #f9fafb;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }

    .hierarchy-level:hover:not(.pool-level) {
      border-color: #93c5fd;
      background: #eff6ff;
    }

    .hierarchy-level.level-active {
      border-color: #3b82f6;
      background: #eff6ff;
      box-shadow: 0 0 0 2px #bfdbfe;
    }

    /* Pool row — always last, visually distinct */
    .hierarchy-level.pool-level {
      background: #f0fdf4;
      border-color: #bbf7d0;
      cursor: default;
    }

    .hierarchy-level.pool-level.pool-hint {
      border-style: dashed;
    }

    .hierarchy-level-index {
      font-size: 11px;
      color: #9ca3af;
      min-width: 64px;
      padding-top: 6px;
      flex-shrink: 0;
      line-height: 1.4;
    }

    .level-active .hierarchy-level-index {
      color: #2563eb;
      font-weight: 700;
    }

    .pool-level .hierarchy-level-index {
      color: #16a34a;
    }

    .hierarchy-level-types {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      flex: 1;
      align-items: center;
    }

    .hierarchy-level-actions {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
      padding-top: 2px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #e0f2fe;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
    }

    .chip.removable {
      cursor: pointer;
    }

    .chip.removable:hover {
      background: #fecdd3;
    }

    .chip-remove {
      font-weight: bold;
      color: #64748b;
    }

    /* Pool chips */
    .pool-chip {
      display: inline-flex;
      align-items: center;
      background: #dcfce7;
      border: 1px solid #86efac;
      padding: 4px 9px;
      border-radius: 999px;
      font-size: 12px;
      color: #166534;
      cursor: default;
      opacity: 0.7;
    }

    .pool-chip.clickable {
      cursor: pointer;
      opacity: 1;
    }

    .pool-chip.clickable:hover {
      background: #bbf7d0;
    }

    .add-input {
      padding: 4px 8px;
      border: 1px dashed #d1d5db;
      border-radius: 4px;
      font-size: 12px;
      width: 140px;
      background: #fff;
      outline: none;
    }

    .add-input:focus {
      border-color: #3b82f6;
    }

    .icon-btn {
      border: 1px solid #e6e6e6;
      background: #fff;
      width: 28px;
      height: 28px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }

    .icon-btn:hover:not(:disabled) {
      background: #f3f4f6;
    }

    .icon-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .add-level-btn {
      align-self: flex-start;
      margin-top: 4px;
      padding: 7px 14px;
      border: 1px dashed #9ca3af;
      border-radius: 6px;
      background: #fff;
      cursor: pointer;
      font-size: 13px;
      color: #374151;
    }

    .add-level-btn:hover {
      background: #f9fafb;
    }

    .pool-hint-msg {
      font-size: 11px;
      color: #6b7280;
      font-style: italic;
      margin-top: 2px;
      padding: 0 2px;
    }

    /* --- actions bar --- */
    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
      padding-top: 8px;
      border-top: 1px solid #e5e7eb;
    }

    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid #ccc;
      background: #f3f4f6;
      cursor: pointer;
      font-size: 0.9rem;
    }

    .btn.primary {
      background: #3b82f6;
      color: #fff;
      border: none;
    }

    .btn:hover:not(:disabled) {
      filter: brightness(0.95);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .status {
      font-size: 0.85rem;
    }

    .status.ok {
      color: #10b981;
    }

    .status.error {
      color: #ef4444;
    }

    .loading-msg {
      color: #6b7280;
      font-size: 0.9rem;
    }

    /* --- project types palette --- */
    .types-palette {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 10px 12px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      margin-bottom: 10px;
    }

    .types-palette-label {
      font-size: 11px;
      color: #6b7280;
      width: 100%;
      margin-bottom: 2px;
    }

    .palette-chip {
      display: inline-flex;
      align-items: center;
      background: #dcfce7;
      border: 1px solid #86efac;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 12px;
      color: #166534;
    }

    .palette-chip.unplaced {
      cursor: pointer;
    }

    .palette-chip.unplaced:hover {
      background: #bbf7d0;
    }

  `;

  constructor() {
    super();
    this._hierarchy = [];
    this._allTypes = [];
    this._activeLevel = -1;
    this._loading = false;
    this._saving = false;
    this._statusMsg = '';
    this._statusType = 'ok';
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    this._loading = true;
    this._statusMsg = '';
    const [data, schema] = await Promise.all([
      adminProvider.getGlobalSettings(),
      adminProvider.getSchema('projects'),
    ]);
    this._loading = false;
    if (data) {
      this._hierarchy = JSON.parse(JSON.stringify(data.task_type_hierarchy || []));
    } else {
      this._statusMsg = 'Failed to load global settings.';
      this._statusType = 'error';
    }
    // Extract the canonical full list of task types from the projects schema enum.
    const enumTypes =
      schema?.properties?.project_map?.items?.properties?.task_types?.items?.enum || [];
    this._allTypes = [...enumTypes].sort();
    this._activeLevel = -1;
  }

  async _save() {
    this._saving = true;
    this._statusMsg = '';
    const result = await adminProvider.saveGlobalSettings({
      task_type_hierarchy: this._hierarchy,
    });
    this._saving = false;
    if (result && result.ok) {
      this._statusMsg = 'Saved.';
      this._statusType = 'ok';
    } else {
      this._statusMsg = result?.error || 'Save failed.';
      this._statusType = 'error';
    }
  }

  // ---- Computed ----

  /** Returns the set of types placed in any named level. */
  get _placedTypeSet() {
    const placed = new Set();
    this._hierarchy.forEach((l) => (l.types || []).forEach((t) => placed.add(t)));
    return placed;
  }

  /** Types from the schema not yet placed in any named level — shown in the Pool row. */
  get _poolTypes() {
    const placed = this._placedTypeSet;
    return this._allTypes.filter((t) => !placed.has(t));
  }

  // ---- Hierarchy mutation ----

  _addLevel() {
    this._hierarchy = [...this._hierarchy, { types: [] }];
    // Activate the new level so pool clicks immediately target it.
    this._activeLevel = this._hierarchy.length - 1;
  }

  _removeLevel(levelIndex) {
    this._hierarchy = this._hierarchy.filter((_, i) => i !== levelIndex);
    if (this._activeLevel >= this._hierarchy.length) {
      this._activeLevel = this._hierarchy.length - 1;
    }
  }

  _moveLevel(levelIndex, direction) {
    const h = [...this._hierarchy];
    const target = levelIndex + direction;
    if (target < 0 || target >= h.length) return;
    [h[levelIndex], h[target]] = [h[target], h[levelIndex]];
    this._hierarchy = h;
    // Keep active level tracking in sync with the moved level.
    if (this._activeLevel === levelIndex) this._activeLevel = target;
  }

  /**
   * Move a type into the given level, removing it from any other level first.
   * Accepts types not in _allTypes (manual entry via keyboard).
   */
  _moveTypeToLevel(levelIndex, rawType) {
    const trimmed = String(rawType || '').trim();
    if (!trimmed) return;
    const h = JSON.parse(JSON.stringify(this._hierarchy));
    if (!h[levelIndex]) return;
    // Remove from every level to ensure single-assignment invariant.
    h.forEach((l) => {
      l.types = (l.types || []).filter((t) => t !== trimmed);
    });
    h[levelIndex].types = [...(h[levelIndex].types || []), trimmed];
    this._hierarchy = h;
  }

  /** Remove a type from a named level, returning it to the pool. */
  _removeType(levelIndex, type) {
    const h = JSON.parse(JSON.stringify(this._hierarchy));
    if (!h[levelIndex]) return;
    h[levelIndex].types = (h[levelIndex].types || []).filter((t) => t !== type);
    this._hierarchy = h;
  }

  // ---- Render ----

  _renderLevel(level, levelIndex) {
    const isFirst = levelIndex === 0;
    const isLast = levelIndex === this._hierarchy.length - 1;
    const isActive = this._activeLevel === levelIndex;
    return html`
      <div
        class="hierarchy-level ${isActive ? 'level-active' : ''}"
        @click=${() => { this._activeLevel = levelIndex; }}
      >
        <span class="hierarchy-level-index">
          Level ${levelIndex}${isActive ? html`<br/>\u270e active` : ''}
        </span>
        <div class="hierarchy-level-types">
          ${(level.types || []).map(
            (type) => html`
              <span
                class="chip removable"
                title="Remove from level (returns to pool)"
                @click=${(e) => { e.stopPropagation(); this._removeType(levelIndex, type); }}
              >
                ${type}<span class="chip-remove">\u00d7</span>
              </span>
            `
          )}
          <input
            class="add-input"
            placeholder="type + Enter"
            @click=${(e) => e.stopPropagation()}
            @keydown=${(e) => {
              if (e.key === 'Enter') {
                this._moveTypeToLevel(levelIndex, e.target.value);
                e.target.value = '';
              }
            }}
          />
        </div>
        <div class="hierarchy-level-actions">
          <button
            class="icon-btn"
            title="Move level up"
            ?disabled=${isFirst}
            @click=${(e) => { e.stopPropagation(); this._moveLevel(levelIndex, -1); }}
          >\u2191</button>
          <button
            class="icon-btn"
            title="Move level down"
            ?disabled=${isLast}
            @click=${(e) => { e.stopPropagation(); this._moveLevel(levelIndex, 1); }}
          >\u2193</button>
          <button
            class="icon-btn"
            title="Remove level (types return to pool)"
            @click=${(e) => { e.stopPropagation(); this._removeLevel(levelIndex); }}
          >\uD83D\uDDD1</button>
        </div>
      </div>
    `;
  }

  _renderPool() {
    if (!this._allTypes.length) return html``;
    const pool = this._poolTypes;
    const hasTarget = this._activeLevel >= 0;
    const hintText = hasTarget
      ? `Click a type to add it to Level ${this._activeLevel}`
      : 'Click a named level above to activate it, then click types here to assign them';
    return html`
      <div class="hierarchy-level pool-level ${hasTarget ? '' : 'pool-hint'}">
        <span class="hierarchy-level-index">
          Pool<br/><span style="font-size:10px;font-weight:400">(unassigned)</span>
        </span>
        <div class="hierarchy-level-types">
          ${pool.length === 0
            ? html`<span style="color:#16a34a;font-size:12px">All types assigned \u2713</span>`
            : pool.map(
                (t) => html`
                  <span
                    class="pool-chip ${hasTarget ? 'clickable' : ''}"
                    title=${hasTarget
                      ? `Add to Level ${this._activeLevel}`
                      : 'Activate a level first to assign this type'}
                    @click=${() => { if (hasTarget) this._moveTypeToLevel(this._activeLevel, t); }}
                  >${t}</span>
                `
              )}
        </div>
      </div>
      <div class="pool-hint-msg">${hintText}</div>
    `;
  }

  render() {
    if (this._loading) {
      return html`<div class="loading-msg">Loading global settings\u2026</div>`;
    }

    return html`
      <section>
        <h2>Global Settings</h2>
        <div class="panel">

          <!-- Task Type Hierarchy -->
          <div>
            <div class="section-title">Task Type Hierarchy</div>
            <div class="section-hint">
              Define the parent \u2192 child ordering of task types used across the entire
              server. Each level represents one step in the hierarchy; types on the same
              level are siblings. The ordering is applied in the Sidebar filter, Plan
              Menu, and Team Menu in the user client.
              <br/><br/>
              Example: <em>Initiative \u2192 Epic \u2192 Feature \u2192 (User Story, Bug) \u2192 Sub-Task</em>
            </div>

            <div class="hierarchy-editor">
              ${this._hierarchy.length === 0
                ? html`<div style="color:#9ca3af;font-size:13px;padding:8px 0">
                    No levels defined yet. Click "+ Add Level" to start, then assign types from the pool.
                  </div>`
                : this._hierarchy.map((level, idx) => this._renderLevel(level, idx))}

              ${this._renderPool()}

              <button class="add-level-btn" @click=${() => this._addLevel()}>
                + Add Level
              </button>
            </div>
          </div>

          <!-- Actions -->
          <div class="actions">
            <button
              class="btn primary"
              ?disabled=${this._saving}
              @click=${() => this._save()}
            >
              ${this._saving ? 'Saving…' : '💾 Save'}
            </button>
            <button class="btn" @click=${() => this._load()}>🔄 Reload</button>
            ${this._statusMsg
              ? html`<span class="status ${this._statusType}">${this._statusMsg}</span>`
              : ''}
          </div>

        </div>
      </section>
    `;
  }
}

customElements.define('admin-global-settings', AdminGlobalSettings);
