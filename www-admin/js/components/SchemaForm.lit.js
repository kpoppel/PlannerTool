import { LitElement, html, css } from '/static/js/vendor/lit.js';

/**
 * SchemaForm - A generic form generator from JSON Schema
 * 
 * Takes a JSON Schema and data, generates an intuitive form UI with validation.
 * Supports nested objects, arrays, enums, and various primitive types.
 */
export class SchemaForm extends LitElement {
  static styles = css`
    :host { display: block; }
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
    
    .field-group { display: flex; flex-direction: column; gap: 8px; }
    .field-group.nested { padding-left: 20px; border-left: 3px solid #e5e7eb; }
    
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
    label .required { color: #ef4444; }
    
    .field-description { 
      font-size: 0.85rem; 
      color: #6b7280; 
      margin-top: -4px; 
      margin-bottom: 4px;
    }
    
    input[type="text"],
    input[type="number"],
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
    
    input[type="text"]:focus,
    input[type="number"]:focus,
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
    input[type="checkbox"] {
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
    
    .object-section {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 16px;
      background: #f9fafb;
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
  `;

  static properties = {
    schema: { type: Object },
    data: { type: Object },
    errors: { type: Object }
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
            this.errors[`${path}.${req}`] = `${schema.properties?.[req]?.title || req} is required`;
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
            Object.keys(schema.properties).forEach(key => {
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

  /**
   * Update a value in the data object
   */
  _updateValue(path, value) {
    // Handle array notation in path like "team_map[0].name"
    const parts = [];
    const pathStr = path;
    let current = '';
    let i = 0;
    
    while (i < pathStr.length) {
      const char = pathStr[i];
      if (char === '[') {
        if (current) {
          parts.push({ type: 'property', value: current });
          current = '';
        }
        i++;
        let indexStr = '';
        while (i < pathStr.length && pathStr[i] !== ']') {
          indexStr += pathStr[i];
          i++;
        }
        parts.push({ type: 'index', value: parseInt(indexStr, 10) });
        i++; // skip ']'
        if (i < pathStr.length && pathStr[i] === '.') {
          i++; // skip '.'
        }
      } else if (char === '.') {
        if (current) {
          parts.push({ type: 'property', value: current });
          current = '';
        }
        i++;
      } else {
        current += char;
        i++;
      }
    }
    if (current) {
      parts.push({ type: 'property', value: current });
    }
    
    let obj = this.data;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part.type === 'property') {
        if (!obj[part.value]) {
          // Look ahead to see if next is an index
          if (i + 1 < parts.length && parts[i + 1].type === 'index') {
            obj[part.value] = [];
          } else {
            obj[part.value] = {};
          }
        }
        obj = obj[part.value];
      } else if (part.type === 'index') {
        if (!obj[part.value]) {
          obj[part.value] = {};
        }
        obj = obj[part.value];
      }
    }
    
    const lastPart = parts[parts.length - 1];
    if (lastPart.type === 'property') {
      obj[lastPart.value] = value;
    } else if (lastPart.type === 'index') {
      obj[lastPart.value] = value;
    }
    
    this.requestUpdate();
    this._dispatchChange();
  }

  _dispatchChange() {
    this.dispatchEvent(new CustomEvent('data-change', {
      detail: { data: this.data },
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Render a field based on its schema
   */
  _renderField(key, schema, value, path = '') {
    const fullPath = path ? `${path}.${key}` : key;
    const error = this.errors[fullPath];
    const isReadOnly = schema.readOnly === true;
    const isRequired = this.schema?.required?.includes(key);
    
    const label = html`
      <label>
        ${schema.title || key}
        ${isRequired ? html`<span class="required">*</span>` : ''}
      </label>
    `;
    
    const description = schema.description 
      ? html`<div class="field-description">${schema.description}</div>`
      : '';
    
    const errorMsg = error 
      ? html`<div class="error-message">${error}</div>`
      : '';
    // Boolean checkbox
    if (schema.type === 'boolean') {
      return html`
        <div class="field-group">
          <div class="checkbox-wrapper">
            <input 
              type="checkbox" 
              .checked=${!!value}
              @change=${(e) => this._updateValue(fullPath, e.target.checked)}
            />
            ${label}
          </div>
          ${description}
        </div>
      `;
    }

    // Enum/select
    if (schema.enum) {
      return html`
        <div class="field-group">
          ${label}
          ${description}
          <select 
            .value=${value || schema.default || ''}
            @change=${(e) => this._updateValue(fullPath, e.target.value)}
            class=${error ? 'error' : ''}
          >
            <option value="">-- Select --</option>
            ${schema.enum.map(opt => html`
              <option value=${opt} ?selected=${value === opt}>${opt}</option>
            `)}
          </select>
          ${errorMsg}
        </div>
      `;
    }

    // Number/integer
    if (schema.type === 'number' || schema.type === 'integer') {
      return html`
        <div class="field-group">
          ${label}
          ${description}
          <input 
            type="number"
            .value=${value != null ? String(value) : ''}
            ?readonly=${isReadOnly}
            @input=${(e) => {
              if (isReadOnly) return;
              const val = schema.type === 'integer' 
                ? parseInt(e.target.value, 10) 
                : parseFloat(e.target.value);
              this._updateValue(fullPath, isNaN(val) ? null : val);
            }}
            class=${error ? 'error' : ''}
          />
          ${errorMsg}
        </div>
      `;
    }

    // String
    if (schema.type === 'string') {
      return html`
        <div class="field-group">
          ${label}
          ${description}
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
          ${errorMsg}
        </div>
      `;
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

    return html`
      <div class="object-section">
        <div class="object-title">${schema.title || key}</div>
        ${schema.description ? html`<div class="field-description">${schema.description}</div>` : ''}
        <div class="form-container">
          ${schema.properties ? Object.keys(schema.properties).map(propKey => 
            this._renderField(propKey, schema.properties[propKey], value[propKey], path)
          ) : ''}
        </div>
      </div>
    `;
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
      value[newKey] = this._getDefaultValue(itemSchema);
      this._updateValue(path, value);
    };

    const removeItem = (itemKey) => {
      if (confirm(`Remove ${itemKey}?`)) {
        delete value[itemKey];
        this._updateValue(path, value);
      }
    };

    return html`
      <div class="field-group full-width">
        <div class="object-section">
          <div class="object-title">${schema.title || key}</div>
          ${schema.description ? html`<div class="field-description">${schema.description}</div>` : ''}
          <div class="pattern-properties-container">
            ${existingKeys.map(itemKey => html`
              <div class="pattern-property-item">
                <div class="pattern-property-key">
                  ${itemKey}
                </div>
                <div style="flex: 1;">
                  ${this._renderPatternPropertyValue(itemSchema, value[itemKey], `${path}.${itemKey}`)}
                </div>
                <button 
                  class="btn btn-danger btn-small" 
                  @click=${() => removeItem(itemKey)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            `)}
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
          ${Object.keys(schema.properties).map(propKey => 
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
            const val = schema.type === 'integer' 
              ? parseInt(e.target.value, 10) 
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
      value.push(newItem);
      this._updateValue(path, value);
    };

    const removeItem = (idx) => {
      value.splice(idx, 1);
      this._updateValue(path, value);
    };

    return html`
      <div class="field-group full-width">
        <label>${schema.title || key}</label>
        ${schema.description ? html`<div class="field-description">${schema.description}</div>` : ''}
        <div class="array-container">
          ${value.map((item, idx) => html`
            <div class="array-item">
              <div class="array-item-content">
                ${this._renderArrayItem(schema.items, item, `${path}[${idx}]`, idx)}
              </div>
              <button 
                class="btn btn-danger btn-small" 
                @click=${() => removeItem(idx)}
                type="button"
              >
                Remove
              </button>
            </div>
          `)}
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
  _renderArrayItem(itemSchema, value, path, idx) {
    if (!itemSchema) return '';

    // For primitive types in arrays
    if (itemSchema.type === 'string') {
      if (itemSchema.enum) {
        return html`
          <select 
            .value=${value || ''}
            @change=${(e) => {
              const pathParts = path.match(/([^\[]+)(?:\[(\d+)\])?/g);
              const arrayPath = pathParts[0].replace(/\[\d+\]$/, '');
              const arr = this._getValueByPath(arrayPath);
              arr[idx] = e.target.value;
              this._updateValue(arrayPath, arr);
            }}
          >
            <option value="">-- Select --</option>
            ${itemSchema.enum.map(opt => html`
              <option value=${opt} ?selected=${value === opt}>${opt}</option>
            `)}
          </select>
        `;
      }
      return html`
        <input 
          type="text"
          .value=${value || ''}
          @input=${(e) => {
            const pathParts = path.match(/([^\[]+)(?:\[(\d+)\])?/g);
            const arrayPath = pathParts[0].replace(/\[\d+\]$/, '');
            const arr = this._getValueByPath(arrayPath);
            arr[idx] = e.target.value;
            this._updateValue(arrayPath, arr);
          }}
        />
      `;
    }

    // For object types in arrays
    if (itemSchema.type === 'object' && itemSchema.properties) {
      return html`
        <div class="form-container">
          ${Object.keys(itemSchema.properties).map(propKey => {
            const propValue = value?.[propKey];
            return this._renderField(propKey, itemSchema.properties[propKey], propValue, path);
          })}
        </div>
      `;
    }

    return html`<div>Unsupported array item type</div>`;
  }

  /**
   * Get a value by path string
   */
  _getValueByPath(path) {
    const parts = path.split('.');
    let obj = this.data;
    for (const part of parts) {
      if (obj == null) return null;
      obj = obj[part];
    }
    return obj;
  }

  /**
   * Get default value for a schema
   */
  _getDefaultValue(schema) {
    if (!schema) return null;
    if (schema.default !== undefined) return schema.default;
    
    switch (schema.type) {
      case 'string': return '';
      case 'number':
      case 'integer': return 0;
      case 'boolean': return false;
      case 'array': return [];
      case 'object': {
        const obj = {};
        if (schema.properties) {
          Object.keys(schema.properties).forEach(key => {
            obj[key] = this._getDefaultValue(schema.properties[key]);
          });
        }
        return obj;
      }
      default: return null;
    }
  }

  render() {
    if (!this.schema) {
      return html`<div>No schema provided</div>`;
    }

    // Render root level properties
    return html`
      <div class="form-container">
        ${this.schema.properties ? Object.keys(this.schema.properties).map(key => 
          this._renderField(key, this.schema.properties[key], this.data[key])
        ) : html`<div>No properties defined in schema</div>`}
      </div>
    `;
  }
}

customElements.define('schema-form', SchemaForm);
