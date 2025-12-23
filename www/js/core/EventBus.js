export class EventBus {
  constructor() { 
    this.listeners = new Map();
    this.eventTypeMap = new Map(); // Maps Symbol constants to string events
    this.warnOnStringEvents = false;
    this.historyEnabled = false;
    this.history = [];
    this.historyLimit = 1000;
  }
  
  /**
   * Register a typed event mapping
   * @param {Symbol} typeConstant - Symbol constant for the event
   * @param {string} stringEvent - String representation of the event
   */
  registerEventType(typeConstant, stringEvent) {
    this.eventTypeMap.set(typeConstant, stringEvent);
  }
  
  /**
   * Convert event (Symbol or string) to string
   * @param {Symbol|string} event - Event identifier
   * @returns {string} String representation
   */
  _toEventString(event) {
    if (typeof event === 'string') return event;
    if (this.eventTypeMap.has(event)) return this.eventTypeMap.get(event);
    return event.toString(); // Fallback: convert Symbol to string
  }
  
  /**
   * Get wildcard pattern key for an event
   * @param {string} eventStr - Event string (e.g., 'feature:created')
   * @returns {string|null} Wildcard key (e.g., 'feature:*') or null
   */
  _getWildcardKey(eventStr) {
    const colonIndex = eventStr.indexOf(':');
    if (colonIndex > 0) {
      return eventStr.substring(0, colonIndex) + ':*';
    }
    return null;
  }
  
  /**
   * Subscribe to an event
   * @param {Symbol|string} event - Event identifier
   * @param {Function} handler - Event handler function
   * @returns {Function} Unsubscribe function
   */
  on(event, handler) { 
    if (typeof event === 'string' && this.warnOnStringEvents) {
      console.warn('[EventBus] Subscribing with string event:', event);
    }
    const eventStr = this._toEventString(event);
    if (!this.listeners.has(eventStr)) {
      this.listeners.set(eventStr, new Set());
    }
    this.listeners.get(eventStr).add(handler); 
    return () => this.off(eventStr, handler); 
  }
  
  /**
   * Unsubscribe from an event
   * @param {Symbol|string} event - Event identifier
   * @param {Function} handler - Event handler function
   */
  off(event, handler) { 
    const eventStr = this._toEventString(event);
    if (this.listeners.has(eventStr)) {
      this.listeners.get(eventStr).delete(handler);
    }
  }
  
  /**
   * Emit an event
   * @param {Symbol|string} event - Event identifier
   * @param {any} payload - Event payload
   */
  emit(event, payload) { 
    const eventStr = this._toEventString(event);
    if (typeof event === 'string' && this.warnOnStringEvents) {
      console.warn('[EventBus] Emitting string event:', eventStr);
    }

    if (this.historyEnabled) {
      try {
        this.history.push({ ts: Date.now(), event: eventStr, payload });
        if (this.history.length > this.historyLimit) {
          this.history.splice(0, this.history.length - this.historyLimit);
        }
      } catch (e) { /* ignore history errors */ }
    }
    
    // Trigger exact match listeners
    if (this.listeners.has(eventStr)) { 
      for (const h of this.listeners.get(eventStr)) { 
        try { 
          h(payload); 
        } catch (e) { 
          console.error('Event handler error', eventStr, e); 
        } 
      } 
    }
    
    // Trigger wildcard listeners (e.g., 'feature:*' for 'feature:created')
    const wildcardKey = this._getWildcardKey(eventStr);
    if (wildcardKey && this.listeners.has(wildcardKey)) {
      for (const h of this.listeners.get(wildcardKey)) {
        try {
          h(payload);
        } catch (e) {
          console.error('Wildcard handler error', wildcardKey, e);
        }
      }
    }
  }

  /**
   * Subscribe to an event for a single occurrence
   * @param {Symbol|string} event - Event identifier
   * @param {Function} handler - Event handler function
   * @returns {Function} Unsubscribe function
   */
  once(event, handler) {
    const unsub = this.on(event, (...args) => {
      try {
        handler(...args);
      } finally {
        unsub();
      }
    });
    return unsub;
  }

  /**
   * Enable console warnings when string-based events are used
   */
  enableStringWarnings() {
    console.log('[eventBus] EventBus will warn on string events (legacy usage)');
    this.warnOnStringEvents = true;
  }

  disableStringWarnings() { this.warnOnStringEvents = false; }

  /**
   * Enable in-memory event history logging (keeps recent N events)
   * @param {number} limit - maximum number of events to keep
   */
  enableHistoryLogging(limit = 1000) {
    console.log(`[eventBus] Event history logging enabled (limit: ${limit})`);
    this.historyEnabled = true;
    this.historyLimit = limit;
  }

  disableHistoryLogging() { this.historyEnabled = false; }

  /**
   * Return a shallow copy of the current event history
   */
  getEventHistory() { return Array.from(this.history); }
}

// Export a single shared bus instance on the global scope so tests and
// module-cache-busted imports still operate on the same EventBus.
const GLOBAL_BUS_KEY = '__PlannerTool_EventBus__';
let _globalBus = globalThis[GLOBAL_BUS_KEY];
if (!_globalBus) {
  _globalBus = new EventBus();
  globalThis[GLOBAL_BUS_KEY] = _globalBus;
}
export const bus = _globalBus;

// Synchronously register typed event mappings so tests and modules that import
// the bus directly get the mappings immediately (avoids async race conditions).
import { EVENT_TYPE_MAP } from './EventRegistry.js';
import { featureFlags } from '../config.js';
EVENT_TYPE_MAP.forEach((stringEvent, typeConstant) => {
  // Avoid double-registration if already present
  if (!bus.eventTypeMap.has(typeConstant)) {
    bus.registerEventType(typeConstant, stringEvent);
  }
});
console.log(`[EventBus] Auto-registered ${EVENT_TYPE_MAP.size} typed event mappings`);
