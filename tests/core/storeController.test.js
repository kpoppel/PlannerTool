import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { StoreController } from '../../www/js/core/StoreController.js';

class FakeHost {
  constructor() {
    this.controllers = [];
    this.updateCount = 0;
  }

  addController(controller) {
    this.controllers.push(controller);
  }

  requestUpdate() {
    this.updateCount += 1;
  }
}

describe('core/StoreController', () => {
  beforeEach(() => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('subscribes on connect and requests update on relevant changes', () => {
    const host = new FakeHost();
    const controller = new StoreController(
      host,
      (state) => state.selection?.projectIds?.length ?? 0
    );

    controller.hostConnected();

    expect(controller.value).toBe(0);
    expect(host.updateCount).toBe(0);

    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(
      (state) => ({
        ...state,
        view: {
          ...state.view,
          options: {
            ...state.view.options,
            unrelatedToggle: true,
          },
        },
      }),
      false,
      'test.unrelatedChange'
    );

    expect(host.updateCount).toBe(0);

    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(
      (state) => ({
        ...state,
        selection: {
          ...state.selection,
          projectIds: ['p-1'],
        },
      }),
      false,
      'test.relevantChange'
    );

    expect(controller.value).toBe(1);
    expect(host.updateCount).toBe(1);
  });

  it('unsubscribes on disconnect', () => {
    const host = new FakeHost();
    const controller = new StoreController(
      host,
      (state) => state.selection?.projectIds?.length ?? 0
    );

    controller.hostConnected();
    controller.hostDisconnected();

    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(
      (state) => ({
        ...state,
        selection: {
          ...state.selection,
          projectIds: ['p-1'],
        },
      }),
      false,
      'test.afterDisconnect'
    );

    expect(host.updateCount).toBe(0);
  });
});
