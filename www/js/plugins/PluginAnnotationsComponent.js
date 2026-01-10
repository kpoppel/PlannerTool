/**
 * PluginAnnotationsComponent.js
 * UI component for the Annotations plugin
 * Provides a floating toolbar for annotation tools
 */

import { LitElement, html, css } from '../vendor/lit.js';
import { TOOLS, TOOL_DEFINITIONS, getAnnotationState } from './annotations/AnnotationState.js';
import { ANNOTATION_COLORS } from './annotations/AnnotationColors.js';
import './annotations/AnnotationOverlay.js';

export class PluginAnnotationsComponent extends LitElement {
  static properties = { 
    visible: { type: Boolean },
    currentTool: { type: String },
    annotationCount: { type: Number }
  };
  
  constructor() { 
    super(); 
    this.visible = false;
    this.currentTool = TOOLS.SELECT;
    this.annotationCount = 0;
    this._annotationState = getAnnotationState();
    this._overlay = null;
    this._unsubscribe = null;
  }

  static styles = css`
    :host { 
      display: none;
      position: fixed;
      z-index: 100;
      pointer-events: none;
    }
    
    :host([visible]) {
      display: block;
    }

    /* Floating toolbar */
    .floating-toolbar {
      position: fixed;
      top: 80px;
      right: 20px;
      background: white;
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      pointer-events: auto;
      z-index: 200;
    }
    
    .toolbar-title {
      font-size: 12px;
      font-weight: 600;
      color: #666;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .row {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 8px;
    }
    
    .row:last-child {
      margin-bottom: 0;
    }
    
    button {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    
    button:hover {
      background: #f5f5f5;
      border-color: #ccc;
    }
    
    button.active {
      background: #E3F2FD;
      border-color: #2196F3;
      color: #1976D2;
    }
    
    button.danger {
      color: #d32f2f;
      border-color: #ffcdd2;
    }
    
    button.danger:hover {
      background: #ffebee;
    }
    
    .tool-btn {
      width: 36px;
      height: 36px;
      padding: 0;
      justify-content: center;
      font-size: 18px;
    }
    
    .color-swatch {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.1s ease;
    }
    
    .color-swatch:hover {
      transform: scale(1.1);
    }
    
    .color-swatch.selected {
      border-color: #333;
    }
    
    .annotation-count {
      font-size: 11px;
      background: #E3F2FD;
      color: #1976D2;
      padding: 2px 6px;
      border-radius: 10px;
      margin-left: 4px;
    }
    
    .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 16px;
      color: #999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .close-btn:hover {
      color: #333;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    
    // Subscribe to annotation state changes
    this._unsubscribe = this._annotationState.subscribe(() => {
      this.currentTool = this._annotationState.currentTool;
      this.annotationCount = this._annotationState.count;
      this.requestUpdate();
    });
    
    this.annotationCount = this._annotationState.count;
  }
  
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  render() {
    return html`
      <annotation-overlay id="annotationOverlay"></annotation-overlay>
      
      <div class="floating-toolbar">
        <button class="close-btn" @click="${this.close}" title="Close">✕</button>
        
        <div class="toolbar-title">
          Annotations
          ${this.annotationCount > 0 ? html`
            <span class="annotation-count">${this.annotationCount}</span>
          ` : ''}
        </div>
        
        <div class="row">
          ${TOOL_DEFINITIONS.map(tool => html`
            <button 
              class="tool-btn ${this.currentTool === tool.id ? 'active' : ''}"
              title="${tool.name}: ${tool.description}"
              @click="${(e) => { e.stopPropagation(); this._setTool(tool.id); }}"
            >
              ${tool.icon}
            </button>
          `)}
        </div>
        
        <div class="row">
          ${ANNOTATION_COLORS.palette.map(color => html`
            <div
              class="color-swatch ${this._isColorSelected(color) ? 'selected' : ''}"
              style="background: ${color.fill}; border-color: ${this._isColorSelected(color) ? color.stroke : 'transparent'}"
              title="${color.name}"
              @click="${(e) => { e.stopPropagation(); this._setColor(color); }}"
            ></div>
          `)}
        </div>
        
        ${this.annotationCount > 0 ? html`
          <div class="row">
            <button class="danger" @click="${this._clearAnnotations}" title="Clear all annotations">
              🗑 Clear All
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  firstUpdated() {
    this._overlay = this.shadowRoot?.querySelector('#annotationOverlay');
  }

  updated(changedProps) {
    if (changedProps.has('visible')) {
      if (this.visible && this._overlay) {
        this._overlay.show();
      } else if (this._overlay) {
        this._overlay.hide();
      }
    }
  }

  // --- Public API ---
  
  open() { 
    this.visible = true;
    this.setAttribute('visible', '');
    this._annotationState.enable();
    
    // Ensure overlay is shown
    this.updateComplete.then(() => {
      if (this._overlay) {
        this._overlay.show();
      }
    });
  }
  
  close() { 
    this.visible = false;
    this.removeAttribute('visible');
    this._annotationState.disable();
    
    if (this._overlay) {
      this._overlay.hide();
    }
  }
  
  toggle() {
    if (this.visible) {
      this.close();
    } else {
      this.open();
    }
  }

  // --- Internal handlers ---
  
  _setTool(tool) {
    this.currentTool = tool;
    this._annotationState.setTool(tool);
    if (this._overlay) {
      this._overlay.setTool(tool);
    }
  }
  
  _setColor(color) {
    this._annotationState.setColor(color);
    this.requestUpdate();
  }
  
  _isColorSelected(color) {
    const current = this._annotationState.currentColor;
    return current && current.fill === color.fill;
  }
  
  _clearAnnotations() {
    if (confirm('Clear all annotations? This cannot be undone.')) {
      this._annotationState.clear();
      if (this._overlay) {
        this._overlay.clearAll();
      }
    }
  }
}

customElements.define('plugin-annotations', PluginAnnotationsComponent);

export default PluginAnnotationsComponent;
