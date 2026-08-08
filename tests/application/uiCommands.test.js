import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createUiCommands, UiEvents } from '../../www/js/application/commands/uiCommands.js';

describe('application/commands/uiCommands', () => {
  beforeEach(() => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('setDebugFlag updates state and emits an event', () => {
    const bus = { emit: vi.fn() };
    const commands = createUiCommands(store, bus);

    commands.setDebugFlag(true);

    expect(store.getState().view.options.debugFlag).toBe(true);
    expect(bus.emit).toHaveBeenCalledTimes(1);
    expect(bus.emit).toHaveBeenCalledWith(UiEvents.DEBUG_FLAG_SET, { debugFlag: true });
  });
});
