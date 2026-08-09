function cloneValue(value) {
  return value == null ? null : structuredClone(value);
}

function isSerializable(value) {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

export function createLegacyPluginStateCommands(state) {
  return {
    get(pluginId) {
      return state.pluginStateService?.get(pluginId) ?? null;
    },

    set(pluginId, value, opts = {}) {
      return state.pluginStateService?.set(pluginId, value, opts) ?? null;
    },

    update(pluginId, patch, opts = {}) {
      return state.pluginStateService?.update(pluginId, patch, opts) ?? null;
    },

    clear(pluginId) {
      return state.pluginStateService?.clear(pluginId);
    },

    clearAll() {
      return state.pluginStateService?.clearAll();
    },

    captureForView() {
      return state.pluginStateService?.captureForView?.() || {};
    },

    async restoreFromView(pluginStateMap) {
      return state.pluginStateService?.restoreFromView?.(pluginStateMap);
    },

    subscribe(pluginId, cb) {
      return state.pluginStateService?.subscribe?.(pluginId, cb) || (() => {});
    },

    subscribeAll(cb) {
      return state.pluginStateService?.subscribeAll?.(cb) || (() => {});
    },
  };
}

export function createPluginStateCommands(store) {
  const metaByPluginId = new Map();
  const subscribersByPluginId = new Map();
  const allSubscribers = new Set();

  function getMap() {
    return store.getState()?.pluginState || {};
  }

  function notify(pluginId) {
    const nextValue = api.get(pluginId);
    const subs = subscribersByPluginId.get(String(pluginId));
    if (subs) {
      for (const cb of Array.from(subs)) {
        try {
          cb(nextValue);
        } catch {
          // Ignore subscriber errors to keep command execution stable.
        }
      }
    }
    for (const cb of Array.from(allSubscribers)) {
      try {
        cb(String(pluginId), nextValue);
      } catch {
        // Ignore subscriber errors to keep command execution stable.
      }
    }
  }

  const api = {
    get(pluginId) {
      if (!pluginId) return null;
      const value = getMap()[String(pluginId)];
      return value === undefined ? null : cloneValue(value);
    },

    set(pluginId, value, opts = {}) {
      if (!pluginId) throw new Error('pluginId required');
      if (!isSerializable(value)) throw new Error('State must be JSON-serialisable');

      const key = String(pluginId);
      const clone = cloneValue(value);
      store.setState(
        (state) => ({
          ...state,
          pluginState: {
            ...(state.pluginState || {}),
            [key]: clone,
          },
        }),
        false,
        'pluginState.set'
      );

      const meta = metaByPluginId.get(key) || { saveToView: true };
      if (opts.saveToView === false) meta.saveToView = false;
      if (opts.saveToView === true) meta.saveToView = true;
      metaByPluginId.set(key, meta);
      notify(key);
      return api.get(key);
    },

    update(pluginId, patch, opts = {}) {
      if (!pluginId) throw new Error('pluginId required');
      const prev = api.get(pluginId);
      if (typeof prev !== 'object' || prev === null || Array.isArray(prev)) {
        return api.set(pluginId, patch, opts);
      }
      return api.set(pluginId, { ...prev, ...(patch || {}) }, opts);
    },

    clear(pluginId) {
      if (!pluginId) return;
      const key = String(pluginId);
      const current = getMap();
      if (!Object.prototype.hasOwnProperty.call(current, key)) return;

      const next = { ...current };
      delete next[key];
      metaByPluginId.delete(key);

      store.setState(
        (state) => ({
          ...state,
          pluginState: next,
        }),
        false,
        'pluginState.clear'
      );
      notify(key);
    },

    clearAll() {
      const keys = Object.keys(getMap()).sort();
      if (!keys.length) return;
      metaByPluginId.clear();
      store.setState(
        (state) => ({
          ...state,
          pluginState: {},
        }),
        false,
        'pluginState.clearAll'
      );
      for (const key of keys) notify(key);
    },

    captureForView() {
      const snapshot = getMap();
      const out = {};
      for (const [key, value] of Object.entries(snapshot)) {
        const meta = metaByPluginId.get(key) || { saveToView: true };
        if (meta.saveToView === false) continue;
        out[key] = cloneValue(value);
      }
      return out;
    },

    async restoreFromView(pluginStateMap) {
      const nextState =
        pluginStateMap && typeof pluginStateMap === 'object' ? pluginStateMap : {};

      const restored = {};
      for (const [key, value] of Object.entries(nextState)) {
        if (!isSerializable(value)) continue;
        restored[key] = cloneValue(value);
        metaByPluginId.set(String(key), { saveToView: true });
      }

      const previousKeys = Object.keys(getMap());

      store.setState(
        (state) => ({
          ...state,
          pluginState: restored,
        }),
        false,
        'pluginState.restoreFromView'
      );

      const nextKeys = new Set(Object.keys(restored));
      const changedKeys = new Set([...previousKeys, ...nextKeys]);
      for (const key of changedKeys) notify(key);
    },

    subscribe(pluginId, cb) {
      if (!pluginId || typeof cb !== 'function') return () => {};
      const key = String(pluginId);
      if (!subscribersByPluginId.has(key)) {
        subscribersByPluginId.set(key, new Set());
      }
      subscribersByPluginId.get(key).add(cb);
      return () => subscribersByPluginId.get(key)?.delete(cb);
    },

    subscribeAll(cb) {
      if (typeof cb !== 'function') return () => {};
      allSubscribers.add(cb);
      return () => allSubscribers.delete(cb);
    },
  };

  return api;
}