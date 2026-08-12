import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../../www/js/services/ConfigService.js';
import { ConfigEvents } from '../../www/js/core/EventRegistry.js';

describe('disable-autosave helper', () => {
  let service;
  let bus;

  beforeEach(() => {
    bus = {
      emit: vi.fn(),
      on: vi.fn(),
    };

    service = new ConfigService(bus, {
      getLocalPref: vi.fn(async () => null),
      setLocalPref: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    service?.destroy();
  });

  it('disables autosave by switching the interval to zero', () => {
    service.setupAutosave(5, () => {});

    expect(service.isAutosaveEnabled()).toBe(true);
    expect(service.autosaveIntervalMin).toBe(5);

    service.disableAutosave();

    expect(service.isAutosaveEnabled()).toBe(false);
    expect(service.autosaveIntervalMin).toBe(0);
    expect(bus.emit).toHaveBeenCalledWith(ConfigEvents.AUTOSAVE, { autosaveInterval: 0 });
  });
});
