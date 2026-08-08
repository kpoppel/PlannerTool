import { store } from '../application/store.js';

export class StoreController {
  constructor(host, selector, options = {}) {
    this._host = host;
    this._selector = selector;
    this._equalityFn = options.equalityFn || Object.is;
    this._unsubscribe = null;
    this.value = undefined;

    host.addController(this);
  }

  hostConnected() {
    this.value = this._selector(store.getState());
    this._unsubscribe = store.subscribe(
      this._selector,
      (nextValue) => {
        this.value = nextValue;
        this._host.requestUpdate();
      },
      { equalityFn: this._equalityFn }
    );
  }

  hostDisconnected() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }
}
