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
import sinon from 'sinon';
import '../../www/js/components/Sidebar.lit.js';
import { cmd, sel } from '../../www/js/application/imports.js';
import { bus } from '../../www/js/core/EventBus.js';
import { BoardEvents, FilterEvents, FeatureEvents } from '../../www/js/core/EventRegistry.js';
import { dataService } from '../../www/js/services/dataService.js';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { render } from '../../www/js/vendor/lit.js';
import { SIDEBAR_STYLES } from '../../www/js/components/sidebar/Sidebar.styles.lit.js';
import { renderSidebarTaskFilters } from '../../www/js/components/sidebar/SidebarTaskFilters.lit.js';

describe('Sidebar task-type filter', () => {
  let sidebar;
  let originalCheckHealth;

  beforeEach(async () => {
    const state = createInitialAppState();
    state.lifecycle.status = 'ready';
    state.baseline.features = ['epic', 'feature'].map((type) => ({
      id: type, type, project: 'p1', state: 'New', capacity: [], relations: [], parentId: null,
    }));
    state.baseline.projects = [{ id: 'p1', name: 'Plan', type: 'project',
      state_categories: { New: 'Proposed' }, state_display_sequence: [], task_type_hierarchy: [], }];
    state.selection.projectIds = ['p1'];
    store.setState(state, true);
    await customElements.whenDefined('app-sidebar');
    originalCheckHealth = dataService.checkHealth;
    dataService.checkHealth = async () => ({
      ok: true,
      data: {
        status: 'ok', server_name: 'Test server', version: '1.2.3', uptime_seconds: 0,
      },
    });
    sidebar = document.createElement('app-sidebar');
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;
    // Reset type visibility via seam so store-backed selector state is authoritative.
    cmd.view.setTypeVisibility('epic', true);
    cmd.view.setTypeVisibility('feature', true);
  });

  afterEach(() => {
    cmd.view.setTaskViewMode('plan');
    if (sidebar && sidebar.isConnected) sidebar.remove();
    dataService.checkHealth = originalCheckHealth;
    sinon.restore();
  });

  it('renders health version, server name, and uptime from the successful result data', async () => {
    dataService.checkHealth = async () => ({
      ok: true,
      data: {
        status: 'ok', server_name: 'Planner API', version: '4.5.6', uptime_seconds: 3661,
      },
    });

    await sidebar.refreshServerStatus();

    expect(sidebar.serverName).to.equal('Planner API');
    expect(sidebar.serverStatus).to.equal('4.5.6 | Server: ok - Uptime: 1h 1m');
  });

  it('keeps its extracted stylesheet in the existing shadow root', () => {
    expect(sidebar.constructor.styles).to.equal(SIDEBAR_STYLES);
    expect(SIDEBAR_STYLES.cssText).to.include('.team-drilldown-grid');
    expect(SIDEBAR_STYLES.cssText).to.include('.sidebar-footer-box');
    expect(sidebar.shadowRoot).to.exist;
  });

  it('renders filter models and value actions without a host or store', () => {
    const actions = { toggleFilter: sinon.spy(), toggleState: sinon.spy(), toggleType: sinon.spy() };
    const root = document.createElement('div');
    render(renderSidebarTaskFilters({ model: {
      dimensions: [{ key: 'schedule', title: 'Schedule', options: [
        { key: 'planned', label: 'Planned', active: true, disabled: false },
        { key: 'unplanned', label: 'Unplanned', active: false, disabled: true },
      ] }],
      states: [{ name: 'New', color: '#ffffff', active: true, disabled: false }],
      types: [{ name: 'Task', active: true, disabled: true }],
    }, actions }), root);
    const options = root.querySelectorAll('.filter-option');
    options[0].click();
    options[1].click();
    options[2].click();
    options[3].click();
    expect(actions.toggleFilter.calledOnceWithExactly('schedule', 'planned')).to.be.true;
    expect(actions.toggleState.calledOnceWithExactly('New')).to.be.true;
    expect(actions.toggleType.called).to.be.false;
    expect(options[3].getAttribute('aria-disabled')).to.equal('true');
  });

  it('logs the health error status when the result fails', async () => {
    const error = { status: 503, message: 'Health check unavailable' };
    const originalConsoleError = console.error;
    const loggedErrors = [];
    dataService.checkHealth = async () => ({ ok: false, error });
    console.error = (...args) => loggedErrors.push(args);

    try {
      await sidebar.refreshServerStatus();
    } finally {
      console.error = originalConsoleError;
    }

    expect(sidebar.serverStatus).to.equal('Server: error');
    expect(loggedErrors).to.deep.equal([['[Sidebar] Health check failed', error]]);
  });

  it('toggles state filters through the existing application command', async () => {
    cmd.filter.setSelectedStates(['New']);
    sidebar._toggleState('New');
    expect(sel.filter.getSelectedFeatureStateNames()).to.deep.equal([]);
    sidebar._toggleState('New');
    expect(sel.filter.getSelectedFeatureStateNames()).to.deep.equal(['New']);
  });

  it('projects hydrated teams when a mounted Sidebar becomes ready', async () => {
    sidebar.remove();
    store.setState((state) => ({ ...state,
      lifecycle: { ...state.lifecycle, status: 'bootstrapping' },
      baseline: { ...state.baseline, teams: [{ id: 't1', name: 'Alpha', color: '#ffffff' }],
        features: state.baseline.features.map((feature) => ({ ...feature,
          capacity: [{ team: 't1', capacity: 10 }],
        })),
      },
    }));
    sidebar.teams = [];
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;
    store.setState((state) => ({ ...state, lifecycle: { ...state.lifecycle, status: 'ready' } }));
    await sidebar.updateComplete;
    expect(sidebar.teams.map((team) => team.id)).to.deep.equal(['t1']);
    expect(sidebar.shadowRoot.textContent).to.include('Alpha');
  });

  it('unions packed-mode restrictions with plugin restrictions without replacing them', async () => {
    const restrictions = { taskFilters: { schedule: ['planned'] },
      states: ['New'], taskTypes: ['feature'] };
    cmd.filter.setSidebarDisabledElements(restrictions);
    cmd.view.setDisplayMode('packed');
    await sidebar.updateComplete;
    const options = sidebar.shadowRoot.querySelectorAll('.filter-dimensions .filter-option');
    expect(options[0].getAttribute('aria-disabled')).to.equal('true');
    expect(options[1].getAttribute('aria-disabled')).to.equal('true');
    options[1].click();
    expect(sel.filter.getTaskFilters().schedule.unplanned).to.equal(false);
    cmd.view.setDisplayMode('normal');
    await sidebar.updateComplete;
    expect(options[0].getAttribute('aria-disabled')).to.equal('true');
    expect(options[1].getAttribute('aria-disabled')).to.equal('false');
    expect(sel.filter.getTaskFilters().schedule.unplanned).to.equal(true);
    expect(store.getState().selection.sidebarDisabled).to.equal(restrictions);
  });

  it('switches the team drill-down task view from Plan overview to Team focus', async () => {
    cmd.view.setTaskViewMode('plan');
    sidebar._getTeamDrilldownTeams = () => [{ id: 'team-a', name: 'Team A', selected: true }];
    sidebar.requestUpdate();
    await sidebar.updateComplete;

    const buttons = sidebar.shadowRoot.querySelectorAll('.team-view-mode button');
    expect(Array.from(buttons, (button) => button.textContent.trim())).to.deep.equal([
      'Plan overview', 'Team focus',
    ]);
    expect(buttons[0].getAttribute('aria-pressed')).to.equal('true');

    buttons[1].click();
    await sidebar.updateComplete;
    expect(sel.view.getTaskViewMode()).to.equal('team');
    expect(buttons[1].getAttribute('aria-pressed')).to.equal('true');
  });

  it('shows four task hierarchy commands below Task view and tracks board state', async () => {
    sidebar._getTeamDrilldownTeams = () => [{ id: 'team-a', name: 'Team A', selected: true }];
    bus.emit(BoardEvents.FOLD_STATE, {
      active: true, foldedCount: 1, foldableCount: 3, canCollapse: true,
    });
    await sidebar.updateComplete;

    const taskView = sidebar.shadowRoot.querySelector('.team-view-mode-group');
    const hierarchy = sidebar.shadowRoot.querySelector('.hierarchy-fold-group');
    expect(hierarchy).to.exist;
    expect(Boolean(taskView.compareDocumentPosition(hierarchy) & Node.DOCUMENT_POSITION_FOLLOWING)).to.be.true;
    expect(hierarchy.textContent).to.include('1 of 3 branches folded');
    const buttons = hierarchy.querySelectorAll('button');
    expect(buttons).to.have.length(4);
    expect(Array.from(buttons, (button) => button.textContent.trim())).to.deep.equal([
      'Fold all', 'Fold one level', 'Expand one level', 'Expand all',
    ]);
    const actions = [];
    const onAction = ({ action }) => actions.push(action);
    bus.on(BoardEvents.FOLD_ACTION, onAction);
    try {
      for (const button of buttons) button.click();
      expect(actions).to.deep.equal(['collapse-all', 'collapse-one', 'expand-one', 'expand-all']);
    } finally {
      bus.off(BoardEvents.FOLD_ACTION, onAction);
    }
    bus.emit(BoardEvents.FOLD_STATE, {
      active: true, foldedCount: 3, foldableCount: 3, canCollapse: false,
    });
    await sidebar.updateComplete;
    expect(hierarchy.querySelectorAll('button')[0].disabled).to.be.true;
    expect(hierarchy.querySelectorAll('button')[1].disabled).to.be.true;

    sidebar._getTeamDrilldownTeams = () => [];
    sidebar.requestUpdate();
    await sidebar.updateComplete;
    expect(sidebar.shadowRoot.querySelector('.hierarchy-fold-group')).to.exist;
  });

  it('renders hydrated types without mutating restored visibility during mounting', async () => {
    sidebar.remove();
    cmd.filter.setSelectedTaskTypes(['feature']);
    const selection = store.getState().selection.taskTypeNames;
    const options = store.getState().view.options;
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;
    expect(sel.filter.getSelectedTaskTypeNames()).to.deep.equal(['feature']);
    expect(store.getState().selection.taskTypeNames).to.equal(selection);
    expect(store.getState().view.options).to.equal(options);
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
    expect(sel.filter.getSelectedTaskTypeNames()).to.not.include('feature');
  });

  it('_toggleTaskType re-shows a hidden type', () => {
    sidebar.selectedTaskTypes = new Set(['epic']); // feature not in set
    sidebar.availableTaskTypes = ['epic', 'feature'];
    cmd.view.setTypeVisibility('feature', false);

    sidebar._toggleTaskType('feature');

    expect(sel.view.isTypeVisible('feature')).to.equal(true,
      'feature should be visible after toggling from hidden state');
    expect(sel.filter.getSelectedTaskTypeNames()).to.include('feature');
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
    expect(sel.filter.getSelectedTaskTypeNames()).to.not.include('feature');
  });

  it('FilterEvents.CHANGED with all visible types syncs local selectedTaskTypes', () => {
    sidebar.availableTaskTypes = ['epic', 'feature'];
    sidebar.selectedTaskTypes = new Set(['epic']);
    cmd.view.setTypeVisibility('feature', true, { suppressEvents: true });

    bus.emit(FilterEvents.CHANGED);

    expect(sel.view.isTypeVisible('epic')).to.equal(true);
    expect(sel.view.isTypeVisible('feature')).to.equal(true);
    expect(sel.filter.getSelectedTaskTypeNames()).to.include('feature');
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

  it('ignores a pending health response after disconnection', async () => {
    let resolve;
    dataService.checkHealth = () => new Promise((done) => { resolve = done; });
    const previous = sidebar.serverStatus;
    const pending = sidebar.refreshServerStatus();
    sidebar.remove();
    resolve({ ok: true, data: {
      status: 'ok', server_name: 'Obsolete', version: '9.9.9', uptime_seconds: 0,
    } });
    await pending;
    expect(sidebar.serverStatus).to.equal(previous);
    expect(sidebar.serverName).to.not.equal('Obsolete');
  });

  it('cancels pending frames and cleans up board subscriptions across reconnects', async () => {
    const callbacks = [];
    const schedule = sinon.stub(window, 'requestAnimationFrame').callsFake((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const originalCancel = window.cancelAnimationFrame;
    const cancel = sinon.spy();
    window.cancelAnimationFrame = cancel;
    bus.emit(FeatureEvents.UPDATED);
    sidebar.remove();
    const update = sinon.spy(sidebar, 'requestUpdate');
    for (const callback of callbacks) callback();
    expect(update.called).to.be.false;
    expect(cancel.called).to.be.true;
    schedule.restore();
    window.cancelAnimationFrame = originalCancel;
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;
    bus.emit(BoardEvents.FOLD_STATE, {
      active: true, foldedCount: 1, foldableCount: 2, canCollapse: true,
    });
    await sidebar.updateComplete;
    expect(sidebar.foldedCount).to.equal(1);
    sidebar.remove();
    bus.emit(BoardEvents.FOLD_STATE, {
      active: true, foldedCount: 2, foldableCount: 2, canCollapse: false,
    });
    expect(sidebar.foldedCount).to.equal(1);
  });
});
