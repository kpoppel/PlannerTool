/**
 * AnnotationOverlay.js
 * Lit component providing an interactive annotation layer over the timeline
 * Uses imperative DOM manipulation for SVG elements to ensure compatibility
 */

import { LitElement, html, css } from '../../vendor/lit.js';
import { ANNOTATION_COLORS } from './AnnotationColors.js';
import { 
  TOOLS, 
  getAnnotationState,
  createNoteAnnotation,
  createRectAnnotation,
  createLineAnnotation
} from './AnnotationState.js';
import { TIMELINE_CONFIG, getTimelineMonths } from '../../components/Timeline.lit.js';
import { getBoardOffset } from '../../components/board-utils.js';

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
    
    // Track clicks for double-click detection
    this._lastClickTime = 0;
    this._lastClickId = null;
  }

  static styles = css`
    :host {
      display: none;
      position: fixed;
      z-index: 50;
      pointer-events: none;
      overflow: hidden;
    }

    :host([active]) {
      display: block;
    }

    .overlay-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      outline: none;
      /* Let scroll events pass through by default */
      pointer-events: none;
    }
    
    .overlay-container.interactive {
      /* Only capture events when in interactive mode */
      pointer-events: auto;
    }

    .annotation-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: none;
    }

    .annotation-svg .annotation {
      pointer-events: auto;
      cursor: move;
    }

    /* Text editing */
    .note-text-input {
      position: absolute;
      border: none;
      background: transparent;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      line-height: 1.3;
      color: #1A1A1A;
      resize: none;
      outline: none;
      padding: 6px 6px;
      box-sizing: border-box;
      border-radius: 4px;
      pointer-events: auto;
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
    
    // Listen for scroll events to reposition overlay and re-render annotations
    this._scrollScheduled = false;
    this._scrollHandler = () => {
      if (this._scrollScheduled) return;
      this._scrollScheduled = true;
      requestAnimationFrame(() => {
        this._scrollScheduled = false;
        // Reposition overlay to stay aligned with featureBoard
        this._positionOverTimeline();
        this._updateSvg();
      });
    };
    
    // Attach scroll listener - may need to wait for DOM
    this._attachScrollListener();
  }
  
  _attachScrollListener() {
    const { timelineSection, featureBoard } = this._getScrollContainers();
    
    // Listen to timeline section for horizontal scroll (panning)
    if (timelineSection && !this._scrollTargetV) {
      timelineSection.addEventListener('scroll', this._scrollHandler);
      this._scrollTargetV = timelineSection;
    }
    
    // Listen to feature board for vertical scroll
    if (featureBoard && !this._scrollTargetH) {
      featureBoard.addEventListener('scroll', this._scrollHandler);
      this._scrollTargetH = featureBoard;
    }
    
    // Retry if elements not yet available
    if (!timelineSection || !featureBoard) {
      setTimeout(() => this._attachScrollListener(), 100);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    
    // Remove scroll listeners
    if (this._scrollTargetV && this._scrollHandler) {
      this._scrollTargetV.removeEventListener('scroll', this._scrollHandler);
      this._scrollTargetV = null;
    }
    if (this._scrollTargetH && this._scrollHandler) {
      this._scrollTargetH.removeEventListener('scroll', this._scrollHandler);
      this._scrollTargetH = null;
    }
  }

  render() {
    // Convert note position to viewport coords for the text input
    let textareaStyle = '';
    if (this._editingNote) {
      const contentX = this._editingNote.date ? this._dateToContentX(this._editingNote.date) : (this._editingNote.x || 0);
      const { x: vx, y: vy } = this._contentToViewport(contentX, this._editingNote.y);
      const fontSize = this._editingNote.fontSize || 12;
      const bgColor = this._editingNote.fill || ANNOTATION_COLORS.defaultFill;
      textareaStyle = `left: ${vx}px; top: ${vy}px; width: ${this._editingNote.width}px; height: ${this._editingNote.height}px; font-size: ${fontSize}px; background: ${bgColor};`;
    }
    
    // Only make the overlay interactive when using a drawing tool
    // This allows scroll events to pass through when in SELECT mode
    const isDrawingTool = [TOOLS.NOTE, TOOLS.RECT, TOOLS.LINE].includes(this.currentTool);
    const containerClass = isDrawingTool ? 'overlay-container interactive' : 'overlay-container';
    
    return html`
      <div 
        class="${containerClass}"
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
            style="${textareaStyle}"
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
    // Convert logical date to content coordinates then to viewport for display
    const contentX = ann.date ? this._dateToContentX(ann.date) : (ann.x || 0);
    const { x: vx, y: vy } = this._contentToViewport(contentX, ann.y);
    
    const g = this._createSvgElement('g', {
      class: `annotation annotation-note ${isSelected ? 'selected' : ''}`,
      'data-id': ann.id
    });
    
    // Background rect
    const rect = this._createSvgElement('rect', {
      x: vx,
      y: vy,
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
        x: vx + 6,
        y: vy + 14 + i * lineHeight,
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
        x: vx - 2,
        y: vy - 2,
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
      this._addResizeHandle(g, ann, vx, vy);
    }
    
    // Event listeners
    g.addEventListener('mousedown', (e) => this._onAnnotationMouseDown(e, ann));
    g.addEventListener('dblclick', (e) => this._onAnnotationDblClick(e, ann));
    
    this._svgEl.appendChild(g);
  }

  _renderRectToSvg(ann, isSelected) {
    // Convert logical date to content coordinates then to viewport for display
    const contentX = ann.date ? this._dateToContentX(ann.date) : (ann.x || 0);
    const { x: vx, y: vy } = this._contentToViewport(contentX, ann.y);
    
    const g = this._createSvgElement('g', {
      class: `annotation annotation-rect ${isSelected ? 'selected' : ''}`,
      'data-id': ann.id
    });
    
    const rect = this._createSvgElement('rect', {
      x: vx,
      y: vy,
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
        x: vx - 3,
        y: vy - 3,
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
      
      this._addResizeHandle(g, ann, vx, vy);
    }
    
    g.addEventListener('mousedown', (e) => this._onAnnotationMouseDown(e, ann));
    
    this._svgEl.appendChild(g);
  }

  _renderLineToSvg(ann, isSelected) {
    // Convert logical dates to content coordinates then to viewport for display
    const contentX1 = ann.date1 ? this._dateToContentX(ann.date1) : (ann.x1 || 0);
    const contentX2 = ann.date2 ? this._dateToContentX(ann.date2) : (ann.x2 || 0);
    const { x: vx1, y: vy1 } = this._contentToViewport(contentX1, ann.y1);
    const { x: vx2, y: vy2 } = this._contentToViewport(contentX2, ann.y2);
    
    const g = this._createSvgElement('g', {
      class: `annotation annotation-line ${isSelected ? 'selected' : ''}`,
      'data-id': ann.id
    });
    
    const line = this._createSvgElement('line', {
      x1: vx1,
      y1: vy1,
      x2: vx2,
      y2: vy2,
      stroke: ann.stroke || ANNOTATION_COLORS.lineColor,
      'stroke-width': ann.strokeWidth || 2,
      'stroke-linecap': 'round'
    });
    g.appendChild(line);
    
    // Arrow head
    if (ann.arrow) {
      const angle = Math.atan2(vy2 - vy1, vx2 - vx1);
      const arrowLen = 10;
      const arrowAngle = Math.PI / 6;
      
      const x3 = vx2 - arrowLen * Math.cos(angle - arrowAngle);
      const y3 = vy2 - arrowLen * Math.sin(angle - arrowAngle);
      const x4 = vx2 - arrowLen * Math.cos(angle + arrowAngle);
      const y4 = vy2 - arrowLen * Math.sin(angle + arrowAngle);
      
      const arrowPath = this._createSvgElement('path', {
        d: `M ${vx2} ${vy2} L ${x3} ${y3} M ${vx2} ${vy2} L ${x4} ${y4}`,
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
        cx: vx1,
        cy: vy1,
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
        cx: vx2,
        cy: vy2,
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

  _addResizeHandle(g, ann, vx, vy) {
    const handleSize = 8;
    const handle = this._createSvgElement('rect', {
      x: vx + ann.width - handleSize / 2,
      y: vy + ann.height - handleSize / 2,
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
    const { tool, startX, startY, currentX, currentY, startContentX, currentContentX } = this._drawState;

    // Prefer content coordinates if available (startContentX/currentContentX),
    // otherwise fall back to the viewport coordinates stored in startX/currentX.
    const startContent = (typeof startContentX !== 'undefined' && startContentX !== null) ? startContentX : startX;
    const currentContent = (typeof currentContentX !== 'undefined' && currentContentX !== null) ? currentContentX : currentX;

    // Convert content coordinates to viewport for preview display
    const { x: vs_x, y: vs_y } = this._contentToViewport(startContent, startY);
    const { x: vc_x, y: vc_y } = this._contentToViewport(currentContent, currentY);
    
    if (tool === TOOLS.NOTE || tool === TOOLS.RECT) {
      const x = Math.min(vs_x, vc_x);
      const y = Math.min(vs_y, vc_y);
      const width = Math.abs(vc_x - vs_x);
      const height = Math.abs(vc_y - vs_y);
      
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
        x1: vs_x,
        y1: vs_y,
        x2: vc_x,
        y2: vc_y,
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

  /**
   * Get the scroll containers for horizontal and vertical scrolling.
   * Horizontal scroll is on the feature-board, vertical scroll is on timeline-section.
   */
  _getScrollContainers() {
    const timelineSection = document.getElementById('timelineSection');
    const featureBoard = document.querySelector('feature-board');
    return { timelineSection, featureBoard };
  }
  
  /**
   * Get current scroll offsets from the appropriate containers.
   * Horizontal scroll is primarily on timelineSection (via panning), featureBoard is fallback.
   * Vertical scroll is on featureBoard.
   */
  _getScrollOffsets() {
    const { timelineSection, featureBoard } = this._getScrollContainers();
    // Use || which treats 0 as falsy - this way if featureBoard.scrollLeft is 0,
    // we fall back to timelineSection.scrollLeft (which is where panning puts horizontal scroll)
    return {
      scrollLeft: featureBoard?.scrollLeft ?? timelineSection?.scrollLeft ?? 0,
      scrollTop: featureBoard?.scrollTop ?? timelineSection?.scrollTop ?? 0
    };
  }

  /**
   * Get coordinates relative to the overlay/featureBoard content, accounting for scroll.
   * 
   * Horizontal: The overlay repositions on scroll, so coordinates relative to the
   * overlay are already correct - no need to add scrollLeft.
   * 
   * Vertical: featureBoard scrolls internally, so we add scrollTop to get
   * stable content coordinates.
   */
  _getEventCoords(e) {
    const rect = this.getBoundingClientRect();
    const { scrollTop, scrollLeft } = this._getScrollOffsets();

    const viewportX = e.clientX - rect.left;
    const contentX = viewportX + scrollLeft; // content coordinate inside feature board

    return {
      x: viewportX,
      y: e.clientY - rect.top + scrollTop,
      contentX
    };
  }

  /**
   * Convert content coordinates back to viewport coordinates for rendering.
   * 
   * Horizontal: The overlay repositions on scroll to stay with featureBoard,
   * so we don't need to adjust for horizontal scroll - the overlay already moved.
   * 
   * Vertical: featureBoard scrolls internally (scrollTop), so we need to 
   * subtract scrollTop to position annotations correctly.
   */
  _contentToViewport(x, y) {
    const { scrollTop, scrollLeft } = this._getScrollOffsets();
    // x is contentX (pixels from content origin). Convert to viewport X by removing scrollLeft
    const viewportX = x - scrollLeft;
    return {
      x: viewportX,
      y: y - scrollTop
    };
  }

  _onMouseDown(e) {
    // Check if click is on an annotation (handled separately)
    if (e.target.closest('.annotation')) return;
    
    const ev = this._getEventCoords(e);
    const x = ev.x; const y = ev.y; const contentX = ev.contentX;
    
    // Deselect on background click in select mode
    if (this.currentTool === TOOLS.SELECT) {
      this._state.deselect();
      // continue so focus remains on container but no drawing starts
      return;
    }
    
    // Start drawing
    if ([TOOLS.NOTE, TOOLS.RECT, TOOLS.LINE].includes(this.currentTool)) {
      this._drawState = {
        tool: this.currentTool,
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
        startContentX: contentX ?? x,
        currentContentX: contentX ?? x
      };
      this._updateSvg();
    }
  }

  _onMouseMove(e) {
    if (!this._drawState && !this._dragState) return;
    
    const ev = this._getEventCoords(e);
    const x = ev.x;
    const y = ev.y;
    const contentX = ev.contentX;
    
    if (this._drawState) {
      this._drawState.currentX = x;
      this._drawState.currentY = y;
      // Use the contentX computed from _getEventCoords rather than reading it from
      // the native event (which doesn't have contentX). Keep previous value
      // as fallback so startContentX remains available.
      this._drawState.currentContentX = (typeof contentX !== 'undefined' && contentX !== null)
        ? contentX
        : (this._drawState.currentContentX ?? x);
      this._updateSvg();
    }
    
    if (this._dragState) {
      const dx = x - this._dragState.lastX;
      const dy = y - this._dragState.lastY;
      
      if (this._dragState.mode === 'move') {
        // Move annotation horizontally by converting content delta to new date
        const ann = this._state.annotations.find(a => a.id === this._dragState.id);
        if (ann) {
          const oldContentX = (ann.date) ? this._dateToContentX(ann.date) : (ann.x ?? 0);
          const deltaContent = (contentX ?? x) - (this._dragState.lastContentX ?? this._dragState.lastX ?? x);
          const newContentX = oldContentX + deltaContent;
          const newDate = this._contentXToDateMs(newContentX);
          if (ann.type === 'line') {
            // Move both endpoints proportionally
            const oldContentX2 = this._dateToContentX(ann.date2 || ann.x2 || newContentX);
            const newContentX2 = oldContentX2 + deltaContent;
            const newDate2 = this._contentXToDateMs(newContentX2);
            this._state.update(this._dragState.id, { date1: newDate, date2: newDate2, y1: ann.y1 + dy, y2: ann.y2 + dy });
          } else {
            this._state.update(this._dragState.id, { date: newDate, y: ann.y + dy });
          }
        }
      } else if (this._dragState.mode === 'resize') {
        const ann = this._state.annotations.find(a => a.id === this._dragState.id);
        if (ann) {
          this._state.resize(this._dragState.id, 
            Math.max(50, ann.width + dx),
            Math.max(30, ann.height + dy)
          );
        }
      } else if (this._dragState.mode === 'line-endpoint') {
        const ann = this._state.annotations.find(a => a.id === this._dragState.id);
        if (ann) {
          const newDate = this._contentXToDateMs(contentX ?? x);
          if (this._dragState.endpoint === 'start') {
            this._state.update(this._dragState.id, { date1: newDate, y1: ann.y1 + dy });
          } else {
            this._state.update(this._dragState.id, { date2: newDate, y2: ann.y2 + dy });
          }
        }
      }
      
      this._dragState.lastX = x;
      this._dragState.lastY = y;
      this._dragState.lastContentX = contentX ?? this._dragState.lastContentX;
    }
  }

  _onMouseUp(e) {
    if (this._drawState) {
      this._finishDrawing();
    }
    
    if (this._dragState) {
      this._dragState = null;
    }
    
    // Ensure container stays focused for keyboard events
    if (this._state.selectedId) {
      const container = this.shadowRoot?.querySelector('.overlay-container');
      if (container) container.focus();
    }
  }

  _finishDrawing() {
    const { tool, startX, startY, currentX, currentY, startContentX, currentContentX } = this._drawState;

    const contentLeft = Math.min(startContentX ?? startX, currentContentX ?? currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs((currentContentX ?? currentX) - (startContentX ?? startX));
    const height = Math.abs(currentY - startY);
    
    // Minimum size threshold
    const minSize = 20;
    
    if (tool === TOOLS.NOTE && width > minSize && height > minSize) {
      const color = this._state.currentColor || ANNOTATION_COLORS.palette[0];
      const dateMs = this._contentXToDateMs(contentLeft);
      const note = createNoteAnnotation(dateMs, y, 'Note', {
        width,
        height,
        fill: color.fill,
        stroke: color.stroke
      });
      this._state.add(note);
      this._state.select(note.id);
    } else if (tool === TOOLS.RECT && width > minSize && height > minSize) {
      const color = this._state.currentColor || ANNOTATION_COLORS.palette[0];
      const dateMs = this._contentXToDateMs(contentLeft);
      const rect = createRectAnnotation(dateMs, y, width, height, {
        stroke: color.stroke
      });
      this._state.add(rect);
      this._state.select(rect.id);
    } else if (tool === TOOLS.LINE) {
      const contentStart = startContentX ?? startX;
      const contentEnd = currentContentX ?? currentX;
      const length = Math.sqrt((contentEnd - contentStart) * (contentEnd - contentStart) + height * height);
      if (length > minSize) {
        const date1 = this._contentXToDateMs(contentStart);
        const date2 = this._contentXToDateMs(contentEnd);
        const line = createLineAnnotation(date1, startY, date2, currentY);
        this._state.add(line);
        this._state.select(line.id);
      }
    }
    
    this._drawState = null;
    this._updateSvg();
  }

  _onAnnotationMouseDown(e, ann) {
    e.stopPropagation();
    
    const ev = this._getEventCoords(e);
    const { x, y, contentX } = ev;
    const now = Date.now();
    
    // Check for double-click (two clicks on same annotation within 400ms)
    if (this._lastClickId === ann.id && (now - this._lastClickTime) < 400) {
      // Double-click detected - edit note
      if (ann.type === 'note') {
        this._lastClickTime = 0;
        this._lastClickId = null;
        this._startEditingNote(ann);
        return;
      }
    }
    
    // Record this click for double-click detection
    this._lastClickTime = now;
    this._lastClickId = ann.id;
    
    this._state.select(ann.id);
    
    // Focus the overlay container so keyboard events work
    const container = this.shadowRoot?.querySelector('.overlay-container');
    if (container) container.focus();
    
    if (this.currentTool === TOOLS.SELECT) {
      this._dragState = {
        id: ann.id,
        mode: 'move',
        lastX: x,
        lastY: y,
        lastContentX: contentX
      };
    }
  }
  
  /**
   * Start editing a note's text
   */
  _startEditingNote(ann) {
    this._editingNote = ann;
    this._dragState = null; // Cancel any drag
    this.requestUpdate();
    
    // Focus the textarea after render
    this.updateComplete.then(() => {
      const textarea = this.shadowRoot.querySelector('.note-text-input');
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    });
  }

  /**
   * Handle double-click on a note annotation to edit text
   */
  _onAnnotationDblClick(e, ann) {
    e.stopPropagation();
    
    if (ann.type === 'note') {
      this._startEditingNote(ann);
    }
  }

  _onResizeStart(e, ann) {
    e.stopPropagation();
    
    const ev = this._getEventCoords(e);
    const x = ev.x; const y = ev.y; const contentX = ev.contentX;
    
    this._state.select(ann.id);
    
    this._dragState = {
      id: ann.id,
      mode: 'resize',
      lastX: x,
      lastY: y,
      lastContentX: contentX
    };
  }

  _onLineEndpointStart(e, ann, endpoint) {
    e.stopPropagation();
    
    const ev = this._getEventCoords(e);
    const x = ev.x; const y = ev.y; const contentX = ev.contentX;
    
    this._state.select(ann.id);
    
    this._dragState = {
      id: ann.id,
      mode: 'line-endpoint',
      endpoint,
      lastX: x,
      lastY: y,
      lastContentX: contentX
    };
  }

  _onDoubleClick(e) {
    // If there's a selected note annotation, start editing it
    // This serves as a backup to the timing-based detection in _onAnnotationMouseDown
    if (this.selectedId) {
      const ann = this._state.annotations.find(a => a.id === this.selectedId);
      if (ann && ann.type === 'note') {
        e.stopPropagation();
        this._startEditingNote(ann);
      }
    }
  }

  _onKeyDown(e) {
    // Delete selected annotation
    const selectedId = this._state.selectedId;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !this._editingNote) {
      this._state.remove(selectedId);
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

  // ---------------------------
  // Date <-> Content X conversions
  // ---------------------------
  _dateToContentX(dateMs) {
    const months = getTimelineMonths() || [];
    const monthWidth = (TIMELINE_CONFIG && TIMELINE_CONFIG.monthWidth) ? TIMELINE_CONFIG.monthWidth : 120;
    const boardOffset = getBoardOffset() || 0;
    if (!months.length) return boardOffset;

    const d = new Date(dateMs);
    // Find month index by scanning (months array contains month start dates)
    let idx = months.findIndex(m => m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth());
    if (idx === -1) {
      // fallback: find nearest earlier month
      idx = months.reduce((acc, m, i) => (m.getTime() <= d.getTime() ? i : acc), 0);
    }
    const monthStart = months[idx];
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const day = d.getDate();
    const fraction = Math.max(0, Math.min(1, (day - 1) / daysInMonth));
    const x = boardOffset + (idx + fraction) * monthWidth;
    return Math.round(x);
  }

  _contentXToDateMs(contentX) {
    const months = getTimelineMonths() || [];
    const monthWidth = (TIMELINE_CONFIG && TIMELINE_CONFIG.monthWidth) ? TIMELINE_CONFIG.monthWidth : 120;
    const boardOffset = getBoardOffset() || 0;
    if (!months.length) return Date.now();

    const rel = (contentX - boardOffset) / monthWidth;
    let idx = Math.floor(rel);
    if (idx < 0) idx = 0;
    if (idx >= months.length) idx = months.length - 1;
    const monthStart = months[idx];
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const fraction = rel - idx;
    const day = Math.max(1, Math.min(daysInMonth, Math.round(fraction * daysInMonth) + 1));
    const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    return date.getTime();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  show() {
    this.active = true;
    this._positionOverTimeline();
    this._attachScrollListener();
    this._updateSvg();
  }

  hide() {
    this.active = false;
    this._editingNote = null;
  }

  toggle() {
    this.active = !this.active;
    if (this.active) {
      this._positionOverTimeline();
    }
  }
  
  /**
   * Position the overlay to cover the feature board only (not the timeline header)
   */
  _positionOverTimeline() {
    const featureBoard = document.querySelector('feature-board');
    if (!featureBoard) return;
    
    const rect = featureBoard.getBoundingClientRect();
    this.style.top = `${rect.top}px`;
    this.style.left = `${rect.left}px`;
    this.style.width = `${rect.width}px`;
    this.style.height = `${rect.height}px`;
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
