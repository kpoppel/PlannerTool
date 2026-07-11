import { LitElement, html, css } from '/static/js/vendor/lit.js';

/**
 * SchemaForm - A generic form generator from JSON Schema
 *
 * Takes a JSON Schema and data, generates an intuitive form UI with validation.
 * Supports nested objects, arrays, enums, and various primitive types.
 */
export class SchemaForm extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .form-container {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }

    /* 2-column layout for medium screens */
    @media (min-width: 768px) {
      .form-container {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    /* 3-column layout for large screens */
    @media (min-width: 1200px) {
      .form-container {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .field-group.nested {
      padding-left: 20px;
      border-left: 3px solid #e5e7eb;
    }

    /* Full width for object and array fields */
    .field-group.full-width {
      grid-column: 1 / -1;
    }

    label {
      font-weight: 600;
      font-size: 0.9rem;
      color: #374151;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    label .required {
      color: #ef4444;
    }

    .field-description {
      font-size: 0.85rem;
      color: #6b7280;
      margin-top: -4px;
      margin-bottom: 4px;
    }

    input[type='text'],
    input[type='number'],
    select,
    textarea {
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.9rem;
      font-family: inherit;
      transition: border-color 0.2s;
      background: #fff;
    }

    input[readonly],
    select[disabled],
    textarea[readonly] {
      background: #f3f4f6;
      color: #6b7280;
      cursor: not-allowed;
    }

    input[type='text']:focus,
    input[type='number']:focus,
    select:focus,
    textarea:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .object-section {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 16px;
      background: #f9fafb;
      grid-column: 1 / -1;
    }
    input[type='checkbox'] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }

    .checkbox-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .error-message {
      color: #ef4444;
      font-size: 0.85rem;
      margin-top: 4px;
    }

    .object-title {
      font-size: 1rem;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e5e7eb;
    }

    .array-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .array-item {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 12px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }

    .array-item-content {
      flex: 1;
    }

    .array-controls {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }

    .btn {
      padding: 6px 12px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.2s;
    }

    .btn:hover {
      background: #f3f4f6;
      border-color: #9ca3af;
    }

    .btn-danger {
      color: #ef4444;
      border-color: #fecaca;
    }

    .btn-danger:hover {
      background: #fef2f2;
      border-color: #ef4444;
    }

    .btn-primary {
      background: #3b82f6;
      color: #fff;
      border-color: #3b82f6;
    }

    .btn-primary:hover {
      background: #2563eb;
      border-color: #2563eb;
    }

    .btn-small {
      padding: 4px 8px;
      font-size: 0.8rem;
    }

    .pattern-properties-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .pattern-property-item {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 12px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }

    .pattern-property-key {
      min-width: 150px;
      font-weight: 600;
    }
    .drag-handle {
      width: 36px;
      text-align: center;
      cursor: grab;
      user-select: none;
      font-size: 16px;
      color: #9ca3af;
      margin-right: 8px;
      flex-shrink: 0;
    }

    .array-item.dragging {
      opacity: 0.5;
    }

    .array-item.drag-over {
      outline: 2px dashed #3b82f6;
      background: #f3f9ff;
    }
  `;

  static properties = {
    schema: { type: Object },
    data: { type: Object },
    errors: { type: Object },
  };

  constructor() {
    super();
    this.schema = null;
    this.data = {};
    this.errors = {};
  }

  /**
   * Validate the current data against the schema
   */
  validate() {
    this.errors = {};
    if (!this.schema) return true;

    const validateValue = (schema, value, path) => {
      // Check required
      if (schema.required && schema.required.length) {
        for (const req of schema.required) {
          if (value == null || value[req] == null || value[req] === '') {
            this.errors[`${path}.${req}`] =
              `${schema.properties?.[req]?.title || req} is required`;
          }
        }
      }

      // Type validation
      if (schema.type) {
        if (schema.type === 'string' && typeof value === 'string') {
          if (schema.minLength && value.length < schema.minLength) {
            this.errors[path] = `Minimum length is ${schema.minLength}`;
          }
        } else if (schema.type === 'number' || schema.type === 'integer') {
          const num = Number(value);
          if (isNaN(num)) {
            this.errors[path] = 'Must be a valid number';
          } else if (schema.minimum != null && num < schema.minimum) {
            this.errors[path] = `Minimum value is ${schema.minimum}`;
          }
        } else if (schema.type === 'array' && Array.isArray(value)) {
          if (schema.items) {
            value.forEach((item, idx) => {
              validateValue(schema.items, item, `${path}[${idx}]`);
            });
          }
        } else if (schema.type === 'object' && typeof value === 'object') {
          if (schema.properties) {
            Object.keys(schema.properties).forEach((key) => {
              if (value[key] != null) {
                validateValue(schema.properties[key], value[key], `${path}.${key}`);
              }
            });
          }
        }
      }
    };

    validateValue(this.schema, this.data, 'root');
    this.requestUpdate();
    return Object.keys(this.errors).length === 0;
  }

  /**
   * Get the current form data
   */
  getData() {
    return this.data;
  }

  _getPathSegments(path) {
    if (!path) return [];
    const tokens = path.match(/[^.[\]]+|\[(\d+)\]/g) || [];
    return tokens.map((token) =>
      token.startsWith('[') ? Number(token.slice(1, -1)) : token
    );
  }

  _getByPath(path) {
    let obj = this.data;
    for (const segment of this._getPathSegments(path)) {
      if (obj == null) return null;
      obj = obj[segment];
    }
    return obj;
  }

  _setByPath(path, value) {
    const parts = this._getPathSegments(path);
    if (parts.length === 0) {
      this.data = value;
      return;
    }
    let obj = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (obj[part] == null) {
        obj[part] = typeof parts[i + 1] === 'number' ? [] : {};
      }
      obj = obj[part];
    }
    obj[parts[parts.length - 1]] = value;
  }

  _renderFieldGroup({ content, label = '', description = '', errorMsg = '' }) {
    return html`
      <div class="field-group">
        ${label} ${description}
        ${content}
        ${errorMsg}
      </div>
    `;
  }

  /**
   * Update a value in the data object
   */
  _updateValue(path, value) {
    this._setByPath(path, value);

    this.requestUpdate();
    this._dispatchChange();
  }

  _dispatchChange() {
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: this.data,
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Render a field based on its schema
   */
  _renderField(key, schema, value, path = '') {
    const fullPath = path ? `${path}.${key}` : key;
    const error = this.errors[fullPath];
    const isReadOnly = schema.readOnly === true;
    const isRequired = this.schema?.required?.includes(key);

    // Fall back to schema default when no value is stored yet
    if (value === undefined || value === null) {
      if (schema.default !== undefined) {
        value = schema.default;
      }
    }

    const label = html`
      <label>
        ${schema.title || key} ${isRequired ? html`<span class="required">*</span>` : ''}
      </label>
    `;

    const description =
      schema.description ?
        html`<div class="field-description">${schema.description}</div>`
      : '';

    const errorMsg = error ? html`<div class="error-message">${error}</div>` : '';
    // Boolean checkbox
    if (schema.type === 'boolean') {
      return this._renderFieldGroup({
        content: html`
          <div class="checkbox-wrapper">
            <input
              type="checkbox"
              .checked=${!!value}
              @change=${(e) => this._updateValue(fullPath, e.target.checked)}
            />
            ${label}
          </div>
        `,
        description,
      });
    }

    // Enum/select
    if (schema.enum) {
      return this._renderFieldGroup({
        label,
        description,
        errorMsg,
        content: html`
          <select
            .value=${value || schema.default || ''}
            @change=${(e) => this._updateValue(fullPath, e.target.value)}
            class=${error ? 'error' : ''}
          >
            <option value="">-- Select --</option>
            ${schema.enum.map(
              (opt) => html`
                <option value=${opt} ?selected=${value === opt}>${opt}</option>
              `
            )}
          </select>
        `,
      });
    }

    // Number/integer
    if (schema.type === 'number' || schema.type === 'integer') {
      return this._renderFieldGroup({
        label,
        description,
        errorMsg,
        content: html`
          <input
            type="number"
            .value=${value != null ? String(value) : ''}
            ?readonly=${isReadOnly}
            @input=${(e) => {
              if (isReadOnly) return;
              const val =
                schema.type === 'integer' ?
                  parseInt(e.target.value, 10)
                : parseFloat(e.target.value);
              this._updateValue(fullPath, isNaN(val) ? null : val);
            }}
            class=${error ? 'error' : ''}
          />
        `,
      });
    }

    // String
    if (schema.type === 'string') {
      return this._renderFieldGroup({
        label,
        description,
        errorMsg,
        content: html`
          <input
            type="text"
            .value=${value || ''}
            ?readonly=${isReadOnly}
            @input=${(e) => {
              if (isReadOnly) return;
              this._updateValue(fullPath, e.target.value);
            }}
            class=${error ? 'error' : ''}
          />
        `,
      });
    }

    // Object - full width
    if (schema.type === 'object') {
      return this._renderObject(key, schema, value || {}, fullPath);
    }

    // Array - full width
    if (schema.type === 'array') {
      return this._renderArray(key, schema, value || [], fullPath);
    }

    return html`<div class="field-group">Unsupported type: ${schema.type}</div>`;
  }

  /**
   * Render an object field with nested properties
   */
  _renderObject(key, schema, value, path) {
    if (!value || typeof value !== 'object') {
      value = {};
    }

    // Handle patternProperties (dynamic keys)
    if (schema.patternProperties) {
      return this._renderPatternProperties(key, schema, value, path);
    }

    if (!schema.properties) {
      return html`
        <div class="object-section">
          <div class="object-title">${schema.title || key}</div>
        </div>
      `;
    }

    // Exclude dependent properties (x-showWhen) — those are rendered at root level
    const visibleKeys = Object.keys(schema.properties).filter(
      (k) => !schema.properties[k]['x-showWhen']
    );

    return html`
      <div class="object-section">
        <div class="object-title">${schema.title || key}</div>
        ${schema.description ?
          html`<div class="field-description">${schema.description}</div>`
        : ''}
        <div class="form-container">
          ${visibleKeys.map((propKey) =>
            this._renderField(propKey, schema.properties[propKey], value[propKey], path)
          )}
        </div>
      </div>
    `;
  }

  /**
   * Resolve a dotted/bracket path (e.g. "parent[0].children") against this.data
   */
  _getValueByBracketPath(path) {
    if (!path) return this.data;
    return this._getByPath(path);
  }

  _onArrayDragStart(e) {
    const el = e.currentTarget;
    const idx = Number(el.dataset.index);
    const path = el.dataset.arrayPath;
    this._dragArraySrc = { path, index: idx };
    try {
      e.dataTransfer.setData('text/plain', String(idx));
      e.dataTransfer.effectAllowed = 'move';
    } catch (err) {
      // ignore
    }
    el.classList.add('dragging');
  }

  _onArrayDragEnter(e) {
    e.preventDefault();
    const el = e.currentTarget;
    el.classList.add('drag-over');
  }

  _onArrayDragLeave(e) {
    const el = e.currentTarget;
    el.classList.remove('drag-over');
  }

  _onArrayDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  _onArrayDrop(e) {
    e.preventDefault();
    const el = e.currentTarget;
    const tgt = Number(el.dataset.index);
    const src = Number(e.dataTransfer?.getData('text/plain') ?? this._dragArraySrc?.index);
    const path = el.dataset.arrayPath;
    this._array_performReorder(path, src, tgt);
    el.classList.remove('drag-over');
    const dragging = this.shadowRoot?.querySelectorAll?.('.array-item.dragging');
    if (dragging) dragging.forEach((r) => r.classList.remove('dragging'));
    delete this._dragArraySrc;
    this.requestUpdate();
  }

  _onArrayDragEnd(/*e*/) {
    const dragging = this.shadowRoot?.querySelectorAll?.('.array-item.dragging');
    if (dragging) dragging.forEach((r) => r.classList.remove('dragging'));
    delete this._dragArraySrc;
    this.requestUpdate();
  }

  _array_performReorder(path, sourceIndex, targetIndex) {
    if (!Number.isFinite(sourceIndex) || !Number.isFinite(targetIndex)) return;
    if (sourceIndex === targetIndex) return;
    const arr = this._getValueByBracketPath(path) || [];
    if (!Array.isArray(arr)) return;
    const newArr = [...arr];
    if (sourceIndex < 0 || sourceIndex >= newArr.length) return;
    if (targetIndex < 0 || targetIndex >= newArr.length) return;
    const [item] = newArr.splice(sourceIndex, 1);
    let insertIndex = targetIndex;
    if (sourceIndex < targetIndex) insertIndex = targetIndex - 1;
    if (insertIndex < 0) insertIndex = 0;
    newArr.splice(insertIndex, 0, item);
    this._updateValue(path, newArr);
  }
  /**
   * Render patternProperties (dynamic object keys)
   */
  _renderPatternProperties(key, schema, value, path) {
    const existingKeys = Object.keys(value || {});
    const patternKey = Object.keys(schema.patternProperties)[0];
    const itemSchema = schema.patternProperties[patternKey];

    const addItem = () => {
      const newKey = prompt(`Enter new ${schema.title || key} key:`);
      if (!newKey) return;
      if (value[newKey] !== undefined) {
        alert('Key already exists!');
        return;
      }
      this._updateValue(path, {
        ...(value || {}),
        [newKey]: this._getDefaultValue(itemSchema),
      });
    };

    const removeItem = (itemKey) => {
      if (confirm(`Remove ${itemKey}?`)) {
        const next = { ...(value || {}) };
        delete next[itemKey];
        this._updateValue(path, next);
      }
    };

    return html`
      <div class="field-group full-width">
        <div class="object-section">
          <div class="object-title">${schema.title || key}</div>
          ${schema.description ?
            html`<div class="field-description">${schema.description}</div>`
          : ''}
          <div class="pattern-properties-container">
            ${existingKeys.map(
              (itemKey) => html`
                <div class="pattern-property-item">
                  <div class="pattern-property-key">${itemKey}</div>
                  <div style="flex: 1;">
                    ${this._renderPatternPropertyValue(
                      itemSchema,
                      value[itemKey],
                      `${path}.${itemKey}`
                    )}
                  </div>
                  <button
                    class="btn btn-danger btn-small"
                    @click=${() => removeItem(itemKey)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              `
            )}
          </div>
          <div class="array-controls">
            <button class="btn btn-primary btn-small" @click=${addItem} type="button">
              + Add ${itemSchema.title || 'Item'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render value for a pattern property item
   */
  _renderPatternPropertyValue(schema, value, path) {
    // If the schema is an object with properties, render them
    if (schema.type === 'object' && schema.properties) {
      return html`
        <div class="form-container">
          ${Object.keys(schema.properties).map((propKey) =>
            this._renderField(propKey, schema.properties[propKey], value?.[propKey], path)
          )}
        </div>
      `;
    }

    // For primitive types, render inline input
    if (schema.type === 'number' || schema.type === 'integer') {
      return html`
        <input
          type="number"
          .value=${value != null ? String(value) : ''}
          @input=${(e) => {
            const val =
              schema.type === 'integer' ?
                parseInt(e.target.value, 10)
              : parseFloat(e.target.value);
            this._updateValue(path, isNaN(val) ? null : val);
          }}
          style="width: 100%;"
        />
      `;
    }

    if (schema.type === 'string') {
      return html`
        <input
          type="text"
          .value=${value || ''}
          @input=${(e) => this._updateValue(path, e.target.value)}
          style="width: 100%;"
        />
      `;
    }

    return html`<div>Unsupported pattern property type: ${schema.type}</div>`;
  }

  /**
   * Render an array field with add/remove controls
   */
  _renderArray(key, schema, value, path) {
    if (!Array.isArray(value)) {
      value = [];
    }

    const addItem = () => {
      const newItem = this._getDefaultValue(schema.items);
      this._updateValue(path, [...value, newItem]);
    };

    const removeItem = (idx) => {
      this._updateValue(
        path,
        value.filter((_, index) => index !== idx)
      );
    };

    return html`
      <div class="field-group full-width">
        <label>${schema.title || key}</label>
        ${schema.description ?
          html`<div class="field-description">${schema.description}</div>`
        : ''}
        <div class="array-container">
          ${value.map(
            (item, idx) => html`
              <div class="array-item"
                draggable="true"
                data-index="${idx}"
                data-array-path="${path}"
                @dragstart=${(e) => this._onArrayDragStart(e)}
                @dragenter=${(e) => this._onArrayDragEnter(e)}
                @dragleave=${(e) => this._onArrayDragLeave(e)}
                @dragover=${(e) => this._onArrayDragOver(e)}
                @drop=${(e) => this._onArrayDrop(e)}
                @dragend=${(e) => this._onArrayDragEnd(e)}>
                <div class="drag-handle">☰</div>
                <div class="array-item-content" style="flex:1">
                  ${this._renderArrayItem(schema.items, item, `${path}[${idx}]`)}
                </div>
                <button
                  class="btn btn-danger btn-small"
                  @click=${() => removeItem(idx)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            `
          )}
        </div>
        <div class="array-controls">
          <button class="btn btn-primary btn-small" @click=${addItem} type="button">
            + Add ${schema.items?.title || 'Item'}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render a single array item
   */
  _renderArrayItem(itemSchema, value, path) {
    if (!itemSchema) return '';

    // For primitive types in arrays
    if (itemSchema.type === 'string') {
      if (itemSchema.enum) {
        return html`
          <select
            .value=${value || ''}
            @change=${(e) => this._updateValue(path, e.target.value)}
          >
            <option value="">-- Select --</option>
            ${itemSchema.enum.map(
              (opt) => html`
                <option value=${opt} ?selected=${value === opt}>${opt}</option>
              `
            )}
          </select>
        `;
      }
      return html`
        <input
          type="text"
          .value=${value || ''}
          @input=${(e) => this._updateValue(path, e.target.value)}
        />
      `;
    }

    // For object types in arrays
    if (itemSchema.type === 'object' && itemSchema.properties) {
      return html`
        <div class="form-container">
          ${Object.keys(itemSchema.properties).map((propKey) => {
            const propValue = value?.[propKey];
            return this._renderField(
              propKey,
              itemSchema.properties[propKey],
              propValue,
              path
            );
          })}
        </div>
      `;
    }

    return html`<div>Unsupported array item type</div>`;
  }

  /**
   * Get default value for a schema
   */
  _getDefaultValue(schema) {
    if (!schema) return null;
    if (schema.default !== undefined) return schema.default;

    switch (schema.type) {
      case 'string':
        return '';
      case 'number':
      case 'integer':
        return 0;
      case 'boolean':
        return false;
      case 'array':
        return [];
      case 'object': {
        const obj = {};
        if (schema.properties) {
          Object.keys(schema.properties).forEach((key) => {
            obj[key] = this._getDefaultValue(schema.properties[key]);
          });
        }
        return obj;
      }
      default:
        return null;
    }
  }

  render() {
    if (!this.schema) {
      return html`<div>No schema provided</div>`;
    }

    /**
     * Resolve a dotted path (e.g. "feature_flags.enable_memory_cache") against
     * this.data, returning the value or undefined.
     */
    const resolveFlag = (flagPath) => this._getByPath(flagPath);

    // Collect conditional panels bubbled up from nested objects (x-showWhen).
    // These are rendered as peer sections at root level, matching the style of
    // sibling object properties like memory_cache.
    const conditionalPanels = [];
    if (this.schema.properties) {
      for (const [parentKey, parentSchema] of Object.entries(this.schema.properties)) {
        if (parentSchema.type !== 'object' || !parentSchema.properties) continue;
        const parentValue = this.data[parentKey] || {};

        // Group dependent sub-properties by their controlling flag
        const byFlag = {};
        for (const [subKey, subSchema] of Object.entries(parentSchema.properties)) {
          const flagKey = subSchema['x-showWhen'];
          if (!flagKey) continue;
          if (!byFlag[flagKey]) byFlag[flagKey] = [];
          byFlag[flagKey].push({ subKey, subSchema });
        }

        for (const [flagKey, entries] of Object.entries(byFlag)) {
          if (!parentValue[flagKey]) continue;
          const flagTitle = parentSchema.properties[flagKey]?.title || flagKey;
          const parentPath = parentKey;
          conditionalPanels.push(html`
            <div class="object-section">
              <div class="object-title">${flagTitle} — Options</div>
              <div class="form-container">
                ${entries.map(({ subKey, subSchema }) =>
                  this._renderField(subKey, subSchema, parentValue[subKey], parentPath)
                )}
              </div>
            </div>
          `);
        }
      }
    }

    // Render root level properties, skipping those whose x-showWhen condition
    // is not satisfied (dotted path resolved against this.data).
    return html`
      <div class="form-container">
        ${this.schema.properties ?
          Object.keys(this.schema.properties).map((key) => {
            const propSchema = this.schema.properties[key];
            const showWhen = propSchema['x-showWhen'];
            if (showWhen && !resolveFlag(showWhen)) return '';
            return this._renderField(key, propSchema, this.data[key]);
          })
        : html`<div>No properties defined in schema</div>`}
        ${conditionalPanels}
      </div>
    `;
  }
}

customElements.define('schema-form', SchemaForm);
