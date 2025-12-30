/**
 * Module: EventBus
 * Intent: lightweight event pub/sub mechanism used across the app.
 * Supports Symbol-typed events (preferred) and namespace listeners
 * for quick subscription to groups like 'feature:*'.
 * Data schemes:
 * - `listeners`: Map<EventIdentifier, Set<Function>>
 * - `namespaceListeners`: Map<string, Set<Function>>
 * - `history`: Array<{ts: number, event: any, payload: any}>
 */
export class EventBus {
  listeners = new Map(); // Map<Symbol|string, Set<Function>>
  namespaceListeners = new Map(); // Map<string, Set<Function>>
  historyEnabled = false;
  history = [];
  historyLimit = 1000;

  /**
   * Extract namespace from a Symbol event (e.g. Symbol('feature:created') -> 'feature').
   * @param {Symbol|string} event - Symbol with description or legacy string event
   * @returns {string|null} namespace portion or null when not available
   * @private
   */
  _getNamespaceFromSymbol(event) {
    return event && typeof event.description === 'string' ? event.description.split(':')[0] : null;
  }


  /**
   * Subscribe to all events within a namespace (e.g., 'feature').
   * @param {string} namespace - namespace key (left side of ':')
   * @param {Function} handler - callback invoked with payload
   * @returns {Function} unsubscribe function
   */
  onNamespace(namespace, handler) {
    const set = this.namespaceListeners.get(namespace) || new Set();
    set.add(handler);
    this.namespaceListeners.set(namespace, set);
    return () => this.offNamespace(namespace, handler);
  }

  offNamespace(namespace, handler) {
    this.namespaceListeners.get(namespace)?.delete(handler);
  }

  /**
   * Subscribe to a single event identifier.
   * @param {Symbol|string} event - identifier
   * @param {Function} handler - callback(payload)
   * @returns {Function} unsubscribe
   */
  on(event, handler) { 
    const set = this.listeners.get(event) || new Set();
    set.add(handler);
    this.listeners.set(event, set);
    return () => this.off(event, handler);
  }
  
  /**
   * Unsubscribe from an event
   * @param {Symbol|string} event - Event identifier
   * @param {Function} handler - Event handler function
   * @returns {void}
   */
  off(event, handler) { 
    this.listeners.get(event)?.delete(handler);
  }
  
  /**
   * Emit an event
   * @param {Symbol|string} event - Event identifier
   * @param {any} payload - Event payload
   * @returns {void}
   */
  emit(event, payload) { 
    if (this.historyEnabled) {
      this.history.push({ ts: Date.now(), event, payload });
      if (this.history.length > this.historyLimit) this.history = this.history.slice(-this.historyLimit);
    }

    const exact = this.listeners.get(event);
    if (exact) {
      for (const h of exact) {
        try { h(payload); } catch (e) { console.error('Event handler error', event, e); }
      }
    }

    const ns = this._getNamespaceFromSymbol(event);
    const nset = ns && this.namespaceListeners.get(ns);
    if (nset) {
      for (const h of nset) {
        try { h(payload); } catch (e) { console.error('Namespace handler error', ns, e); }
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
    let unsub;
    unsub = this.on(event, (...args) => { try { handler(...args); } finally { unsub(); } });
    return unsub;
  }

  /**
   * Enable console warnings when string-based events are used (legacy usage)
   * @returns {void}
   */
  enableStringWarnings() {
    console.log('[eventBus] EventBus will warn on string events (legacy usage)');
    this.warnOnStringEvents = true;
  }

  /**
   * Disable string event warnings
   * @returns {void}
   */
  disableStringWarnings() { this.warnOnStringEvents = false; }

  /**
   * Enable in-memory event history logging (keeps recent N events)
   * @param {number} [limit=1000] - maximum number of events to keep
   * @returns {void}
   */
  enableHistoryLogging(limit = 1000) {
    console.log(`[eventBus] Event history logging enabled (limit: ${limit})`);
    this.historyEnabled = true;
    this.historyLimit = limit;
  }

  /**
   * Disable history logging
   * @returns {void}
   */
  disableHistoryLogging() { this.historyEnabled = false; }

  /**
   * Return a shallow copy of the current event history
   * @returns {Array<{ts:number,event:any,payload:any}>}
   */
  getEventHistory() { return Array.from(this.history); }
}

// Export a single shared bus instance on the global scope so tests and
// module-cache-busted imports still operate on the same EventBus.
const GLOBAL_BUS_KEY = '__PlannerTool_EventBus__';
export const bus = globalThis[GLOBAL_BUS_KEY] ?? (globalThis[GLOBAL_BUS_KEY] = new EventBus());
