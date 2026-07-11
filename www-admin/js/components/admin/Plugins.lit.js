import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';
import { getPluginSchema, hasPluginSchema } from '../../core/pluginSchemaRegistry.js';

/**
 * AdminPlugins — Admin panel for managing plugin runtime settings.
 *
 * Loads:
 *  - Static plugin metadata from /www/js/modules.config.json (read-only).
 *  - Runtime plugin config from /admin/v1/plugins-config (editable).
 *
 * Editable fields per plugin: enabled, activated, order (move up/down).
 *
 * UI rules enforced:
 *  - If enabled is false, activated must be false.
 *  - Only one plugin can be activated at a time.
 *  - An entry missing an id is shown as a validation error and blocks save.
 */
export class AdminPlugins extends LitElement {
  static properties = {
    _metadata: { type: Array, state: true },
    _rows: { type: Array, state: true },
    _schemas: { type: Object, state: true },
    _loading: { type: Boolean, state: true },
    _saving: { type: Boolean, state: true },
    _statusMsg: { type: String, state: true },
    _statusType: { type: String, state: true },
    _validationErrors: { type: Array, state: true },
    _editingConfigIndex: { type: Number, state: true },
    _configEditorValue: { type: String, state: true },
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
      max-width: 1100px;
    }

    .hint {
      font-size: 0.82rem;
      color: #6b7280;
      margin-bottom: 14px;
    }

    .status {
      margin: 10px 0;
      font-size: 0.85rem;
      padding: 6px 10px;
      border-radius: 4px;
    }

    .status.ok {
      background: #d1fae5;
      color: #065f46;
    }

    .status.error {
      background: #fee2e2;
      color: #991b1b;
    }

    .validation-errors {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
      border-radius: 4px;
      padding: 8px 12px;
      margin-bottom: 12px;
      font-size: 0.85rem;
    }

    .validation-errors ul {
      margin: 4px 0 0;
      padding-left: 18px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }

    thead th {
      text-align: left;
      padding: 8px 10px;
      background: #f3f4f6;
      border-bottom: 2px solid #e5e7eb;
      font-weight: 600;
      color: #374151;
      white-space: nowrap;
    }

    tbody tr {
      border-bottom: 1px solid #f3f4f6;
    }

    tbody tr:hover {
      background: #f9fafb;
    }

    tbody tr.disabled-row {
      opacity: 0.6;
    }

    tbody tr.invalid-row {
      background: #fef9ec;
    }

    td {
      padding: 8px 10px;
      vertical-align: middle;
    }

    .td-name {
      font-weight: 600;
      white-space: nowrap;
    }

    .td-version {
      color: #6b7280;
      font-size: 0.8rem;
      white-space: nowrap;
    }

    .td-desc {
      color: #374151;
      max-width: 300px;
    }

    .toggle-cell {
      text-align: center;
    }

    .toggle {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
    }

    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: #d1d5db;
      border-radius: 20px;
      transition: 0.2s;
    }

    .slider:before {
      position: absolute;
      content: '';
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background: #fff;
      border-radius: 50%;
      transition: 0.2s;
    }

    input:checked + .slider {
      background: #3b82f6;
    }

    input:checked + .slider:before {
      transform: translateX(16px);
    }

    .radio-cell {
      text-align: center;
    }

    .order-cell {
      white-space: nowrap;
    }

    .order-btn {
      background: none;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      padding: 2px 7px;
      cursor: pointer;
      font-size: 0.85rem;
      color: #374151;
      margin: 0 1px;
    }

    .order-btn:hover:not(:disabled) {
      background: #f3f4f6;
    }

    .order-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .action-bar {
      display: flex;
      gap: 10px;
      margin-top: 16px;
      align-items: center;
    }

    .btn-save {
      padding: 8px 20px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.9rem;
    }

    .btn-save:hover:not(:disabled) {
      background: #1d4ed8;
    }

    .btn-save:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .btn-reload {
      padding: 8px 14px;
      background: #f3f4f6;
      color: #374151;
      border: 1px solid #d1d5db;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.9rem;
    }

    .btn-reload:hover:not(:disabled) {
      background: #e5e7eb;
    }

    .loading-msg {
      color: #6b7280;
      font-size: 0.9rem;
      padding: 16px 0;
    }

    .missing-id-badge {
      display: inline-block;
      padding: 2px 6px;
      background: #fee2e2;
      color: #991b1b;
      border-radius: 4px;
      font-size: 0.75rem;
      font-family: monospace;
    }

    .config-btn {
      padding: 2px 8px;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 0.85rem;
      cursor: pointer;
      white-space: nowrap;
    }

    .config-btn:hover:not(:disabled) {
      background: #4f46e5;
    }

    .config-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal {
      background: #fff;
      border-radius: 8px;
      padding: 24px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 25px rgba(0, 0, 0, 0.15);
    }

    .modal-header {
      margin: 0 0 16px;
      font-size: 1.1rem;
      font-weight: 600;
      color: #1f2937;
    }

    .modal-body {
      margin-bottom: 16px;
    }

    .modal-field {
      margin-bottom: 12px;
    }

    .modal-label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      color: #374151;
      margin-bottom: 4px;
    }

    .modal-input {
      width: 100%;
      padding: 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: monospace;
      box-sizing: border-box;
    }

    .modal-textarea {
      width: 100%;
      padding: 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: monospace;
      min-height: 200px;
      box-sizing: border-box;
    }

    .modal-error {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fecaca;
      padding: 8px 12px;
      border-radius: 4px;
      margin-bottom: 12px;
      font-size: 0.85rem;
    }

    .modal-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }

    .btn-modal {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }

    .btn-modal-save {
      background: #3b82f6;
      color: #fff;
    }

    .btn-modal-save:hover {
      background: #2563eb;
    }

    .btn-modal-cancel {
      background: #e5e7eb;
      color: #374151;
    }

    .btn-modal-cancel:hover {
      background: #d1d5db;
    }
  `;

  constructor() {
    super();
    this._metadata = [];
    this._rows = [];
    this._schemas = {};
    this._loading = true;
    this._saving = false;
    this._statusMsg = '';
    this._statusType = '';
    this._validationErrors = [];
    this._editingConfigIndex = -1;
    this._configEditorValue = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    this._loading = true;
    this._statusMsg = '';
    this._statusType = '';
    this.requestUpdate();

    const [metaResponse, runtimeConfig, schemas] = await Promise.all([
      this._fetchMetadata(),
      adminProvider.getPluginsConfig(),
      this._discoverPluginSchemas(),
    ]);

    this._metadata = metaResponse;
    this._rows = this._mergeConfig(metaResponse, runtimeConfig);
    this._schemas = schemas;
    this._validationErrors = this._detectValidationErrors(metaResponse);
    this._loading = false;
    this.requestUpdate();
  }

  /**
   * Discover plugin schemas by fetching individual plugin-specific .schema.json files.
   * For each plugin in metadata, attempts to load its {PluginName}.schema.json file.
   * @returns {Promise<object>} Schema map { pluginId: { schema, defaultConfig } }
   */
  async _discoverPluginSchemas() {
    try {
      const schemas = {};
      const base = window.APP_BASE_URL || '';
      
      // First fetch metadata to get list of all plugins
      const metaRes = await fetch(`${base}/static/js/modules.config.json`);
      if (!metaRes.ok) return {};
      const metaJson = await metaRes.json();
      const modules = Array.isArray(metaJson.modules) ? metaJson.modules : [];
      
      // For each plugin, attempt to fetch its schema file
      for (const module of modules) {
        if (!module.id) continue;
        
        // Convert plugin id to PluginClassName
        // e.g., 'sample-plugin' -> 'SamplePlugin', 'plugin-cost' -> 'PluginCost'
        const className = module.id
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join('');
        
        const schemaUrl = `${base}/static/js/plugins/${className}.schema.json`;
        try {
          const res = await fetch(schemaUrl);
          if (res.ok) {
            const schemaData = await res.json();
            if (schemaData.schema && schemaData.defaultConfig) {
              schemas[module.id] = {
                schema: schemaData.schema,
                defaultConfig: schemaData.defaultConfig
              };
            }
          }
        } catch (err) {
          // Plugin has no schema file — skip it
          console.debug(`No schema for ${module.id} at ${schemaUrl}:`, err.message);
        }
      }
      
      return schemas;
    } catch (err) {
      console.warn('AdminPlugins:_discoverPluginSchemas failed:', err);
      return {};
    }
  }

  /**
   * Fetch modules.config.json from the main app's static path.
   * Uses APP_BASE_URL so sub-path deployments resolve correctly.
   * @returns {Promise<object[]>}
   */
  async _fetchMetadata() {
    try {
      const base = window.APP_BASE_URL || '';
      const res = await fetch(`${base}/static/js/modules.config.json`);
      if (!res.ok) return [];
      const j = await res.json();
      return Array.isArray(j.modules) ? j.modules : [];
    } catch (err) {
      console.error('AdminPlugins:_fetchMetadata', err);
      return [];
    }
  }

  /**
   * Merge static metadata with persisted runtime config to produce editable rows.
   * Order follows the persisted config order when available.
   * @param {object[]} meta - modules from modules.config.json
   * @param {object|object[]|null} runtime - persisted plugin config from backend
   *   (can be { schema_version, plugins: [...] } object or legacy array)
   * @returns {object[]}
   */
  _mergeConfig(meta, runtime) {
    // Handle both new structure { schema_version, plugins } and legacy array format
    let runtimePlugins = null;
    if (runtime && typeof runtime === 'object') {
      if (Array.isArray(runtime)) {
        runtimePlugins = runtime;
      } else if (runtime.plugins && Array.isArray(runtime.plugins)) {
        runtimePlugins = runtime.plugins;
      }
    }

    const runtimeMap = new Map();
    if (Array.isArray(runtimePlugins)) {
      runtimePlugins.forEach((r, idx) => {
        if (r.id) runtimeMap.set(r.id, { ...r, _runtimeOrder: idx });
      });
    }

    // Build rows in persisted order, then append any meta entries not in runtime
    const ordered = [];
    const metaById = new Map();
    meta.forEach((m) => {
      if (m.id) metaById.set(m.id, m);
    });

    // First pass: runtime order (only valid ids)
    if (Array.isArray(runtimePlugins)) {
      runtimePlugins.forEach((r) => {
        if (!r.id) return;
        const m = metaById.get(r.id);
        if (!m) return; // id in runtime but not in metadata — skip
        ordered.push(this._buildRow(m, r));
      });
    }

    // Second pass: metadata entries not yet in ordered list
    meta.forEach((m) => {
      if (!m.id) {
        // Missing id entry — include for validation display purposes
        ordered.push(this._buildRow(m, null));
        return;
      }
      if (!ordered.find((row) => row.id === m.id)) {
        const r = runtimeMap.get(m.id) || null;
        ordered.push(this._buildRow(m, r));
      }
    });

    return ordered;
  }

  /**
   * Build a single editable row by merging metadata and runtime config.
   * @param {object} meta
   * @param {object|null} runtime
   * @returns {object}
   */
  _buildRow(meta, runtime) {
    return {
      // read-only metadata
      id: meta.id || null,
      name: meta.name || '',
      version: meta.version || '',
      description: meta.description || '',
      mountPoint: meta.mountPoint || '',
      dependencies: meta.dependencies || [],
      exclusive: meta.exclusive || false,
      // editable runtime state (fallback to metadata defaults)
      enabled: runtime ? Boolean(runtime.enabled) : Boolean(meta.enabled),
      activated: runtime ? Boolean(runtime.activated) : Boolean(meta.activated),
      custom_config: runtime && runtime.custom_config ? { ...runtime.custom_config } : {},
      // internal
      _metaOnly: runtime === null,
    };
  }

  /**
   * Detect validation errors that would block save.
   * @param {object[]} meta
   * @returns {string[]}
   */
  _detectValidationErrors(meta) {
    const errors = [];
    meta.forEach((m, i) => {
      if (!m.id) {
        errors.push(`Entry at index ${i} (name: "${m.name || 'unknown'}") is missing an id.`);
      }
    });
    return errors;
  }

  _onToggleEnabled(rowIndex) {
    const rows = [...this._rows];
    const row = { ...rows[rowIndex] };
    row.enabled = !row.enabled;
    if (!row.enabled) {
      row.activated = false;
    }
    rows[rowIndex] = row;
    this._rows = rows;
  }

  _onSelectActivated(rowIndex) {
    // Only one plugin can be activated at a time
    this._rows = this._rows.map((row, i) => ({
      ...row,
      activated: i === rowIndex ? !row.activated : false,
    }));
    // If we just activated, ensure enabled is true
    const target = this._rows[rowIndex];
    if (target.activated && !target.enabled) {
      const rows = [...this._rows];
      rows[rowIndex] = { ...rows[rowIndex], enabled: true };
      this._rows = rows;
    }
  }

  _onMoveUp(rowIndex) {
    if (rowIndex === 0) return;
    const rows = [...this._rows];
    [rows[rowIndex - 1], rows[rowIndex]] = [rows[rowIndex], rows[rowIndex - 1]];
    this._rows = rows;
  }

  _onMoveDown(rowIndex) {
    if (rowIndex >= this._rows.length - 1) return;
    const rows = [...this._rows];
    [rows[rowIndex], rows[rowIndex + 1]] = [rows[rowIndex + 1], rows[rowIndex]];
    this._rows = rows;
  }

  _hasValidationErrors() {
    return this._validationErrors.length > 0;
  }

  /**
   * Validate custom_config values against plugin schemas.
   * @returns {string[]} Array of validation error messages
   */
  _validateCustomConfigs() {
    const errors = [];
    for (const row of this._rows) {
      if (!row.id) continue;
      const schemaInfo = getPluginSchema(row.id, this._schemas);
      if (!schemaInfo) continue; // No schema, no validation needed

      // Basic validation: check required fields
      const schema = schemaInfo.schema;
      if (schema.required && Array.isArray(schema.required)) {
        for (const requiredField of schema.required) {
          if (!(requiredField in row.custom_config)) {
            errors.push(
              `${row.name}: missing required field "${requiredField}"`
            );
          }
        }
      }
    }
    return errors;
  }

  _onCustomConfigChange(rowIndex, value) {
    if (rowIndex < 0 || rowIndex >= this._rows.length) return;
    const rows = [...this._rows];
    rows[rowIndex].custom_config = value || {};
    this._rows = rows;
  }

  async _onSave() {
    if (this._hasValidationErrors()) return;

    // Validate custom_config against schemas
    const configErrors = this._validateCustomConfigs();
    if (configErrors.length > 0) {
      this._statusMsg = `Config validation failed: ${configErrors.join('; ')}`;
      this._statusType = 'error';
      this.requestUpdate();
      return;
    }

    this._saving = true;
    this._statusMsg = '';
    this.requestUpdate();

    // Build payload: wrap in object with schema_version and plugins array
    // (backend expects { schema_version, plugins: [...] })
    const content = {
      schema_version: 1,
      plugins: this._rows
        .filter((r) => r.id)
        .map((r) => ({
          id: r.id,
          enabled: r.enabled,
          activated: r.activated,
          custom_config: r.custom_config || {},
        })),
    };

    const result = await adminProvider.savePluginsConfig(content);
    this._saving = false;

    if (result && result.ok) {
      this._statusMsg = 'Saved successfully.';
      this._statusType = 'ok';
    } else {
      this._statusMsg = `Save failed: ${(result && result.error) || 'unknown error'}`;
      this._statusType = 'error';
    }
    this.requestUpdate();
  }

  async _onReload() {
    await this._load();
  }

  _onEditConfig(rowIndex) {
    if (rowIndex < 0 || rowIndex >= this._rows.length) return;
    const row = this._rows[rowIndex];
    this._editingConfigIndex = rowIndex;
    this._configEditorValue = JSON.stringify(row.custom_config || {}, null, 2);
    this.requestUpdate();
  }

  _onCloseConfigEditor() {
    this._editingConfigIndex = -1;
    this._configEditorValue = '';
    this.requestUpdate();
  }

  _onSaveConfigEditor() {
    if (this._editingConfigIndex < 0) return;
    try {
      const newConfig = JSON.parse(this._configEditorValue);
      this._onCustomConfigChange(this._editingConfigIndex, newConfig);
      this._onCloseConfigEditor();
    } catch (err) {
      alert(`Invalid JSON: ${err.message}`);
    }
  }

  _onConfigEditorInput(e) {
    this._configEditorValue = e.target.value;
  }

  _renderValidationErrors() {
    if (!this._hasValidationErrors()) return '';
    return html`
      <div class="validation-errors">
        <strong>Validation errors — save is blocked until resolved:</strong>
        <ul>
          ${this._validationErrors.map((e) => html`<li>${e}</li>`)}
        </ul>
      </div>
    `;
  }

  _renderStatus() {
    if (!this._statusMsg) return '';
    return html`<div class="status ${this._statusType}">${this._statusMsg}</div>`;
  }

  _renderConfigEditor() {
    if (this._editingConfigIndex < 0) return '';
    const row = this._rows[this._editingConfigIndex];
    const schemaInfo = getPluginSchema(row.id, this._schemas);
    const schema = schemaInfo?.schema || {};

    return html`
      <div class="modal-overlay" @click=${(e) => {
        if (e.target === e.currentTarget) this._onCloseConfigEditor();
      }}>
        <div class="modal">
          <h3 class="modal-header">Configure: ${row.name}</h3>
          <div class="modal-body">
            ${schema.description
              ? html`<p style="font-size: 0.9rem; color: #6b7280; margin-bottom: 12px;">
                  ${schema.description}
                </p>`
              : ''}
            <div class="modal-field">
              <label class="modal-label">Configuration (JSON)</label>
              <textarea
                class="modal-textarea"
                .value=${this._configEditorValue}
                @input=${(e) => this._onConfigEditorInput(e)}
              ></textarea>
            </div>
            ${schema.properties
              ? html`<div style="font-size: 0.8rem; color: #6b7280; margin-top: 12px;">
                  <strong>Schema fields:</strong>
                  <ul style="margin: 4px 0 0; padding-left: 18px;">
                    ${Object.entries(schema.properties).map(
                      ([key, prop]) => html`
                        <li>
                          <code>${key}</code>:
                          ${prop.type} ${prop.description ? `— ${prop.description}` : ''}
                        </li>
                      `
                    )}
                  </ul>
                </div>`
              : ''}
          </div>
          <div class="modal-actions">
            <button class="btn-modal btn-modal-cancel" @click=${() => this._onCloseConfigEditor()}>
              Cancel
            </button>
            <button class="btn-modal btn-modal-save" @click=${() => this._onSaveConfigEditor()}>
              Save
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _renderRow(row, index) {
    const isInvalid = !row.id;
    const rowClass = isInvalid ? 'invalid-row' : !row.enabled ? 'disabled-row' : '';
    const isLast = index === this._rows.length - 1;
    const hasSchema = row.id && hasPluginSchema(row.id, this._schemas);

    return html`
      <tr class=${rowClass}>
        <td class="td-name">
          ${row.name}
          ${isInvalid ? html`<span class="missing-id-badge">missing id</span>` : ''}
        </td>
        <td class="td-version">${row.version}</td>
        <td class="td-desc">${row.description}</td>
        <td class="toggle-cell">
          <label class="toggle" title="Toggle enabled">
            <input
              type="checkbox"
              .checked=${row.enabled}
              ?disabled=${isInvalid}
              @change=${() => this._onToggleEnabled(index)}
            />
            <span class="slider"></span>
          </label>
        </td>
        <td class="radio-cell">
          <input
            type="radio"
            name="activated"
            .checked=${row.activated}
            ?disabled=${isInvalid || !row.enabled}
            @change=${() => this._onSelectActivated(index)}
            title="Set as activated plugin"
          />
        </td>
        <td class="order-cell">
          ${hasSchema
            ? html`<button
                class="config-btn"
                ?disabled=${isInvalid}
                @click=${() => this._onEditConfig(index)}
                title="Edit plugin configuration"
              >
                Config
              </button>`
            : ''}
          <button
            class="order-btn"
            ?disabled=${index === 0}
            @click=${() => this._onMoveUp(index)}
            title="Move up"
          >
            ▲
          </button>
          <button
            class="order-btn"
            ?disabled=${isLast}
            @click=${() => this._onMoveDown(index)}
            title="Move down"
          >
            ▼
          </button>
        </td>
      </tr>
    `;
  }

  render() {
    if (this._loading) {
      return html`<div class="loading-msg">Loading plugins…</div>`;
    }

    return html`
      <h2>Plugins</h2>
      <div class="panel">
        <p class="hint">
          Manage plugin runtime settings. Metadata (id, name, version, etc.) is read-only and comes
          from <code>modules.config.json</code>. Use enabled/activated/order to control runtime
          behaviour. Click "Config" to edit custom settings for plugins.
        </p>
        ${this._renderValidationErrors()}
        ${this._renderStatus()}
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Description</th>
              <th>Enabled</th>
              <th>Activated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this._rows.map((row, i) => this._renderRow(row, i))}
          </tbody>
        </table>
        <div class="action-bar">
          <button
            class="btn-save"
            ?disabled=${this._saving || this._hasValidationErrors()}
            @click=${this._onSave}
          >
            ${this._saving ? 'Saving…' : 'Save'}
          </button>
          <button class="btn-reload" ?disabled=${this._loading} @click=${this._onReload}>
            Reload
          </button>
        </div>
      </div>
      ${this._renderConfigEditor()}
    `;
  }
}

customElements.define('admin-plugins', AdminPlugins);
