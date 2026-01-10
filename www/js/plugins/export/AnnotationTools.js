/**
 * AnnotationTools.js
 * Tool definitions and annotation state management
 */

import { ANNOTATION_COLORS, generateId, saveAnnotations, loadAnnotations } from './ExportUtils.js';

// ============================================================================
// Tool Definitions
// ============================================================================

export const TOOLS = {
  SELECT: 'select',
  NOTE: 'note',
  RECT: 'rect',
  LINE: 'line'
};

export const TOOL_DEFINITIONS = [
  {
    id: TOOLS.SELECT,
    name: 'Select',
    icon: '↖',
    cursor: 'default',
    description: 'Select and move annotations'
  },
  {
    id: TOOLS.NOTE,
    name: 'Note',
    icon: '📝',
    cursor: 'text',
    description: 'Add a text note'
  },
  {
    id: TOOLS.RECT,
    name: 'Rectangle',
    icon: '▢',
    cursor: 'crosshair',
    description: 'Draw a rectangle'
  },
  {
    id: TOOLS.LINE,
    name: 'Line',
    icon: '↗',
    cursor: 'crosshair',
    description: 'Draw a line or arrow'
  }
];

// ============================================================================
// Annotation Data Structures
// ============================================================================

/**
 * Create a new note annotation
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} text - Note text
 * @param {Object} options - { fill, stroke, width, height }
 * @returns {Object} Note annotation object
 */
export function createNoteAnnotation(x, y, text = 'Note', options = {}) {
  const colorIdx = Math.floor(Math.random() * ANNOTATION_COLORS.palette.length);
  const color = ANNOTATION_COLORS.palette[colorIdx];
  
  return {
    id: generateId(),
    type: 'note',
    x,
    y,
    width: options.width || 150,
    height: options.height || 60,
    text,
    fill: options.fill || color.fill,
    stroke: options.stroke || color.stroke,
    fontSize: options.fontSize || 12
  };
}

/**
 * Create a new rectangle annotation
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} width - Rectangle width
 * @param {number} height - Rectangle height
 * @param {Object} options - { fill, stroke, strokeWidth }
 * @returns {Object} Rectangle annotation object
 */
export function createRectAnnotation(x, y, width, height, options = {}) {
  const colorIdx = Math.floor(Math.random() * ANNOTATION_COLORS.palette.length);
  const color = ANNOTATION_COLORS.palette[colorIdx];
  
  return {
    id: generateId(),
    type: 'rect',
    x,
    y,
    width,
    height,
    fill: options.fill || 'transparent',
    stroke: options.stroke || color.stroke,
    strokeWidth: options.strokeWidth || 2
  };
}

/**
 * Create a new line annotation
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @param {Object} options - { stroke, strokeWidth, arrow }
 * @returns {Object} Line annotation object
 */
export function createLineAnnotation(x1, y1, x2, y2, options = {}) {
  return {
    id: generateId(),
    type: 'line',
    x1,
    y1,
    x2,
    y2,
    stroke: options.stroke || ANNOTATION_COLORS.lineColor,
    strokeWidth: options.strokeWidth || 2,
    arrow: options.arrow !== undefined ? options.arrow : true
  };
}

// ============================================================================
// Annotation State Manager
// ============================================================================

export class AnnotationState {
  constructor() {
    this._annotations = [];
    this._selectedId = null;
    this._currentTool = TOOLS.SELECT;
    this._currentColor = ANNOTATION_COLORS.palette[0];
    this._listeners = new Set();
    
    // Load persisted annotations
    this._annotations = loadAnnotations();
  }
  
  // ---------------------------
  // Getters
  // ---------------------------
  
  get annotations() {
    return [...this._annotations];
  }
  
  get selectedId() {
    return this._selectedId;
  }
  
  get selectedAnnotation() {
    return this._annotations.find(a => a.id === this._selectedId) || null;
  }
  
  get currentTool() {
    return this._currentTool;
  }
  
  get currentColor() {
    return this._currentColor;
  }
  
  // ---------------------------
  // Setters / Mutators
  // ---------------------------
  
  setTool(tool) {
    if (Object.values(TOOLS).includes(tool)) {
      this._currentTool = tool;
      this._notify();
    }
  }
  
  setColor(color) {
    this._currentColor = color;
    this._notify();
  }
  
  select(id) {
    this._selectedId = id;
    this._notify();
  }
  
  deselect() {
    this._selectedId = null;
    this._notify();
  }
  
  // ---------------------------
  // CRUD Operations
  // ---------------------------
  
  add(annotation) {
    this._annotations.push(annotation);
    this._persist();
    this._notify();
    return annotation;
  }
  
  update(id, updates) {
    const idx = this._annotations.findIndex(a => a.id === id);
    if (idx !== -1) {
      this._annotations[idx] = { ...this._annotations[idx], ...updates };
      this._persist();
      this._notify();
      return this._annotations[idx];
    }
    return null;
  }
  
  remove(id) {
    const idx = this._annotations.findIndex(a => a.id === id);
    if (idx !== -1) {
      const removed = this._annotations.splice(idx, 1)[0];
      if (this._selectedId === id) {
        this._selectedId = null;
      }
      this._persist();
      this._notify();
      return removed;
    }
    return null;
  }
  
  clear() {
    this._annotations = [];
    this._selectedId = null;
    this._persist();
    this._notify();
  }
  
  // ---------------------------
  // Move / Resize helpers
  // ---------------------------
  
  move(id, dx, dy) {
    const ann = this._annotations.find(a => a.id === id);
    if (!ann) return null;
    
    if (ann.type === 'line') {
      return this.update(id, {
        x1: ann.x1 + dx,
        y1: ann.y1 + dy,
        x2: ann.x2 + dx,
        y2: ann.y2 + dy
      });
    } else {
      return this.update(id, {
        x: ann.x + dx,
        y: ann.y + dy
      });
    }
  }
  
  resize(id, width, height) {
    return this.update(id, { width, height });
  }
  
  // ---------------------------
  // Persistence
  // ---------------------------
  
  _persist() {
    saveAnnotations(this._annotations);
  }
  
  reload() {
    this._annotations = loadAnnotations();
    this._notify();
  }
  
  // ---------------------------
  // Change notification
  // ---------------------------
  
  subscribe(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }
  
  _notify() {
    for (const listener of this._listeners) {
      try {
        listener(this);
      } catch (e) {
        console.warn('[AnnotationState] Listener error:', e);
      }
    }
  }
}

// Singleton instance
let _stateInstance = null;

/**
 * Get the singleton annotation state instance
 * @returns {AnnotationState}
 */
export function getAnnotationState() {
  if (!_stateInstance) {
    _stateInstance = new AnnotationState();
  }
  return _stateInstance;
}
