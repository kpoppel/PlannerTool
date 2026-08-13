import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createPluginStateCommands } from '../../www/js/application/commands/pluginStateCommands.js';
import { store } from '../../www/js/application/store.js';

describe('application/commands/pluginStateCommands', () => {
  beforeEach(() => {
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('store commands persist and restore plugin state with view filtering', async () => {
    const cmd = createPluginStateCommands(store);

    cmd.set('plugin-a', { startDate: '2026-01-01' }, { saveToView: true });
    cmd.set('plugin-b', { temp: true }, { saveToView: false });
    cmd.update('plugin-a', { endDate: '2026-12-31' });

    expect(cmd.get('plugin-a')).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(cmd.captureForView()).toEqual({
      'plugin-a': { startDate: '2026-01-01', endDate: '2026-12-31' },
    });

    await cmd.restoreFromView({ 'plugin-c': { foo: 'bar' } });
    expect(cmd.get('plugin-a')).toBeNull();
    expect(cmd.get('plugin-c')).toEqual({ foo: 'bar' });
  });

  it('clear notifies subscribers and does not implicitly unsubscribe plugin listeners', () => {
    const cmd = createPluginStateCommands(store);
    const pluginListener = vi.fn();
    const allListener = vi.fn();

    const unsubscribe = cmd.subscribe('plugin-a', pluginListener);
    cmd.subscribeAll(allListener);

    cmd.set('plugin-a', { a: 1 });
    cmd.clear('plugin-a');
    cmd.set('plugin-a', { a: 2 });

    expect(pluginListener).toHaveBeenNthCalledWith(1, { a: 1 });
    expect(pluginListener).toHaveBeenNthCalledWith(2, null);
    expect(pluginListener).toHaveBeenNthCalledWith(3, { a: 2 });
    expect(allListener).toHaveBeenCalledWith('plugin-a', null);

    unsubscribe();
    cmd.set('plugin-a', { a: 3 });
    expect(pluginListener).toHaveBeenCalledTimes(3);
  });

  it('clearAll notifies plugin-specific and global subscribers deterministically', () => {
    const cmd = createPluginStateCommands(store);
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const allListener = vi.fn();

    cmd.subscribe('plugin-b', listenerB);
    cmd.subscribe('plugin-a', listenerA);
    cmd.subscribeAll(allListener);

    cmd.set('plugin-b', { b: 1 });
    cmd.set('plugin-a', { a: 1 });
    cmd.clearAll();

    expect(listenerA).toHaveBeenCalledWith(null);
    expect(listenerB).toHaveBeenCalledWith(null);

    const clearCalls = allListener.mock.calls.filter(([, value]) => value === null);
    expect(clearCalls).toEqual([
      ['plugin-a', null],
      ['plugin-b', null],
    ]);
  });
});
