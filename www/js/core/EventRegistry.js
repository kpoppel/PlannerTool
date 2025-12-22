/**
 * EventRegistry - Typed Event Constants
 * Provides Symbol-based event constants mapped to string events
 * Enables type-safe event handling while maintaining backward compatibility
 */

// Feature-related events
export const FeatureEvents = {
  UPDATED: Symbol('feature:updated'),
  CREATED: Symbol('feature:created'),
  DELETED: Symbol('feature:deleted'),
  DATES_CHANGED: Symbol('feature:dates-changed'),
  SELECTED: Symbol('feature:selected')
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

/**
 * EVENT_TYPE_MAP - Maps Symbol constants to string events
 * Used by EventBus to translate typed events to legacy string events
 */
export const EVENT_TYPE_MAP = new Map([
  // Feature events
  [FeatureEvents.UPDATED, 'feature:updated'],
  [FeatureEvents.CREATED, 'feature:created'],
  [FeatureEvents.DELETED, 'feature:deleted'],
  [FeatureEvents.DATES_CHANGED, 'feature:dates-changed'],
  [FeatureEvents.SELECTED, 'feature:selected'],
  
  // Scenario events
  [ScenarioEvents.ACTIVATED, 'scenario:activated'],
  [ScenarioEvents.SAVED, 'scenario:saved'],
  [ScenarioEvents.CREATED, 'scenario:created'],
  [ScenarioEvents.DELETED, 'scenario:deleted'],
  [ScenarioEvents.UPDATED, 'scenario:updated'],
  [ScenarioEvents.LIST, 'scenario:list'],
  
  // Project events
  [ProjectEvents.CHANGED, 'projects:changed'],
  [ProjectEvents.TOGGLED, 'project:toggled'],
  [ProjectEvents.SELECTED, 'project:selected'],
  
  // Team events
  [TeamEvents.CHANGED, 'teams:changed'],
  [TeamEvents.TOGGLED, 'team:toggled'],
  [TeamEvents.SELECTED, 'team:selected'],
  
  // Capacity events
  [CapacityEvents.UPDATED, 'capacity:updated'],
  [CapacityEvents.CALCULATED, 'capacity:calculated'],
  
  // Filter events
  [FilterEvents.CHANGED, 'filters:changed'],
  [FilterEvents.APPLIED, 'filter:applied'],
  [FilterEvents.CLEARED, 'filter:cleared'],
  
  // Drag events
  [DragEvents.START, 'drag:start'],
  [DragEvents.MOVE, 'drag:move'],
  [DragEvents.END, 'drag:end'],
  
  // UI events
  [UIEvents.DETAILS_SHOW, 'details:show'],
  [UIEvents.DETAILS_HIDE, 'details:hide'],
  [UIEvents.MODAL_OPEN, 'modal:open'],
  [UIEvents.MODAL_CLOSE, 'modal:close'],
  
  // App events
  [AppEvents.READY, 'app:ready'],
  [AppEvents.INITIALIZED, 'app:initialized'],
  
  // Config events
  [ConfigEvents.UPDATED, 'config:updated'],
  [ConfigEvents.AUTOSAVE, 'config:autosave'],
  
  // Timeline events
  [TimelineEvents.MONTHS, 'timeline:months'],
  [TimelineEvents.SCALE_CHANGED, 'timeline:scale-changed'],

  // View events
  [ViewEvents.CONDENSED, 'view:condensed'],
  [ViewEvents.DEPENDENCIES, 'view:dependencies'],
  [ViewEvents.CAPACITY_MODE, 'view:capacityMode'],
  [ViewEvents.SORT_MODE, 'view:sortMode'],
  
  // Data events
  [DataEvents.SCENARIOS_CHANGED, 'scenarios:changed'],
  [DataEvents.SCENARIOS_DATA, 'scenarios:data'],
  [DataEvents.LOADED, 'data:loaded'],
  [DataEvents.SAVED, 'data:saved'],
  
  // Color events
  [ColorEvents.CHANGED, 'color:changed'],

  // Plugin events
  [PluginEvents.REGISTERED, 'plugin:registered'],
  [PluginEvents.UNREGISTERED, 'plugin:unregistered'],
  [PluginEvents.ACTIVATED, 'plugin:activated'],
  [PluginEvents.DEACTIVATED, 'plugin:deactivated'],
  
  // State filter events
  [StateFilterEvents.CHANGED, 'states:changed']
]);

/**
 * Register all event type mappings with the EventBus
 * Call this at application startup to enable typed events
 * @param {EventBus} eventBus - EventBus instance to register with
 */
export function registerEventTypes(eventBus) {
  EVENT_TYPE_MAP.forEach((stringEvent, typeConstant) => {
    eventBus.registerEventType(typeConstant, stringEvent);
  });
  console.log(`[EventRegistry] Registered ${EVENT_TYPE_MAP.size} typed event mappings`);
}
