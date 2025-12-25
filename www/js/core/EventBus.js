export class EventBus {
  constructor() { 
    this.listeners = new Map();
    // listeners: Map<Symbol, Set<Function>>
    // namespaceListeners: Map<string, Set<Function>> for simple wildcard support
    this.namespaceListeners = new Map();
    this.historyEnabled = false;
    this.history = [];
    this.historyLimit = 1000;
  }
  
  /**
   * Extract namespace from a Symbol event (Symbol(description) where description is 'feature:created')
   * @param {Symbol} event
   * @returns {string|null} namespace (e.g. 'feature') or null
   */
  _getNamespaceFromSymbol(event) {
    if (typeof event !== 'symbol') return null;
    const desc = event.description || '';
    const colonIndex = desc.indexOf(':');
    if (colonIndex > 0) {
      return desc.substring(0, colonIndex);
    }
    return null;
  }

  /**
   * Subscribe to all events within a namespace (e.g., 'feature')
   * @param {string} namespace
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  onNamespace(namespace, handler) {
    if (!this.namespaceListeners.has(namespace)) this.namespaceListeners.set(namespace, new Set());
    this.namespaceListeners.get(namespace).add(handler);
    return () => this.offNamespace(namespace, handler);
  }

  offNamespace(namespace, handler) {
    if (!this.namespaceListeners.has(namespace)) return;
    this.namespaceListeners.get(namespace).delete(handler);
  }

  /**
   * Register a typed event mapping for compatibility with older string-based listeners.
   * This merely stores the mapping; EventBus now operates on Symbols directly.
   */
  registerEventType(symbol, stringRepresentation) {
    // no-op for now, kept for API compatibility
    return;
  }
  
  /**
   * Subscribe to an event
   * @param {Symbol|string} event - Event identifier
   * @param {Function} handler - Event handler function
   * @returns {Function} Unsubscribe function
   */
  on(event, handler) { 
    if (typeof event !== 'symbol') {
      throw new Error('[EventBus] Events must be Symbol-typed.');
    }
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }
  
  /**
   * Unsubscribe from an event
   * @param {Symbol|string} event - Event identifier
   * @param {Function} handler - Event handler function
   */
  off(event, handler) { 
    if (typeof event !== 'symbol') {
      throw new Error('[EventBus] Events must be Symbol-typed.');
    }
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(handler);
    }
  }
  
  /**
   * Emit an event
   * @param {Symbol|string} event - Event identifier
   * @param {any} payload - Event payload
   */
  emit(event, payload) { 
    if (typeof event !== 'symbol') {
      throw new Error('[EventBus] Events must be Symbol-typed.');
    }

    if (this.historyEnabled) {
      try {
        this.history.push({ ts: Date.now(), event: event, payload });
        if (this.history.length > this.historyLimit) {
          this.history.splice(0, this.history.length - this.historyLimit);
        }
      } catch (e) { /* ignore history errors */ }
    }
    
    // Trigger exact match listeners
    if (this.listeners.has(event)) {
      for (const h of this.listeners.get(event)) {
        try {
          h(payload);
        } catch (e) {
          console.error('Event handler error', event, e);
        }
      }
    }
    
    // Trigger namespace listeners (e.g., namespace 'feature' for Symbol('feature:created'))
    const ns = this._getNamespaceFromSymbol(event);
    if (ns && this.namespaceListeners.has(ns)) {
      for (const h of this.namespaceListeners.get(ns)) {
        try {
          h(payload);
        } catch (e) {
          console.error('Namespace handler error', ns, e);
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
