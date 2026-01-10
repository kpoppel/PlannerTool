/**
 * AnnotationOverlay.js
 * Lit component providing an interactive annotation layer over the timeline
 * Uses imperative DOM manipulation for SVG elements to ensure compatibility
 */

import { LitElement, html, css } from '../../vendor/lit.js';
import { 
  TOOLS, 
  TOOL_DEFINITIONS, 
  getAnnotationState,
  createNoteAnnotation,
  createRectAnnotation,
  createLineAnnotation
} from './AnnotationTools.js';
import { ANNOTATION_COLORS, getViewportBounds } from './ExportUtils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ============================================================================
// AnnotationOverlay Component
// ============================================================================

export class AnnotationOverlay extends LitElement {
  static properties = {
    active: { type: Boolean, reflect: true },
    currentTool: { type: String },
    selectedId: { type: String },
    annotations: { type: Array }
  };

  constructor() {
    super();
    this.active = false;
    this.currentTool = TOOLS.SELECT;
    this.selectedId = null;
    this.annotations = [];
    
    this._state = getAnnotationState();
    this._unsubscribe = null;
    this._dragState = null;
    this._drawState = null;
    this._editingNote = null;
    this._svgEl = null;
  }

  static styles = css`
    :host {
      display: none;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 50;
      pointer-events: none;
    }

    :host([active]) {
      display: block;
      pointer-events: auto;
    }

    .overlay-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      outline: none;
    }

    .annotation-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    /* Text editing */
    .note-text-input {
      position: absolute;
      border: none;
      background: transparent;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #1A1A1A;
      resize: none;
      outline: none;
      padding: 4px 6px;
      box-sizing: border-box;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    
    // Subscribe to state changes
    this._unsubscribe = this._state.subscribe(() => {
      this.annotations = this._state.annotations;
      this.currentTool = this._state.currentTool;
      this.selectedId = this._state.selectedId;
      this._updateSvg();
    });
    
    // Initialize from state
    this.annotations = this._state.annotations;
    this.currentTool = this._state.currentTool;
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
      <div 
        class="overlay-container"
        @mousedown="${this._onMouseDown}"
        @mousemove="${this._onMouseMove}"
        @mouseup="${this._onMouseUp}"
        @dblclick="${this._onDoubleClick}"
        @keydown="${this._onKeyDown}"
        tabindex="0"
      >
        <svg class="annotation-svg" id="annotationSvg"></svg>
        
        ${this._editingNote ? html`
          <textarea
            class="note-text-input"
            style="
              left: ${this._editingNote.x}px;
              top: ${this._editingNote.y}px;
              width: ${this._editingNote.width}px;
              height: ${this._editingNote.height}px;
            "
            .value="${this._editingNote.text || ''}"
            @input="${this._onNoteTextInput}"
            @blur="${this._onNoteTextBlur}"
            @keydown="${this._onNoteTextKeyDown}"
          ></textarea>
        ` : ''}
      </div>
    `;
  }

  firstUpdated() {
    this._svgEl = this.shadowRoot.querySelector('#annotationSvg');
    this._updateSvg();
  }

  updated(changedProps) {
    if (changedProps.has('annotations') || changedProps.has('selectedId')) {
      this._updateSvg();
    }
  }

  // --------------------------------------------------------------------------
  // SVG Rendering (Imperative)
  // --------------------------------------------------------------------------

  _updateSvg() {
    if (!this._svgEl) return;
    
    // Clear existing content
    this._svgEl.innerHTML = '';
    
    // Render all annotations
    for (const ann of this.annotations) {
      this._renderAnnotationToSvg(ann);
    }
    
    // Render draw preview if active
    if (this._drawState) {
      this._renderDrawPreviewToSvg();
    }
  }

  _renderAnnotationToSvg(ann) {
    const isSelected = ann.id === this.selectedId;
    
    switch (ann.type) {
      case 'note':
        this._renderNoteToSvg(ann, isSelected);
        break;
      case 'rect':
        this._renderRectToSvg(ann, isSelected);
        break;
      case 'line':
        this._renderLineToSvg(ann, isSelected);
        break;
    }
  }

  _createSvgElement(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, String(value));
    }
    return el;
  }

  _renderNoteToSvg(ann, isSelected) {
    const g = this._createSvgElement('g', {
      class: `annotation annotation-note ${isSelected ? 'selected' : ''}`,
      'data-id': ann.id,
      style: 'cursor: move;'
    });
    
    // Background rect
    const rect = this._createSvgElement('rect', {
      x: ann.x,
      y: ann.y,
      width: ann.width,
      height: ann.height,
      rx: 4,
      ry: 4,
      fill: ann.fill || ANNOTATION_COLORS.defaultFill,
      stroke: ann.stroke || ANNOTATION_COLORS.defaultStroke,
      'stroke-width': isSelected ? 2 : 1
    });
    g.appendChild(rect);
    
    // Text lines
    const lines = this._wrapText(ann.text || '', ann.width - 12, ann.fontSize || 12);
    const lineHeight = (ann.fontSize || 12) * 1.3;
    
    lines.forEach((line, i) => {
      const text = this._createSvgElement('text', {
        x: ann.x + 6,
        y: ann.y + 14 + i * lineHeight,
        'font-size': ann.fontSize || 12,
        fill: ANNOTATION_COLORS.textColor,
        'font-family': 'system-ui, -apple-system, sans-serif'
      });
      text.textContent = line;
      g.appendChild(text);
    });
    
    // Selection indicator
    if (isSelected) {
      const selRect = this._createSvgElement('rect', {
        x: ann.x - 2,
        y: ann.y - 2,
        width: ann.width + 4,
        height: ann.height + 4,
        fill: 'none',
        stroke: '#2196F3',
        'stroke-width': 2,
        'stroke-dasharray': '4,2',
        rx: 6,
        ry: 6
      });
      g.appendChild(selRect);
      
      // Resize handle
      this._addResizeHandle(g, ann);
    }
    
    // Event listeners
    g.addEventListener('mousedown', (e) => this._onAnnotationMouseDown(e, ann));
    
    this._svgEl.appendChild(g);
  }

  _renderRectToSvg(ann, isSelected) {
    const g = this._createSvgElement('g', {
      class: `annotation annotation-rect ${isSelected ? 'selected' : ''}`,
      'data-id': ann.id,
      style: 'cursor: move;'
    });
    
    const rect = this._createSvgElement('rect', {
      x: ann.x,
      y: ann.y,
      width: ann.width,
      height: ann.height,
      fill: ann.fill || 'rgba(200,200,200,0.2)',
      stroke: ann.stroke || ANNOTATION_COLORS.lineColor,
      'stroke-width': ann.strokeWidth || 2,
      rx: 2,
      ry: 2
    });
    g.appendChild(rect);
    
    // Selection indicator
    if (isSelected) {
      const selRect = this._createSvgElement('rect', {
        x: ann.x - 3,
        y: ann.y - 3,
        width: ann.width + 6,
        height: ann.height + 6,
        fill: 'none',
        stroke: '#2196F3',
        'stroke-width': 2,
        'stroke-dasharray': '4,2',
        rx: 4,
        ry: 4
      });
      g.appendChild(selRect);
      
      this._addResizeHandle(g, ann);
    }
    
    g.addEventListener('mousedown', (e) => this._onAnnotationMouseDown(e, ann));
    
    this._svgEl.appendChild(g);
  }

  _renderLineToSvg(ann, isSelected) {
    const g = this._createSvgElement('g', {
      class: `annotation annotation-line ${isSelected ? 'selected' : ''}`,
      'data-id': ann.id,
      style: 'cursor: move;'
    });
    
    const line = this._createSvgElement('line', {
      x1: ann.x1,
      y1: ann.y1,
      x2: ann.x2,
      y2: ann.y2,
      stroke: ann.stroke || ANNOTATION_COLORS.lineColor,
      'stroke-width': ann.strokeWidth || 2,
      'stroke-linecap': 'round'
    });
    g.appendChild(line);
    
    // Arrow head
    if (ann.arrow) {
      const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
      const arrowLen = 10;
      const arrowAngle = Math.PI / 6;
      
      const x3 = ann.x2 - arrowLen * Math.cos(angle - arrowAngle);
      const y3 = ann.y2 - arrowLen * Math.sin(angle - arrowAngle);
      const x4 = ann.x2 - arrowLen * Math.cos(angle + arrowAngle);
      const y4 = ann.y2 - arrowLen * Math.sin(angle + arrowAngle);
      
      const arrowPath = this._createSvgElement('path', {
        d: `M ${ann.x2} ${ann.y2} L ${x3} ${y3} M ${ann.x2} ${ann.y2} L ${x4} ${y4}`,
        fill: 'none',
        stroke: ann.stroke || ANNOTATION_COLORS.lineColor,
        'stroke-width': ann.strokeWidth || 2,
        'stroke-linecap': 'round'
      });
      g.appendChild(arrowPath);
    }
    
    // Selection indicator + endpoint handles
    if (isSelected) {
      const handleRadius = 5;
      
      // Start handle
      const startHandle = this._createSvgElement('circle', {
        cx: ann.x1,
        cy: ann.y1,
        r: handleRadius,
        fill: '#2196F3',
        stroke: 'white',
        'stroke-width': 1,
        style: 'cursor: move;'
      });
      startHandle.addEventListener('mousedown', (e) => this._onLineEndpointStart(e, ann, 'start'));
      g.appendChild(startHandle);
      
      // End handle
      const endHandle = this._createSvgElement('circle', {
        cx: ann.x2,
        cy: ann.y2,
        r: handleRadius,
        fill: '#2196F3',
        stroke: 'white',
        'stroke-width': 1,
        style: 'cursor: move;'
      });
      endHandle.addEventListener('mousedown', (e) => this._onLineEndpointStart(e, ann, 'end'));
      g.appendChild(endHandle);
    }
    
    g.addEventListener('mousedown', (e) => this._onAnnotationMouseDown(e, ann));
    
    this._svgEl.appendChild(g);
  }

  _addResizeHandle(g, ann) {
    const handleSize = 8;
    const handle = this._createSvgElement('rect', {
      x: ann.x + ann.width - handleSize / 2,
      y: ann.y + ann.height - handleSize / 2,
      width: handleSize,
      height: handleSize,
      fill: '#2196F3',
      stroke: 'white',
      'stroke-width': 1,
      style: 'cursor: nwse-resize;'
    });
    handle.addEventListener('mousedown', (e) => this._onResizeStart(e, ann));
    g.appendChild(handle);
  }

  _renderDrawPreviewToSvg() {
    const { tool, startX, startY, currentX, currentY } = this._drawState;
    
    if (tool === TOOLS.NOTE || tool === TOOLS.RECT) {
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      
      const fill = tool === TOOLS.NOTE 
        ? (this._state.currentColor?.fill || ANNOTATION_COLORS.defaultFill)
        : 'rgba(200,200,200,0.2)';
      const stroke = this._state.currentColor?.stroke || ANNOTATION_COLORS.defaultStroke;
      
      const rect = this._createSvgElement('rect', {
        x, y, width, height,
        fill,
        stroke,
        'stroke-width': 2,
        'stroke-dasharray': '4,4',
        rx: 4,
        ry: 4,
        opacity: 0.6,
        'pointer-events': 'none'
      });
      this._svgEl.appendChild(rect);
    }
    
    if (tool === TOOLS.LINE) {
      const line = this._createSvgElement('line', {
        x1: startX,
        y1: startY,
        x2: currentX,
        y2: currentY,
        stroke: ANNOTATION_COLORS.lineColor,
        'stroke-width': 2,
        'stroke-dasharray': '4,4',
        opacity: 0.6,
        'pointer-events': 'none'
      });
      this._svgEl.appendChild(line);
    }
  }

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------

  _getEventCoords(e) {
    const rect = this.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  _onMouseDown(e) {
    // Check if click is on an annotation (handled separately)
    if (e.target.closest('.annotation')) return;
    
    const { x, y } = this._getEventCoords(e);
    
    // Deselect on background click in select mode
    if (this.currentTool === TOOLS.SELECT) {
      this._state.deselect();
      return;
    }
    
    // Start drawing
    if ([TOOLS.NOTE, TOOLS.RECT, TOOLS.LINE].includes(this.currentTool)) {
      this._drawState = {
        tool: this.currentTool,
        startX: x,
        startY: y,
        currentX: x,
        currentY: y
      };
      this._updateSvg();
    }
  }

  _onMouseMove(e) {
    if (!this._drawState && !this._dragState) return;
    
    const { x, y } = this._getEventCoords(e);
    
    if (this._drawState) {
      this._drawState.currentX = x;
      this._drawState.currentY = y;
      this._updateSvg();
    }
    
    if (this._dragState) {
      const dx = x - this._dragState.lastX;
      const dy = y - this._dragState.lastY;
      
      if (this._dragState.mode === 'move') {
        this._state.move(this._dragState.id, dx, dy);
      } else if (this._dragState.mode === 'resize') {
        const ann = this._state.annotations.find(a => a.id === this._dragState.id);
        if (ann) {
          this._state.resize(this._dragState.id, 
            Math.max(50, ann.width + dx),
            Math.max(30, ann.height + dy)
          );
        }
      } else if (this._dragState.mode === 'line-endpoint') {
        if (this._dragState.endpoint === 'start') {
          this._state.update(this._dragState.id, { x1: x, y1: y });
        } else {
          this._state.update(this._dragState.id, { x2: x, y2: y });
        }
      }
      
      this._dragState.lastX = x;
      this._dragState.lastY = y;
    }
  }

  _onMouseUp(e) {
    if (this._drawState) {
      this._finishDrawing();
    }
    
    if (this._dragState) {
      this._dragState = null;
    }
  }

  _finishDrawing() {
    const { tool, startX, startY, currentX, currentY } = this._drawState;
    
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    // Minimum size threshold
    const minSize = 20;
    
    if (tool === TOOLS.NOTE && width > minSize && height > minSize) {
      const color = this._state.currentColor || ANNOTATION_COLORS.palette[0];
      const note = createNoteAnnotation(x, y, 'Note', {
        width,
        height,
        fill: color.fill,
        stroke: color.stroke
      });
      this._state.add(note);
      this._state.select(note.id);
    } else if (tool === TOOLS.RECT && width > minSize && height > minSize) {
      const color = this._state.currentColor || ANNOTATION_COLORS.palette[0];
      const rect = createRectAnnotation(x, y, width, height, {
        stroke: color.stroke
      });
      this._state.add(rect);
      this._state.select(rect.id);
    } else if (tool === TOOLS.LINE) {
      const length = Math.sqrt(width * width + height * height);
      if (length > minSize) {
        const line = createLineAnnotation(startX, startY, currentX, currentY);
        this._state.add(line);
        this._state.select(line.id);
      }
    }
    
    this._drawState = null;
    this._updateSvg();
  }

  _onAnnotationMouseDown(e, ann) {
    e.stopPropagation();
    
    const { x, y } = this._getEventCoords(e);
    
    this._state.select(ann.id);
    
    if (this.currentTool === TOOLS.SELECT) {
      this._dragState = {
        id: ann.id,
        mode: 'move',
        lastX: x,
        lastY: y
      };
    }
  }

  _onResizeStart(e, ann) {
    e.stopPropagation();
    
    const { x, y } = this._getEventCoords(e);
    
    this._state.select(ann.id);
    
    this._dragState = {
      id: ann.id,
      mode: 'resize',
      lastX: x,
      lastY: y
    };
  }

  _onLineEndpointStart(e, ann, endpoint) {
    e.stopPropagation();
    
    const { x, y } = this._getEventCoords(e);
    
    this._state.select(ann.id);
    
    this._dragState = {
      id: ann.id,
      mode: 'line-endpoint',
      endpoint,
      lastX: x,
      lastY: y
    };
  }

  _onDoubleClick(e) {
    const annEl = e.target.closest('.annotation-note');
    if (annEl) {
      const id = annEl.getAttribute('data-id');
      const ann = this._state.annotations.find(a => a.id === id);
      if (ann) {
        this._editingNote = ann;
        this.requestUpdate();
        
        // Focus the textarea after render
        this.updateComplete.then(() => {
          const textarea = this.shadowRoot.querySelector('.note-text-input');
          if (textarea) textarea.focus();
        });
      }
    }
  }

  _onKeyDown(e) {
    // Delete selected annotation
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId && !this._editingNote) {
      this._state.remove(this.selectedId);
      e.preventDefault();
    }
    
    // Escape to deselect
    if (e.key === 'Escape') {
      this._state.deselect();
      this._state.setTool(TOOLS.SELECT);
      this._editingNote = null;
      this.requestUpdate();
    }
  }

  _onNoteTextInput(e) {
    if (this._editingNote) {
      this._state.update(this._editingNote.id, { text: e.target.value });
      // Update local reference for the textarea position
      this._editingNote = this._state.annotations.find(a => a.id === this._editingNote.id);
    }
  }

  _onNoteTextBlur() {
    this._editingNote = null;
    this.requestUpdate();
  }

  _onNoteTextKeyDown(e) {
    if (e.key === 'Escape') {
      this._editingNote = null;
      this.requestUpdate();
    }
    e.stopPropagation(); // Don't trigger delete
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  _wrapText(text, maxWidth, fontSize = 12) {
    const avgCharWidth = fontSize * 0.6;
    const charsPerLine = Math.floor(maxWidth / avgCharWidth);
    
    if (charsPerLine <= 0) return [text];
    
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (testLine.length > charsPerLine && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines.length ? lines : [text];
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  show() {
    this.active = true;
  }

  hide() {
    this.active = false;
    this._editingNote = null;
  }

  toggle() {
    this.active = !this.active;
  }

  setTool(tool) {
    this._state.setTool(tool);
  }

  setColor(color) {
    this._state.setColor(color);
  }

  clearAll() {
    this._state.clear();
  }
}

customElements.define('annotation-overlay', AnnotationOverlay);

export default AnnotationOverlay;
