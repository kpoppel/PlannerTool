/**
 * AnnotationState.js
 * Tool definitions and annotation state management for the Annotations plugin
 */

import { ANNOTATION_COLORS, getRandomColor } from './AnnotationColors.js';
import { boardCoords } from '../../services/BoardCoordinateService.js';
import { generateId } from './AnnotationStorage.js';
import { store } from '../../application/store.js';
import { bus } from '../../core/EventBus.js';
import { ScenarioEvents } from '../../core/EventRegistry.js';
import { cmd } from '../../application/imports.js';

// ============================================================================
// Scenario-scoped persistence
// ============================================================================
// Annotations follow the active scenario so a user can build up a scenario,
// add notes/shapes for it, switch to another scenario, and see that
// scenario's own annotation set. `cmd.pluginScenarioData` is the generic,
// plugin-agnostic storage seam for this (see
// application/commands/pluginScenarioDataCommands.js) which this plugin uses
// for every scenario, including the synthetic 'baseline' scenario — the
// scenario layer itself owns the fallback storage for scenarios with no
// server-side record, so this plugin has no storage knowledge of its own.
const PLUGIN_DATA_KEY = 'plugin-annotations';

function getActiveScenarioId() {
  return store.getState().scenarios.activeId;
}

function readAnnotationsForActiveScenario() {
  const activeId = getActiveScenarioId();
  const data = cmd.pluginScenarioData.get(activeId, PLUGIN_DATA_KEY);
  // Only this plugin ever writes PLUGIN_DATA_KEY, and always as an array;
  // it is simply absent until the first annotation is added.
  return data === undefined ? [] : data;
}

function persistAnnotationsForActiveScenario(annotations) {
  const activeId = getActiveScenarioId();
  cmd.pluginScenarioData.set(activeId, PLUGIN_DATA_KEY, annotations);
}


// ============================================================================
// Tool Definitions
// ============================================================================

export const TOOLS = {
  SELECT: 'select',
  NOTE: 'note',
  RECT: 'rect',
  LINE: 'line',
  ICON: 'icon',
};

export const TOOL_DEFINITIONS = [
  {
    id: TOOLS.SELECT,
    name: 'Select',
    icon: '↖',
    cursor: 'default',
    description: 'Select and move annotations',
  },
  {
    id: TOOLS.NOTE,
    name: 'Note',
    icon: '📝',
    cursor: 'text',
    description: 'Add a text note',
  },
  {
    id: TOOLS.RECT,
    name: 'Rectangle',
    icon: '▢',
    cursor: 'crosshair',
    description: 'Draw a rectangle',
  },
  {
    id: TOOLS.LINE,
    name: 'Line',
    icon: '↗',
    cursor: 'crosshair',
    description: 'Draw a line or arrow',
  },
  {
    id: TOOLS.ICON,
    name: 'Icon',
    icon: '⭐',
    cursor: 'pointer',
    description: 'Place a small icon marker',
  },
];

// ============================================================================
// Annotation Data Structures
// ============================================================================

/**
 * Create a new note annotation
 * @param {number} dateMs - X-axis timestamp anchor
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
    fontSize: options.fontSize || 12,
  };
}

/**
 * Create a new rectangle annotation
 * @param {number} dateMs - X-axis timestamp anchor
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
    strokeWidth: options.strokeWidth || 2,
  };
}

/**
 * Create a new line annotation
 * @param {number} date1 - Start date timestamp
 * @param {number} y1 - Start Y
 * @param {number} date2 - End date timestamp
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
    arrow: options.arrow !== undefined ? options.arrow : true,
  };
}

/**
 * Create a new icon annotation
 * @param {number} dateMs - anchor date
 * @param {number} y - vertical position
 * @param {string} icon - emoji/string id for the icon
 * @param {Object} options - { size }
 */
export function createIconAnnotation(dateMs, y, icon = '⭐', options = {}) {
  return {
    id: generateId(),
    type: 'icon',
    date: dateMs,
    y,
    icon: icon,
    size: options.size || 18,
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
    this._currentIcon = '⭐';
    this._listeners = new Set();
    this._enabled = false;
    this._activeScenarioId = getActiveScenarioId();

    // Load persisted annotations for whichever scenario is currently active
    this._annotations = readAnnotationsForActiveScenario();

    // Reload the annotation set whenever the active scenario changes
    bus.on(ScenarioEvents.ACTIVATED, () => {
      this._activeScenarioId = getActiveScenarioId();
      this._selectedId = null;
      this._annotations = readAnnotationsForActiveScenario();
      this._notify();
    });
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
    return this._annotations.find((a) => a.id === this._selectedId) || null;
  }

  get currentTool() {
    return this._currentTool;
  }

  get currentColor() {
    return this._currentColor;
  }

  get currentIcon() {
    return this._currentIcon;
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

  setIcon(icon) {
    this._currentIcon = icon;
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
    const idx = this._annotations.findIndex((a) => a.id === id);
    if (idx !== -1) {
      this._annotations[idx] = { ...this._annotations[idx], ...updates };
      this._persist();
      this._notify();
      return this._annotations[idx];
    }
    return null;
  }

  remove(id) {
    const idx = this._annotations.findIndex((a) => a.id === id);
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
    const ann = this._annotations.find((a) => a.id === id);
    if (!ann) return null;

    // If annotation uses date-based X, convert dx (pixels) to date shift
    const contentXForDate = (dateMs) => boardCoords.dateToContentX(new Date(dateMs));
    const contentXToDateMs = (contentX) => boardCoords.contentXToDateMs(contentX);

    if (ann.type === 'line') {
      // Move both endpoints horizontally by dx -> convert to date shift
      const x1 = ann.date1 ? contentXForDate(ann.date1) : ann.x1 || 0;
      const x2 = ann.date2 ? contentXForDate(ann.date2) : ann.x2 || 0;
      const newDate1 = contentXToDateMs(x1 + dx);
      const newDate2 = contentXToDateMs(x2 + dx);
      return this.update(id, {
        date1: newDate1,
        y1: ann.y1 + dy,
        date2: newDate2,
        y2: ann.y2 + dy,
      });
    } else {
      const x = ann.date ? contentXForDate(ann.date) : ann.x || 0;
      const newDate = contentXToDateMs(x + dx);
      return this.update(id, {
        date: newDate,
        y: ann.y + dy,
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
    persistAnnotationsForActiveScenario(this._annotations);
  }

  reload() {
    this._annotations = readAnnotationsForActiveScenario();
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
/** @type {AnnotationState|null} */
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
