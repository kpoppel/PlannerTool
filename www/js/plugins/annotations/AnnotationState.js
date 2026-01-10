/**
 * AnnotationState.js
 * Tool definitions and annotation state management for the Annotations plugin
 */

import { ANNOTATION_COLORS, getRandomColor } from './AnnotationColors.js';
import { TIMELINE_CONFIG, getTimelineMonths } from '../../components/Timeline.lit.js';
import { getBoardOffset } from '../../components/board-utils.js';
import { generateId, saveAnnotations, loadAnnotations } from './AnnotationStorage.js';

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
export function createNoteAnnotation(dateMs, y, text = 'Note', options = {}) {
  const color = getRandomColor();

  return {
    id: generateId(),
    type: 'note',
    date: dateMs, // logical timestamp for left edge
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
export function createRectAnnotation(dateMs, y, width, height, options = {}) {
  const color = getRandomColor();

  return {
    id: generateId(),
    type: 'rect',
    date: dateMs,
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
export function createLineAnnotation(date1, y1, date2, y2, options = {}) {
  return {
    id: generateId(),
    type: 'line',
    date1,
    y1,
    date2,
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
    this._enabled = false;
    
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
  
  get enabled() {
    return this._enabled;
  }
  
  get count() {
    return this._annotations.length;
  }
  
  // ---------------------------
  // Enable/Disable
  // ---------------------------
  
  enable() {
    this._enabled = true;
    this._notify();
  }
  
  disable() {
    this._enabled = false;
    this._selectedId = null;
    this._notify();
  }
  
  toggle() {
    if (this._enabled) {
      this.disable();
    } else {
      this.enable();
    }
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
    
    // If annotation uses date-based X, convert dx (pixels) to date shift
    const monthWidth = (TIMELINE_CONFIG && TIMELINE_CONFIG.monthWidth) ? TIMELINE_CONFIG.monthWidth : 120;
    const months = getTimelineMonths() || [];
    const boardOffset = getBoardOffset() || 0;

    const contentXForDate = (dateMs) => {
      if (!months.length) return boardOffset;
      const d = new Date(dateMs);
      let idx = months.findIndex(m => m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth());
      if (idx === -1) idx = months.reduce((acc, m, i) => (m.getTime() <= d.getTime() ? i : acc), 0);
      const monthStart = months[idx];
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
      const fraction = Math.max(0, Math.min(1, (d.getDate() - 1) / daysInMonth));
      return Math.round(boardOffset + (idx + fraction) * monthWidth);
    };

    const contentXToDateMs = (contentX) => {
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
    };

    if (ann.type === 'line') {
      // Move both endpoints horizontally by dx -> convert to date shift
      const x1 = ann.date1 ? contentXForDate(ann.date1) : (ann.x1 || 0);
      const x2 = ann.date2 ? contentXForDate(ann.date2) : (ann.x2 || 0);
      const newDate1 = contentXToDateMs(x1 + dx);
      const newDate2 = contentXToDateMs(x2 + dx);
      return this.update(id, {
        date1: newDate1,
        y1: ann.y1 + dy,
        date2: newDate2,
        y2: ann.y2 + dy
      });
    } else {
      const x = ann.date ? contentXForDate(ann.date) : (ann.x || 0);
      const newDate = contentXToDateMs(x + dx);
      return this.update(id, {
        date: newDate,
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
