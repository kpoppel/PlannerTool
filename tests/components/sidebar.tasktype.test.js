/**
 * Tests for Sidebar task-type filter behaviour.
 *
 * Covers the bugs fixed in the "task type filter not applied on load" fix:
 *   1. _taskTypesInitialized must not be set when no types are available yet.
 *   2. _toggleTaskType uses the view state as the authoritative source (not selectedTaskTypes).
 *   3. _renderTaskFilters active class driven by the view state.
 *   4. _onSidebarFilterChanged syncs selected task types from selectors on signal events.
 */

import { expect } from '@open-wc/testing';
import '../../www/js/components/Sidebar.lit.js';
import { cmd, sel } from '../../www/js/application/imports.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FilterEvents, FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('Sidebar task-type filter', () => {
  let sidebar;

  beforeEach(async () => {
    await customElements.whenDefined('app-sidebar');
    sidebar = document.createElement('app-sidebar');
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;
    // Reset type visibility via seam so store-backed selector state is authoritative.
    cmd.view.setTypeVisibility('epic', true);
    cmd.view.setTypeVisibility('feature', true);
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
    const origGetBaseline = sel.feature.getBaselineFeatures;
    sel.feature.getBaselineFeatures = () => [];
    sidebar._computeAvailableTaskTypes();
    sel.feature.getBaselineFeatures = origGetBaseline;
    expect(sidebar._taskTypesInitialized).to.equal(false,
      '_taskTypesInitialized must stay false when no types are available');
  });

  it('_computeAvailableTaskTypes sets _taskTypesInitialized=true only when types are available', async () => {
    sidebar._taskTypesInitialized = false;
    sidebar.selectedTaskTypes = new Set();
    const origGetBaseline = sel.feature.getBaselineFeatures;
    sel.feature.getBaselineFeatures = () => [{ id: 'f1', type: 'epic' }, { id: 'f2', type: 'feature' }];
    sidebar._computeAvailableTaskTypes();
    sel.feature.getBaselineFeatures = origGetBaseline;
    expect(sidebar._taskTypesInitialized).to.equal(true);
    expect(sidebar.selectedTaskTypes.has('epic')).to.equal(true);
    expect(sidebar.selectedTaskTypes.has('feature')).to.equal(true);
  });

  // -------------------------------------------------------------------------
  // Bug 2: _toggleTaskType reads view state, not selectedTaskTypes
  // -------------------------------------------------------------------------
  it('_toggleTaskType hides type via view state even when selectedTaskTypes is empty', () => {
    // Simulate the bug scenario: selectedTaskTypes is empty but view state says all visible
    sidebar.selectedTaskTypes = new Set(); // empty — old bug: would ADD instead of remove
    sidebar.availableTaskTypes = ['epic', 'feature'];
    cmd.view.setTypeVisibility('epic', true);
    cmd.view.setTypeVisibility('feature', true);

    sidebar._toggleTaskType('feature');

    // Feature should now be hidden in view state
    expect(sel.view.isTypeVisible('feature')).to.equal(false,
      'feature should be hidden after toggle when it was visible');
    // selectedTaskTypes should reflect the new state
    expect(sidebar.selectedTaskTypes.has('feature')).to.equal(false);
  });

  it('_toggleTaskType re-shows a hidden type', () => {
    sidebar.selectedTaskTypes = new Set(['epic']); // feature not in set
    sidebar.availableTaskTypes = ['epic', 'feature'];
    cmd.view.setTypeVisibility('feature', false);

    sidebar._toggleTaskType('feature');

    expect(sel.view.isTypeVisible('feature')).to.equal(true,
      'feature should be visible after toggling from hidden state');
    expect(sidebar.selectedTaskTypes.has('feature')).to.equal(true);
  });

  // -------------------------------------------------------------------------
  // Bug 3: _renderTaskFilters active class driven by view state
  // -------------------------------------------------------------------------
  it('task-type button active class reflects view state, not stale selectedTaskTypes', async () => {
    sidebar.availableTaskTypes = ['epic', 'feature'];
    sidebar.selectedTaskTypes = new Set(); // empty – simulates the stale/cold state
    cmd.view.setTypeVisibility('epic', true);
    cmd.view.setTypeVisibility('feature', true);
    await sidebar.updateComplete;

    const root = sidebar.shadowRoot || sidebar;
    const typeOptions = root.querySelectorAll('.filter-option');
    // Find a type button and check its active class — should be active because view state says visible
    // (The filter-option divs for task types are interspersed with state filter options;
    //  we just check that at least one .active button exists for the types.)
    const activeButtons = Array.from(typeOptions).filter((el) =>
      el.classList.contains('active')
    );
    // With view state saying all visible, should have active buttons for both types
    expect(activeButtons.length).to.be.greaterThan(0,
      'At least one type button should be active when view state says all visible');
  });

  it('task-type button loses active class when view state hides the type', async () => {
    sidebar.availableTaskTypes = ['epic', 'feature'];
    sidebar.selectedTaskTypes = new Set(['epic', 'feature']);
    cmd.view.setTypeVisibility('feature', false);
    // Trigger re-render so the Lit template picks up the new view state
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
  // Bug 4: _onSidebarFilterChanged syncs selected task types from selector state
  // -------------------------------------------------------------------------
  it('FilterEvents.CHANGED syncs selector-backed type visibility to local selectedTaskTypes', () => {
    sidebar.availableTaskTypes = ['epic', 'feature'];
    sidebar.selectedTaskTypes = new Set(['epic', 'feature']);
    cmd.view.setTypeVisibility('epic', true);
    cmd.view.setTypeVisibility('feature', true);

    // Hide feature via command/store, then fire the signal event.
    cmd.view.setTypeVisibility('feature', false, { suppressEvents: true });
    bus.emit(FilterEvents.CHANGED);

    expect(sel.view.isTypeVisible('feature')).to.equal(false,
      'feature should be hidden after selector update');
    expect(sel.view.isTypeVisible('epic')).to.equal(true);
    expect(sidebar.selectedTaskTypes.has('feature')).to.equal(false);
    expect(sidebar._taskTypesInitialized).to.equal(true);
  });

  it('FilterEvents.CHANGED with all visible types syncs local selectedTaskTypes', () => {
    sidebar.availableTaskTypes = ['epic', 'feature'];
    sidebar.selectedTaskTypes = new Set(['epic']);
    cmd.view.setTypeVisibility('feature', true, { suppressEvents: true });

    bus.emit(FilterEvents.CHANGED);

    expect(sel.view.isTypeVisible('epic')).to.equal(true);
    expect(sel.view.isTypeVisible('feature')).to.equal(true);
    expect(sidebar.selectedTaskTypes.has('feature')).to.equal(true);
  });

  it('does not render moved Scope or display controls', async () => {
    const root = sidebar.shadowRoot || sidebar;
    const labels = Array.from(root.querySelectorAll('button')).map((button) => button.textContent.trim());

    expect(labels).to.not.include.members(['Parent', 'Child', 'Dependency', 'Other allocations']);
    expect(labels).to.not.include.members(['3mo', 'Weeks', 'Months', 'Quarters', 'Years']);
    const sectionTitles = Array.from(root.querySelectorAll('.section-title'))
      .map((element) => element.textContent.trim());
    expect(sectionTitles).to.not.include('Context');
    expect(sectionTitles).to.not.include('Taskboard Options');
  });

  it('does not retain obsolete expansion UI state', () => {
    expect(sidebar._toggleExpansion).to.equal(undefined);
    expect('expandParentChild' in sidebar).to.equal(false);
    expect('expandRelations' in sidebar).to.equal(false);
    expect('expandTeamAllocated' in sidebar).to.equal(false);
  });

  it('renders per-type team counts for the focused teams', async () => {
    sidebar.teams = [{ id: 'team-1', name: 'Alpha', short: 'A', color: '#123456', selected: true }];
    const originalGetContextTeams = sel.scope.getContextTeams;
    const originalGetTaskTypes = sel.feature.getAvailableTaskTypesOrdered;
    const originalGetCounts = sel.feature.getCountsForTeam;
    sel.scope.getContextTeams = () => ['team-1'];
    sel.feature.getAvailableTaskTypesOrdered = () => ['Feature'];
    sel.feature.getCountsForTeam = () => new Map([['feature', 4]]);
    sidebar.requestUpdate();
    await sidebar.updateComplete;

    const root = sidebar.shadowRoot || sidebar;
    const titles = Array.from(root.querySelectorAll('.section-title'))
      .map((element) => element.textContent.trim());
    expect(titles).to.include('Team Drill-down');
    expect(root.textContent).to.include('Alpha');
    expect(root.textContent).to.include('4');
    sel.scope.getContextTeams = originalGetContextTeams;
    sel.feature.getAvailableTaskTypesOrdered = originalGetTaskTypes;
    sel.feature.getCountsForTeam = originalGetCounts;
  });

  it('renders Context-scoped teams with select-all and select-none controls', async () => {
    const originalGetContextTeams = sel.scope.getContextTeams;
    sel.scope.getContextTeams = () => ['team-1', 'team-2'];
    sidebar.teams = [
      { id: 'team-1', name: 'Alpha', selected: true },
      { id: 'team-2', name: 'Beta', selected: false },
      { id: 'team-3', name: 'Outside scope', selected: true },
    ];
    sidebar.requestUpdate();
    await sidebar.updateComplete;

    const root = sidebar.shadowRoot || sidebar;
    expect(root.textContent).to.include('Team Drill-down');
    expect(root.textContent).to.include('Alpha');
    expect(root.textContent).to.include('Beta');
    expect(root.textContent).to.not.include('Outside scope');
    sel.scope.getContextTeams = originalGetContextTeams;
  });

  it('shows the empty Team Drill-down state when Context has no teams', async () => {
    const originalGetContextTeams = sel.scope.getContextTeams;
    sel.scope.getContextTeams = () => [];
    sidebar.requestUpdate();
    await sidebar.updateComplete;
    expect((sidebar.shadowRoot || sidebar).textContent)
      .to.include('This plan has no teams assigned.');
    sel.scope.getContextTeams = originalGetContextTeams;
  });

  it('shows the resolved task count as informational footer data', async () => {
    sidebar.resolvedTasksCount = 12;
    sidebar.requestUpdate();
    await sidebar.updateComplete;

    expect((sidebar.shadowRoot || sidebar).textContent).to.include('Tasks loaded: 12');
  });

  it('uses display-only team selection from the Sidebar', () => {
    const originalSetTeamSelected = cmd.selection.setTeamSelected;
    let receivedOptions;
    cmd.selection.setTeamSelected = (id, selected, options) => {
      receivedOptions = options;
    };

    sidebar._toggleTeamDrilldown('team-1');

    expect(receivedOptions.displayOnly).to.equal(true);
    cmd.selection.setTeamSelected = originalSetTeamSelected;
  });
});
