/**
 * Tests for Sidebar behaviour when entering/leaving packed display mode.
 *
 * When packed mode is activated the sidebar must:
 *   1. Uncheck the schedule → unplanned task-filter option.
 *   2. Disable (grey out) that option so the user cannot re-enable it.
 *
 * When packed mode is left the sidebar must:
 *   3. Restore the unplanned filter to whatever it was before packed mode.
 *   4. Re-enable (un-grey) the option.
 */
import { expect } from '@esm-bundle/chai';
import '../../www/js/components/Sidebar.lit.js';
import { state } from '../../www/js/services/State.js';
import { bus } from '../../www/js/core/EventBus.js';
import { ViewEvents } from '../../www/js/core/EventRegistry.js';

// Helper: emit a ViewEvents.DISPLAY_MODE event the same way ViewService does.
function emitDisplayMode(mode, oldMode) {
  bus.emit(ViewEvents.DISPLAY_MODE, { mode, oldMode });
}

describe('Sidebar – packed mode disables schedule.unplanned', () => {
  let sidebar;
  let origDisplayMode;

  beforeEach(async () => {
    await customElements.whenDefined('app-sidebar');
    sidebar = document.createElement('app-sidebar');
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;

    origDisplayMode = state._viewService._displayMode;

    // Ensure unplanned starts as checked (default state)
    if (state.taskFilterService) {
      state.taskFilterService.setFilter('schedule', 'unplanned', true);
      sidebar.taskFilters = state.taskFilterService.getFilters();
    }
  });

  afterEach(() => {
    sidebar.remove();
    // Restore view service mode without emitting DISPLAY_MODE to avoid side-effects
    state._viewService._displayMode = origDisplayMode;
    // Restore unplanned filter to true
    if (state.taskFilterService) {
      state.taskFilterService.setFilter('schedule', 'unplanned', true);
    }
  });

  it('entering packed mode unchecks schedule.unplanned in the task filter service', () => {
    emitDisplayMode('packed', 'normal');

    const filters = state.taskFilterService.getFilters();
    expect(filters.schedule.unplanned).to.equal(
      false,
      'unplanned filter must be false when packed mode is active'
    );
  });

  it('entering packed mode marks schedule.unplanned as disabled in _disabledSidebar', () => {
    emitDisplayMode('packed', 'normal');

    const disabled = sidebar._disabledSidebar || {};
    const scheduleDisabled = disabled.taskFilters?.schedule || [];
    expect(scheduleDisabled).to.include(
      'unplanned',
      'schedule.unplanned must appear in disabled list when packed mode is active'
    );
  });

  it('leaving packed mode restores unplanned filter to its previous value (was true)', () => {
    // Enter packed → unplanned becomes false
    emitDisplayMode('packed', 'normal');
    // Leave packed → should restore to true
    emitDisplayMode('normal', 'packed');

    const filters = state.taskFilterService.getFilters();
    expect(filters.schedule.unplanned).to.equal(
      true,
      'unplanned filter must be restored to true after leaving packed mode'
    );
  });

  it('leaving packed mode removes schedule.unplanned from the disabled list', () => {
    emitDisplayMode('packed', 'normal');
    emitDisplayMode('normal', 'packed');

    const disabled = sidebar._disabledSidebar || {};
    const scheduleDisabled = disabled.taskFilters?.schedule || [];
    expect(scheduleDisabled).to.not.include(
      'unplanned',
      'schedule.unplanned must not be disabled after leaving packed mode'
    );
  });

  it('if unplanned was already false before packed mode, it stays false after leaving', () => {
    // Manually uncheck before entering packed mode
    state.taskFilterService.setFilter('schedule', 'unplanned', false);
    sidebar.taskFilters = state.taskFilterService.getFilters();

    emitDisplayMode('packed', 'normal');
    emitDisplayMode('compact', 'packed');

    const filters = state.taskFilterService.getFilters();
    expect(filters.schedule.unplanned).to.equal(
      false,
      'unplanned filter must stay false if it was false before packed mode'
    );
  });

  it('switching directly between packed and packed is a no-op', () => {
    emitDisplayMode('packed', 'normal');

    // Simulate a second DISPLAY_MODE event with same mode (shouldn't break)
    emitDisplayMode('packed', 'packed');

    const filters = state.taskFilterService.getFilters();
    expect(filters.schedule.unplanned).to.equal(
      false,
      'unplanned filter must still be false when re-entering packed from packed'
    );
  });
});
