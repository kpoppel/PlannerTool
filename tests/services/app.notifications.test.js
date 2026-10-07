import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { registerFailureNotifications } from '../../www/js/app.js';
import { bus } from '../../www/js/core/EventBus.js';
import { SessionEvents } from '../../www/js/core/EventRegistry.js';
import { DataCommandEvents } from '../../www/js/application/commands/dataCommands.js';
import { store } from '../../www/js/application/store.js';

describe('Application failure notifications', () => {
  let dispose;
  let spinner;

  beforeEach(() => {
    store.setState({ notifications: [] });
    spinner = document.createElement('div');
    spinner.id = 'appSpinner';
    spinner.open = false;
    document.body.appendChild(spinner);
    dispose = registerFailureNotifications();
  });

  afterEach(() => {
    if (dispose !== undefined) dispose();
    spinner.remove();
  });

  it('collects session failures and recovery without dimming the screen', () => {
    bus.emit(SessionEvents.EXPIRED, { message: 'Session could not be renewed.' });
    bus.emit(SessionEvents.REACQUIRED, { ok: false, error: 'Access denied' });
    bus.emit(SessionEvents.REACQUIRED, { ok: true, message: 'Session renewed.' });

    expect(store.getState().notifications.map(entry => entry.severity)).toEqual([
      'success', 'error', 'error',
    ]);
    expect(spinner.open).toBe(false);
  });

  it('collects hydration failures without opening the spinner', () => {
    bus.emit(DataCommandEvents.HYDRATION_FAILED, {
      phase: 'baseline', error: { message: 'Invalid task payload' },
    });

    expect(store.getState().notifications[0].message).toContain('Invalid task payload');
    expect(spinner.open).toBe(false);
  });

  it('collects uncaught browser errors', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Rendering failed' }));

    expect(store.getState().notifications[0].message).toContain('Rendering failed');
    expect(spinner.open).toBe(false);
  });

  it('collects unhandled promise failures', () => {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error('Save failed') });
    window.dispatchEvent(event);

    expect(store.getState().notifications[0].message).toContain('Save failed');
    expect(spinner.open).toBe(false);
  });
});