/**
 * Module: EventRegistry
 * Intent: central place for typed Symbol event constants used across the app.
 * Purpose: prefer Symbols to avoid accidental collisions with string events,
 * while keeping readable descriptions for debugging and namespace extraction.
 * Exports: grouped event collections (e.g. FeatureEvents) where each
 * value is a unique Symbol('namespace:action').
 *
 * @typedef {Object<string, Symbol>} EventGroup
 */

// Feature-related events
export const FeatureEvents = {
  UPDATED: Symbol('feature:updated'),
  CREATED: Symbol('feature:created'),
  DELETED: Symbol('feature:deleted'),
  DATES_CHANGED: Symbol('feature:dates-changed'),
  SELECTED: Symbol('feature:selected'),
  CAPACITY_UPDATED: Symbol('feature:capacity-updated')
};

// Scenario-related events
export const ScenarioEvents = {
  ACTIVATED: Symbol('scenario:activated'),
  SAVED: Symbol('scenario:saved'),
  CREATED: Symbol('scenario:created'),
  DELETED: Symbol('scenario:deleted'),
  UPDATED: Symbol('scenario:updated'),
  LIST: Symbol('scenario:list')
};

// Project-related events
export const ProjectEvents = {
  CHANGED: Symbol('projects:changed'),
  TOGGLED: Symbol('project:toggled'),
  SELECTED: Symbol('project:selected')
};

// Plugin-related events
export const PluginEvents = {
  REGISTERED: Symbol('plugin:registered'),
  UNREGISTERED: Symbol('plugin:unregistered'),
  ACTIVATED: Symbol('plugin:activated'),
  DEACTIVATED: Symbol('plugin:deactivated')
};

// Team-related events
export const TeamEvents = {
  CHANGED: Symbol('teams:changed'),
  TOGGLED: Symbol('team:toggled'),
  SELECTED: Symbol('team:selected')
};

// Capacity-related events
export const CapacityEvents = {
  UPDATED: Symbol('capacity:updated'),
  CALCULATED: Symbol('capacity:calculated')
};

// Filter-related events
export const FilterEvents = {
  CHANGED: Symbol('filters:changed'),
  APPLIED: Symbol('filter:applied'),
  CLEARED: Symbol('filter:cleared')
};

// Drag-and-drop events
export const DragEvents = {
  START: Symbol('drag:start'),
  MOVE: Symbol('drag:move'),
  END: Symbol('drag:end')
};

// UI events
export const UIEvents = {
  DETAILS_SHOW: Symbol('details:show'),
  DETAILS_HIDE: Symbol('details:hide'),
  MODAL_OPEN: Symbol('modal:open'),
  MODAL_CLOSE: Symbol('modal:close')
};

// View-specific UI events (legacy view: namespace)
export const ViewEvents = {
  CONDENSED: Symbol('view:condensed'),
  DEPENDENCIES: Symbol('view:dependencies'),
  CAPACITY_MODE: Symbol('view:capacityMode'),
  SORT_MODE: Symbol('view:sortMode')
};

// App lifecycle events
export const AppEvents = {
  READY: Symbol('app:ready'),
  INITIALIZED: Symbol('app:initialized')
};

// Config events
export const ConfigEvents = {
  UPDATED: Symbol('config:updated'),
  AUTOSAVE: Symbol('config:autosave')
};

// Timeline events
export const TimelineEvents = {
  MONTHS: Symbol('timeline:months'),
  SCALE_CHANGED: Symbol('timeline:scale-changed')
};

// Data provider events
export const DataEvents = {
  SCENARIOS_CHANGED: Symbol('scenarios:changed'),
  SCENARIOS_DATA: Symbol('scenarios:data'),
  LOADED: Symbol('data:loaded'),
  SAVED: Symbol('data:saved')
};

// Color events
export const ColorEvents = {
  CHANGED: Symbol('color:changed')
};

// States filter events
export const StateFilterEvents = {
  CHANGED: Symbol('states:changed')
};
