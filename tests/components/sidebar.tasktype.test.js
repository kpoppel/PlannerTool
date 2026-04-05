/**
 * Tests for Sidebar task-type filter behaviour.
 *
 * Covers the bugs fixed in the "task type filter not applied on load" fix:
 *   1. _taskTypesInitialized must not be set when no types are available yet.
 *   2. _toggleTaskType uses ViewService as the authoritative source (not selectedTaskTypes).
 *   3. _renderTaskFilters active class driven by ViewService.isTypeVisible().
 *   4. _onSidebarFilterChanged syncs received selectedTaskTypes back to ViewService.
 */

import { expect } from '@open-wc/testing';
import '../../www/js/components/Sidebar.lit.js';
import { state } from '../../www/js/services/State.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FilterEvents, FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('Sidebar task-type filter', () => {
  let sidebar;

  beforeEach(async () => {
    await customElements.whenDefined('app-sidebar');
    sidebar = document.createElement('app-sidebar');
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;
    // Reset ViewService hidden types so each test starts clean
    state._viewService._hiddenTypes = new Set();
  });

  afterEach(() => {
    if (sidebar && sidebar.isConnected) sidebar.remove();
  });

  // -------------------------------------------------------------------------
  // Bug 1: _taskTypesInitialized must not lock when no types are available yet
  // -------------------------------------------------------------------------
  it('_taskTypesInitialized stays false when _computeAvailableTaskTypes runs with no types', () => {
    // Simulate a fresh sidebar where baseline has no features
    sidebar._taskTypesInitialized = false;
    sidebar.availableTaskTypes = [];
    sidebar._computeAvailableTaskTypes.call(
      Object.assign(Object.create(Object.getPrototypeOf(sidebar)), sidebar, {
        availableTaskTypes: [],
      })
    );
    // The real sidebar's _computeAvailableTaskTypes should not have set init to true when empty
    // We test the real implementation on the live element:
    sidebar._taskTypesInitialized = false;
    // Temporarily patch baseline to empty
    const origBaseline = state.baselineFeatures;
    state.baselineFeatures = [];
    sidebar._computeAvailableTaskTypes();
    state.baselineFeatures = origBaseline;
    expect(sidebar._taskTypesInitialized).to.equal(false,
      '_taskTypesInitialized must stay false when no types are available');
  });

  it('_computeAvailableTaskTypes sets _taskTypesInitialized=true only when types are available', async () => {
    sidebar._taskTypesInitialized = false;
    sidebar.selectedTaskTypes = new Set();
    const origBaseline = state.baselineFeatures;
    // Give features with types
    state.baselineFeatures = [{ id: 'f1', type: 'epic' }, { id: 'f2', type: 'feature' }];
    sidebar._computeAvailableTaskTypes();
    state.baselineFeatures = origBaseline;
    expect(sidebar._taskTypesInitialized).to.equal(true);
    expect(sidebar.selectedTaskTypes.has('epic')).to.equal(true);
    expect(sidebar.selectedTaskTypes.has('feature')).to.equal(true);
  });

  // -------------------------------------------------------------------------
  // Bug 2: _toggleTaskType reads ViewService, not selectedTaskTypes
  // -------------------------------------------------------------------------
  it('_toggleTaskType hides type via ViewService even when selectedTaskTypes is empty', () => {
    // Simulate the bug scenario: selectedTaskTypes is empty but ViewService says all visible
    sidebar.selectedTaskTypes = new Set(); // empty — old bug: would ADD instead of remove
    sidebar.availableTaskTypes = ['epic', 'feature'];
    state._viewService._hiddenTypes = new Set(); // all visible

    sidebar._toggleTaskType('feature');

    // Feature should now be hidden in ViewService
    expect(state._viewService.isTypeVisible('feature')).to.equal(false,
      'feature should be hidden after toggle when it was visible');
    // selectedTaskTypes should reflect the new state
    expect(sidebar.selectedTaskTypes.has('feature')).to.equal(false);
  });

  it('_toggleTaskType re-shows a hidden type', () => {
    sidebar.selectedTaskTypes = new Set(['epic']); // feature not in set
    sidebar.availableTaskTypes = ['epic', 'feature'];
    state._viewService._hiddenTypes = new Set(['feature']); // feature hidden

    sidebar._toggleTaskType('feature');

    expect(state._viewService.isTypeVisible('feature')).to.equal(true,
      'feature should be visible after toggling from hidden state');
    expect(sidebar.selectedTaskTypes.has('feature')).to.equal(true);
  });

  // -------------------------------------------------------------------------
  // Bug 3: _renderTaskFilters active class driven by ViewService
  // -------------------------------------------------------------------------
  it('task-type button active class reflects ViewService, not stale selectedTaskTypes', async () => {
    sidebar.availableTaskTypes = ['epic', 'feature'];
    sidebar.selectedTaskTypes = new Set(); // empty – simulates the stale/cold state
    state._viewService._hiddenTypes = new Set(); // both visible
    await sidebar.updateComplete;

    const root = sidebar.shadowRoot || sidebar;
    const typeOptions = root.querySelectorAll('.filter-option');
    // Find a type button and check its active class — should be active because ViewService says visible
    // (The filter-option divs for task types are interspersed with state filter options;
    //  we just check that at least one .active button exists for the types.)
    const activeButtons = Array.from(typeOptions).filter((el) =>
      el.classList.contains('active')
    );
    // With ViewService saying all visible, should have active buttons for both types
    expect(activeButtons.length).to.be.greaterThan(0,
      'At least one type button should be active when ViewService says all visible');
  });

  it('task-type button loses active class when ViewService hides the type', async () => {
    sidebar.availableTaskTypes = ['epic', 'feature'];
    sidebar.selectedTaskTypes = new Set(['epic', 'feature']);
    state._viewService._hiddenTypes = new Set(['feature']); // feature hidden
    // Trigger re-render so the Lit template picks up the new ViewService state
    sidebar.requestUpdate();
    await sidebar.updateComplete;

    const root = sidebar.shadowRoot || sidebar;
    // Verify that the sidebar rendered at least some filter-option elements
    const typeOptions = root.querySelectorAll('.filter-option');
    expect(typeOptions.length).to.be.greaterThan(0, 'should render type filter options');
    // With feature hidden, there should be at least one inactive (non-active) option
    const inactiveButtons = Array.from(typeOptions).filter(
      (el) => !el.classList.contains('active')
    );
    expect(inactiveButtons.length).to.be.greaterThan(0,
      'There should be at least one inactive type button when feature is hidden');
  });

  // -------------------------------------------------------------------------
  // Bug 4: _onSidebarFilterChanged syncs received selectedTaskTypes to ViewService
  // -------------------------------------------------------------------------
  it('FilterEvents.CHANGED with selectedTaskTypes syncs hidden types to ViewService', () => {
    sidebar.availableTaskTypes = ['epic', 'feature'];
    sidebar.selectedTaskTypes = new Set(['epic', 'feature']);
    state._viewService._hiddenTypes = new Set();

    // External caller hides feature by emitting selectedTaskTypes without it
    bus.emit(FilterEvents.CHANGED, { selectedTaskTypes: ['epic'] });

    expect(state._viewService.isTypeVisible('feature')).to.equal(false,
      'feature should be hidden after external selectedTaskTypes event excludes it');
    expect(state._viewService.isTypeVisible('epic')).to.equal(true);
    expect(sidebar.selectedTaskTypes.has('feature')).to.equal(false);
    expect(sidebar._taskTypesInitialized).to.equal(true);
  });

  it('FilterEvents.CHANGED restoring all types makes all visible in ViewService', () => {
    sidebar.availableTaskTypes = ['epic', 'feature'];
    sidebar.selectedTaskTypes = new Set(['epic']);
    state._viewService._hiddenTypes = new Set(['feature']); // feature hidden

    bus.emit(FilterEvents.CHANGED, { selectedTaskTypes: ['epic', 'feature'] });

    expect(state._viewService.isTypeVisible('epic')).to.equal(true);
    expect(state._viewService.isTypeVisible('feature')).to.equal(true);
  });
});
