/**
 * Small immutable application store.
 *
 * The store deliberately contains no domain rules. Commands own mutation
 * policy; selectors own derivation. This gives UI code a stable subscription
 * boundary without coupling it to individual services or the event bus.
 */

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneState(value) {
  if (Array.isArray(value)) return value.map(cloneState);
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneState(child)]));
}

function freezeState(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeState);
  } else if (isPlainObject(value)) {
    Object.values(value).forEach(freezeState);
  }
  return Object.freeze(value);
}

function statesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => statesEqual(value, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && statesEqual(left[key], right[key])
    )
  );
}

function assertRootState(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('AppStore state must be a plain object');
  }
}

/**
 * Holds canonical application state and notifies selector subscribers after a
 * committed transaction. State must be JSON-like: plain objects, arrays, and
 * primitive values. Maps and Sets belong in selectors/indexes, not canonical
 * mutable state.
 */
export class AppStore {
  constructor(initialState = {}) {
    assertRootState(initialState);
    this._state = freezeState(cloneState(initialState));
    this._revision = 0;
    this._subscribers = new Set();
    this._isUpdating = false;
    this._destroyed = false;
  }

  get revision() {
    return this._revision;
  }

  getState() {
    return this._state;
  }

  /**
   * Apply an atomic state transition.
   *
   * The reducer receives a detached mutable draft. It may mutate that draft or
   * return a replacement root state. No notifications occur when the resulting
   * state is structurally unchanged.
   *
   * @param {string} label Human-readable command/transaction name.
   * @param {(draft: object, previous: object) => object|void} reducer
   * @returns {boolean} True when a new state was committed.
   */
  update(label, reducer) {
    if (this._destroyed) throw new Error('Cannot update a destroyed AppStore');
    if (typeof label !== 'string' || !label.trim()) {
      throw new TypeError('AppStore update requires a non-empty label');
    }
    if (typeof reducer !== 'function') {
      throw new TypeError('AppStore update requires a reducer function');
    }
    if (this._isUpdating) {
      throw new Error(`Nested AppStore update is not allowed (${label})`);
    }

    const previous = this._state;
    const draft = cloneState(previous);
    this._isUpdating = true;
    let replacement;
    try {
      replacement = reducer(draft, previous);
    } finally {
      this._isUpdating = false;
    }

    const next = replacement === undefined ? draft : replacement;
    assertRootState(next);
    if (statesEqual(previous, next)) return false;

    this._state = freezeState(cloneState(next));
    this._revision += 1;
    this._notify({ label, previous, state: this._state, revision: this._revision });
    return true;
  }

  /**
   * Subscribe to a derived state value. The listener is invoked only after the
   * selected value changes according to the supplied equality comparison.
   *
   * @param {(state: object) => unknown} selector
   * @param {(value: unknown, previousValue: unknown, change: object) => void} listener
   * @param {{ equals?: (left: unknown, right: unknown) => boolean, emitCurrent?: boolean }} [options]
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(selector, listener, options = {}) {
    if (this._destroyed) throw new Error('Cannot subscribe to a destroyed AppStore');
    if (typeof selector !== 'function' || typeof listener !== 'function') {
      throw new TypeError('AppStore subscriptions require selector and listener functions');
    }

    const subscriber = {
      selector,
      listener,
      equals: options.equals || Object.is,
      value: selector(this._state),
    };
    this._subscribers.add(subscriber);

    if (options.emitCurrent) {
      listener(subscriber.value, undefined, {
        label: 'initial',
        previous: undefined,
        state: this._state,
        revision: this._revision,
      });
    }

    return () => this._subscribers.delete(subscriber);
  }

  destroy() {
    this._subscribers.clear();
    this._destroyed = true;
  }

  _notify(change) {
    for (const subscriber of [...this._subscribers]) {
      const nextValue = subscriber.selector(this._state);
      if (subscriber.equals(subscriber.value, nextValue)) continue;

      const previousValue = subscriber.value;
      subscriber.value = nextValue;
      subscriber.listener(nextValue, previousValue, change);
    }
  }
}
