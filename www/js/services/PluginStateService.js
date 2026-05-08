/**
 * PluginStateService
 * Simple in-memory session-only store for plugin state.
 * Plugins may set/get JSON-serialisable objects keyed by plugin id.
 * The service exposes `captureForView()` and `restoreFromView()` so
 * `ViewManagementService` can include plugin state when saving/restoring views.
 */
export class PluginStateService {
  constructor(bus, dataService) {
    this._bus = bus;
    this._dataService = dataService;
    this._map = new Map(); // pluginId -> state object
    this._meta = new Map(); // pluginId -> { saveToView: boolean }
    this._subs = new Map(); // pluginId -> Set(subscribers)
    this._allSubs = new Set();
  }

  async init() {
    // Session-only by default. No persisted load required.
    this._map = new Map();
    this._meta = new Map();
    this._subs = new Map();
    this._allSubs = new Set();
    return;
  }

  _isSerializable(obj) {
    try {
      JSON.stringify(obj);
      return true;
    } catch (e) {
      return false;
    }
  }

  _clone(obj) {
    return obj == null ? null : JSON.parse(JSON.stringify(obj));
  }

  get(pluginId) {
    if (!pluginId) return null;
    const v = this._map.get(pluginId);
    return v === undefined ? null : this._clone(v);
  }

  /**
   * Set full plugin state. `opts.saveToView` controls whether this key
   * will be included in `captureForView()` (default true).
   */
  set(pluginId, state, opts = {}) {
    if (!pluginId) throw new Error('pluginId required');
    if (!this._isSerializable(state)) throw new Error('State must be JSON-serialisable');
    const clone = this._clone(state);
    this._map.set(pluginId, clone);
    const meta = this._meta.get(pluginId) || { saveToView: true };
    if (opts.saveToView === false) meta.saveToView = false;
    if (opts.saveToView === true) meta.saveToView = true;
    this._meta.set(pluginId, meta);
    this._notify(pluginId, clone);
    return this.get(pluginId);
  }

  update(pluginId, patch, opts = {}) {
    if (!pluginId) throw new Error('pluginId required');
    const prev = this._map.get(pluginId) || {};
    if (typeof prev !== 'object' || prev === null || Array.isArray(prev)) {
      // Replace non-object state
      return this.set(pluginId, patch, opts);
    }
    const merged = Object.assign({}, prev, patch || {});
    return this.set(pluginId, merged, opts);
  }

  clear(pluginId) {
    if (!pluginId) return;
    this._map.delete(pluginId);
    this._meta.delete(pluginId);
    this._notify(pluginId, null);
  }

  clearAll() {
    const keys = Array.from(this._map.keys());
    for (const k of keys) this.clear(k);
  }

  captureForView() {
    const out = {};
    for (const [k, v] of this._map.entries()) {
      const meta = this._meta.get(k) || { saveToView: true };
      if (meta.saveToView === false) continue;
      try {
        out[k] = this._clone(v);
      } catch (e) {
        // Skip non-serialisable entries
      }
    }
    return out;
  }

  async restoreFromView(pluginStateMap) {
    const nextState =
      pluginStateMap && typeof pluginStateMap === 'object' ? pluginStateMap : {};

    for (const pluginId of Array.from(this._map.keys())) {
      const meta = this._meta.get(pluginId) || { saveToView: true };
      if (meta.saveToView === false) continue;
      this.clear(pluginId);
    }

    for (const k of Object.keys(nextState)) {
      try {
        // Accept only serialisable values
        if (!this._isSerializable(nextState[k])) continue;
        // Mark as saveable (it came from a saved view)
        this.set(k, nextState[k], { saveToView: true });
      } catch (e) {
        // ignore individual failures
        console.warn('[PluginStateService] Failed to restore state for', k, e);
      }
    }
  }

  subscribe(pluginId, cb) {
    if (!pluginId || typeof cb !== 'function') return () => {};
    if (!this._subs.has(pluginId)) this._subs.set(pluginId, new Set());
    this._subs.get(pluginId).add(cb);
    return () => this._subs.get(pluginId).delete(cb);
  }

  subscribeAll(cb) {
    if (typeof cb !== 'function') return () => {};
    this._allSubs.add(cb);
    return () => this._allSubs.delete(cb);
  }

  _notify(pluginId, value) {
    const subs = this._subs.get(pluginId);
    if (subs) {
      for (const cb of Array.from(subs)) {
        try {
          cb(this.get(pluginId));
        } catch (e) {
          console.warn('[PluginStateService] subscriber threw', e);
        }
      }
    }
    for (const cb of Array.from(this._allSubs)) {
      try {
        cb(pluginId, this.get(pluginId));
      } catch (e) {
        console.warn('[PluginStateService] all-subscriber threw', e);
      }
    }
  }
}
