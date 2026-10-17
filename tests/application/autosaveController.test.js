import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigEvents } from '../../www/js/core/EventRegistry.js';
import { EventBus } from '../../www/js/core/EventBus.js';
import { createAutosaveController } from '../../www/js/application/autosaveController.js';

describe('application/autosaveController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves dirty editable scenarios on the configured interval and stops when disabled', async () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const saveScenario = vi.fn().mockResolvedValue({ ok: true });
    const controller = createAutosaveController({
      bus,
      getChangedScenarioIds: () => ['s1', 's2'],
      getScenarioAccess: (id) => ({ canEdit: id === 's1' }),
      saveScenario,
      getLocalPref: vi.fn().mockResolvedValue(5),
      notify: vi.fn(),
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(saveScenario).toHaveBeenCalledTimes(1);
    expect(saveScenario).toHaveBeenCalledWith('s1');

    bus.emit(ConfigEvents.AUTOSAVE, { autosaveInterval: 1 });
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(saveScenario).toHaveBeenCalledTimes(2);

    bus.emit(ConfigEvents.AUTOSAVE, { autosaveInterval: 0 });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(saveScenario).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('notifies when a save fails and retries on the next interval', async () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const saveScenario = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { message: 'offline' } })
      .mockResolvedValueOnce({ ok: true });
    const notify = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = createAutosaveController({
      bus,
      getChangedScenarioIds: () => ['s1'],
      getScenarioAccess: () => ({ canEdit: true }),
      saveScenario,
      getLocalPref: vi.fn().mockResolvedValue(1),
      notify,
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      source: 'Scenario autosave',
      severity: 'error',
      message: expect.stringContaining('changes remain unsaved'),
    }));

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(saveScenario).toHaveBeenCalledTimes(2);
    controller.stop();
    consoleError.mockRestore();
  });
});