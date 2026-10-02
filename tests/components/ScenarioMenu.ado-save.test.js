/**
 * Tests for ScenarioMenu._onSaveToAzure baseline-refresh behaviour.
 *
 * Bug 3: after successfully publishing scenario changes to ADO the client
 * did not call state.refreshBaseline(), so the timeline still showed the
 * pre-publish baseline data until the user manually hit "Refresh Baseline".
 *
 * Fix: _onSaveToAzure now calls state.refreshBaseline() after a successful
 * publishBaseline() call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() ensures these variables are available inside vi.mock() factories
// even though vi.mock() calls are hoisted to the top of the file.
const { mockRefreshBaseline, mockPublishBaseline, mockOpenAzureDevopsModal } = vi.hoisted(() => ({
  mockRefreshBaseline: vi.fn().mockResolvedValue(undefined),
  mockPublishBaseline: vi.fn().mockResolvedValue({ ok: true, data: { ok: true, updated: 2, errors: [] } }),
  mockOpenAzureDevopsModal: vi.fn(),
}));

const {
  mockPendingGroupChanges,
  mockPromoteGroupToBaseline,
  mockClearGroupOverride,
  mockCreateGroup,
  mockScenarioGetScenarios,
  mockScenarioGetActiveScenarioId,
  mockGetChangedScenarioIds,
  mockSaveScenario,
} = vi.hoisted(() => ({
  mockPendingGroupChanges: vi.fn(() => []),
  mockPromoteGroupToBaseline: vi.fn(),
  mockClearGroupOverride: vi.fn(),
  mockCreateGroup: vi.fn().mockResolvedValue(null),
  mockScenarioGetScenarios: vi.fn(() => []),
  mockScenarioGetActiveScenarioId: vi.fn(() => null),
  mockGetChangedScenarioIds: vi.fn(() => []),
  mockSaveScenario: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../www/js/services/dataService.js', () => ({
  dataService: {
    publishBaseline: mockPublishBaseline,
    createGroup: mockCreateGroup,
    updateGroup: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    deleteGroup: vi.fn().mockResolvedValue({ ok: true, data: true }),
    listGroups: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../www/js/components/modalHelpers.js', () => ({
  openAzureDevopsModal: mockOpenAzureDevopsModal,
  openScenarioCloneModal: vi.fn(),
  openScenarioDeleteModal: vi.fn(),
  openScenarioRenameModal: vi.fn(),
  openConfigModal: vi.fn(),
  openHelpModal: vi.fn(),
}));

vi.mock('../../www/js/services/GroupService.js', () => ({
  groupService: {
    evictPlan: vi.fn(),
    loadGroupsForPlans: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../www/js/core/EventBus.js', () => ({
  bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../www/js/core/EventRegistry.js', () => ({
  ScenarioEvents: { UPDATED: 'scenario:updated', ACTIVATED: 'scenario:activated' },
  DataEvents: { SCENARIOS_CHANGED: 'data:scenarios_changed' },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {
    scenario: {
      activateScenario: vi.fn(),
      saveScenario: mockSaveScenario,
      refreshBaseline: mockRefreshBaseline,
      invalidateAndRefreshBaseline: vi.fn(),
    },
    group: {
      promoteGroupToBaseline: mockPromoteGroupToBaseline,
      clearGroupOverride: mockClearGroupOverride,
    },
  },
  sel: {
    selection: {
      getProjects: vi.fn(() => []),
      getTeams: vi.fn(() => []),
    },
    feature: {
      getBaselineFeatures: vi.fn(() => []),
      getEffectiveFeatures: vi.fn(() => []),
    },
    scenario: {
      getScenarios: mockScenarioGetScenarios,
      getActiveScenarioId: mockScenarioGetActiveScenarioId,
      getChangedScenarioIds: mockGetChangedScenarioIds,
      getActiveScenario: vi.fn(() => ({ id: 'sc-1', scenarioGroups: [], groupOverrides: {} })),
      isScenarioUnsaved: vi.fn((s) => mockGetChangedScenarioIds().includes(String(s?.id))),
    },
    group: {
      getPendingGroupChanges: mockPendingGroupChanges,
      getGroupById: vi.fn(() => null),
      getBaselineGroupById: vi.fn(() => ({ id: 'g1', plan_id: 'p1', members: [] })),
    },
  },
}));

vi.mock('../../www/js/vendor/lit.js', () => ({
  LitElement: class {
    connectedCallback() {}
    disconnectedCallback() {}
    requestUpdate() {}
    dispatchEvent() {}
  },
  html: (strings, ...values) => String.raw({ raw: strings }, ...values),
  css: (strings, ...values) => String.raw({ raw: strings }, ...values),
}));

import { bus } from '../../www/js/core/EventBus.js';
import { DataEvents } from '../../www/js/core/EventRegistry.js';
import { dataService } from '../../www/js/services/dataService.js';
import { ScenarioMenuLit } from '../../www/js/components/ScenarioMenu.lit.js';
import { groupService } from '../../www/js/services/GroupService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMenu(overrides = {}) {
  const menu = new ScenarioMenuLit();
  menu.scenarios = [];
  menu.activeScenarioId = null;
  Object.assign(menu, overrides);
  mockScenarioGetScenarios.mockReturnValue(menu.scenarios);
  return menu;
}

function makeEvent() {
  return { stopPropagation: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScenarioMenu._onSaveToAzure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublishBaseline.mockResolvedValue({ ok: true, data: { ok: true, updated: 2, errors: [] } });
    mockSaveScenario.mockResolvedValue({ ok: true });
    mockRefreshBaseline.mockResolvedValue(undefined);
  });

  it('refreshes the menu after a successful scenario save so the unsaved warning clears', async () => {
    const scenario = { id: 'sc-1', name: 'Alpha', overrides: { '42': { start: '2026-01-01' } } };
    const refreshed = [{ ...scenario }];
    const menu = makeMenu({ scenarios: [scenario], activeScenarioId: 'sc-1' });

    mockScenarioGetScenarios.mockReturnValue(refreshed);
    mockScenarioGetActiveScenarioId.mockReturnValue('sc-1');
    mockGetChangedScenarioIds.mockReturnValue([]);
    mockSaveScenario.mockResolvedValue({ ok: true });

    await menu._onSaveScenario(makeEvent(), scenario);

    expect(menu.scenarios).toEqual(refreshed);
    expect(menu.scenarios[0]).not.toHaveProperty('changedIds');
  });

  it('throws instead of silently falling back to stale payload data when selector state is invalid', async () => {
    const scenario = { id: 'sc-1', name: 'Alpha' };
    const menu = makeMenu({
      scenarios: [scenario],
      activeScenarioId: 'sc-1',
    });

    mockScenarioGetScenarios.mockReturnValue(undefined);
    mockScenarioGetActiveScenarioId.mockReturnValue('sc-1');
    mockGetChangedScenarioIds.mockReturnValue([]);
    mockSaveScenario.mockResolvedValue(undefined);

    await expect(menu._onSaveScenario(makeEvent(), scenario)).rejects.toThrow(/valid scenario list/i);
  });

  it('updates the menu when the server emits a refreshed scenario list after save', () => {
    const menu = makeMenu({
      scenarios: [{ id: 'sc-1', name: 'Alpha' }],
      activeScenarioId: 'sc-1',
    });

    menu._onScenariosUpdated = vi.fn((payload) => {
      const list = Array.isArray(payload) ? payload : Array.isArray(payload?.scenarios) ? payload.scenarios : [];
      menu.scenarios = list.map((s) => ({ ...s }));
      menu.activeScenarioId = 'sc-1';
    });

    const payload = [{ id: 'sc-1', name: 'Alpha' }];
    menu._onScenariosUpdated(payload);

    expect(menu.scenarios[0]).not.toHaveProperty('changedIds');
  });

  it('calls state.refreshBaseline() after a successful publish', async () => {
    const scenario = { id: 'sc-1', name: 'Alpha', overrides: { '42': { start: '2026-01-01' } } };
    const menu = makeMenu({ scenarios: [scenario], activeScenarioId: 'sc-1' });

    mockScenarioGetScenarios.mockReturnValue([scenario]);
    mockScenarioGetActiveScenarioId.mockReturnValue('sc-1');
    mockOpenAzureDevopsModal.mockResolvedValue({ features: [{ id: '42', start: '2026-01-01' }], groupChanges: [] });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockPublishBaseline).toHaveBeenCalledOnce();
    expect(mockRefreshBaseline).toHaveBeenCalledOnce();
  });

  it('keeps a group update pending when the server rejects it', async () => {
    const scenario = { id: 'sc-1', overrides: {} };
    const change = { type: 'update', groupId: 'g1', fields: { name: 'Renamed' } };
    const menu = makeMenu({ scenarios: [scenario], activeScenarioId: 'sc-1' });
    mockScenarioGetScenarios.mockReturnValue([scenario]);
    mockPendingGroupChanges.mockReturnValue([change]);
    mockOpenAzureDevopsModal.mockResolvedValue({ features: [], groupChanges: [change] });
    dataService.updateGroup.mockResolvedValueOnce({
      ok: false, error: { message: 'Group update failed' },
    });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockClearGroupOverride).not.toHaveBeenCalled();
    expect(mockSaveScenario).not.toHaveBeenCalled();
  });

  it('keeps a loaded plan untouched when a group deletion fails', async () => {
    const scenario = { id: 'sc-1', overrides: {} };
    const change = { type: 'delete', groupId: 'g1' };
    const menu = makeMenu({ scenarios: [scenario] });
    mockPendingGroupChanges.mockReturnValue([change]);
    mockOpenAzureDevopsModal.mockResolvedValue({ features: [], groupChanges: [change] });
    dataService.deleteGroup.mockResolvedValueOnce({ ok: false, error: { message: 'Delete failed' } });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockClearGroupOverride).not.toHaveBeenCalled();
    expect(groupService.evictPlan).not.toHaveBeenCalled();
    expect(groupService.loadGroupsForPlans).not.toHaveBeenCalled();
  });

  it('persists and refreshes a successful create before a later delete fails', async () => {
    const scenario = { id: 'sc-1', overrides: {} };
    const group = {
      id: 'tmp_1', plan_id: 'p1', name: 'New', rank: 1024, parent_id: null, members: [],
    };
    const changes = [
      { type: 'create', group }, { type: 'delete', groupId: 'g1' },
    ];
    const menu = makeMenu({ scenarios: [scenario], activeScenarioId: 'sc-1' });
    mockPendingGroupChanges.mockReturnValue(changes);
    mockCreateGroup.mockResolvedValueOnce({ ok: true, data: { id: 'real-1' } });
    dataService.deleteGroup.mockResolvedValueOnce({ ok: false, error: { message: 'Delete failed' } });
    mockOpenAzureDevopsModal.mockResolvedValue({ features: [], groupChanges: changes });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockPromoteGroupToBaseline).toHaveBeenCalledExactlyOnceWith('tmp_1', 'real-1', []);
    expect(mockSaveScenario).toHaveBeenCalledExactlyOnceWith('sc-1');
    expect(mockClearGroupOverride).not.toHaveBeenCalled();
    expect(groupService.loadGroupsForPlans).toHaveBeenCalledExactlyOnceWith(['p1']);
  });

  it('does not acknowledge a rejected create or feature publish', async () => {
    const scenario = { id: 'sc-1', overrides: {} };
    const group = {
      id: 'tmp_1', plan_id: 'p1', name: 'New', rank: 1024, parent_id: null, members: [],
    };
    const changes = [{ type: 'create', group }];
    const menu = makeMenu({ scenarios: [scenario], activeScenarioId: 'sc-1' });
    mockPendingGroupChanges.mockReturnValue(changes);
    mockCreateGroup.mockResolvedValueOnce({ ok: false, error: { message: 'Create failed' } });
    mockOpenAzureDevopsModal.mockResolvedValue({ features: [], groupChanges: changes });
    await menu._onSaveToAzure(makeEvent(), scenario);
    expect(mockPromoteGroupToBaseline).not.toHaveBeenCalled();
    expect(mockSaveScenario).not.toHaveBeenCalled();

    mockPendingGroupChanges.mockReturnValue([]);
    scenario.overrides = { t1: { name: 'Edited' } };
    mockOpenAzureDevopsModal.mockResolvedValue({ features: [{ id: 't1', name: 'Edited' }], groupChanges: [] });
    mockPublishBaseline.mockResolvedValueOnce({ ok: false, error: { message: 'Publish failed' } });
    await menu._onSaveToAzure(makeEvent(), scenario);
    expect(mockSaveScenario).not.toHaveBeenCalled();
    expect(scenario.overrides).toEqual({ t1: { name: 'Edited' } });
  });

  it('promotes a published group out of the scenario so it is not created again', async () => {
    // Regression: the publish path used to mutate the scenario object in place,
    // so the group stayed pending and was re-created on every later save —
    // accumulating duplicate groups on the plan across scenarios.
    const scenario = { id: 'sc-1', name: 'Alpha', overrides: {} };
    const menu = makeMenu({ scenarios: [scenario], activeScenarioId: 'sc-1' });
    const pendingGroup = {
      id: 'tmp_1',
      plan_id: 'p1',
      name: 'New group',
      rank: 1024,
      parent_id: null,
      members: ['t1', 't2'],
    };

    mockScenarioGetScenarios.mockReturnValue([scenario]);
    mockScenarioGetActiveScenarioId.mockReturnValue('sc-1');
    mockPendingGroupChanges.mockReturnValue([{ type: 'create', group: pendingGroup }]);
    mockCreateGroup.mockResolvedValue({ ok: true, data: { id: 'real-1' } });
    mockOpenAzureDevopsModal.mockResolvedValue({
      features: [],
      // The modal committed only t1; t2 was deselected.
      groupChanges: [{ type: 'create', group: { ...pendingGroup, members: ['t1'] } }],
    });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: 'p1', name: 'New group', rank: 1024, parent_id: null })
    );
    expect(mockPromoteGroupToBaseline).toHaveBeenCalledWith('tmp_1', 'real-1', ['t2']);
  });

  it('remaps a sub-group parent from its temp id to the created id', async () => {
    const scenario = { id: 'sc-1', name: 'Alpha', overrides: {} };
    const menu = makeMenu({ scenarios: [scenario], activeScenarioId: 'sc-1' });
    const parent = { id: 'tmp_p', plan_id: 'p1', name: 'Parent', rank: 1024, parent_id: null, members: [] };
    const child = { id: 'tmp_c', plan_id: 'p1', name: 'Child', rank: 1024, parent_id: 'tmp_p', members: [] };

    mockScenarioGetScenarios.mockReturnValue([scenario]);
    mockScenarioGetActiveScenarioId.mockReturnValue('sc-1');
    mockPendingGroupChanges.mockReturnValue([
      { type: 'create', group: parent },
      { type: 'create', group: child },
    ]);
    mockCreateGroup
      .mockResolvedValueOnce({ ok: true, data: { id: 'real-p' } })
      .mockResolvedValueOnce({ ok: true, data: { id: 'real-c' } });
    mockOpenAzureDevopsModal.mockResolvedValue({
      features: [],
      groupChanges: [
        { type: 'create', group: parent },
        { type: 'create', group: child },
      ],
    });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockCreateGroup).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Child', parent_id: 'real-p' })
    );
  });

  it('refreshes affected plans together after publishing groups', async () => {
    const scenario = { id: 'sc-1', name: 'Alpha', overrides: {} };
    const menu = makeMenu({ scenarios: [scenario], activeScenarioId: 'sc-1' });
    const groups = ['p1', 'p2'].map((planId) => ({
      id: `tmp_${planId}`, plan_id: planId, name: planId,
      rank: 1024, parent_id: null, members: [],
    }));
    const changes = groups.map((group) => ({ type: 'create', group }));
    mockScenarioGetScenarios.mockReturnValue([scenario]);
    mockScenarioGetActiveScenarioId.mockReturnValue('sc-1');
    mockPendingGroupChanges.mockReturnValue(changes);
    mockCreateGroup.mockResolvedValue({ ok: true, data: { id: 'real-group' } });
    mockOpenAzureDevopsModal.mockResolvedValue({ features: [], groupChanges: changes });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(groupService.evictPlan).toHaveBeenCalledWith('p1');
    expect(groupService.evictPlan).toHaveBeenCalledWith('p2');
    expect(groupService.loadGroupsForPlans).toHaveBeenCalledExactlyOnceWith(['p1', 'p2']);
  });

  it('does NOT call state.refreshBaseline() when user cancels the modal', async () => {    const scenario = { id: 'sc-2', overrides: { '43': { end: '2026-06-30' } } };
    const menu = makeMenu({ scenarios: [scenario] });

    // Simulate user dismissing the dialog
    mockOpenAzureDevopsModal.mockResolvedValue(null);

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockPublishBaseline).not.toHaveBeenCalled();
    expect(mockRefreshBaseline).not.toHaveBeenCalled();
  });

  it('does NOT call state.refreshBaseline() when scenario has no overrides', async () => {
    const scenario = { id: 'sc-3', overrides: {} };
    const menu = makeMenu({ scenarios: [scenario] });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockPublishBaseline).not.toHaveBeenCalled();
    expect(mockRefreshBaseline).not.toHaveBeenCalled();
  });

  it('still calls refreshBaseline() even when publishBaseline returns partial errors', async () => {
    // Some items saved successfully — baseline must still be refreshed so the
    // successfully-written items become visible in the tool.
    const scenario = { id: 'sc-4', overrides: { '44': { state: 'Done' } } };
    const menu = makeMenu({ scenarios: [scenario] });

    mockOpenAzureDevopsModal.mockResolvedValue({ features: [{ id: '44', state: 'Done' }], groupChanges: [] });
    mockPublishBaseline.mockResolvedValue({ ok: true, data: { ok: false, updated: 1, errors: ['99: bad'] } });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockPublishBaseline).toHaveBeenCalledOnce();
    expect(mockRefreshBaseline).toHaveBeenCalledOnce();
    expect(mockSaveScenario).not.toHaveBeenCalled();
    expect(scenario.overrides).toEqual({ '44': { state: 'Done' } });
  });

  it('does not propagate a refreshBaseline() failure to the caller', async () => {
    // refreshBaseline is best-effort: a transient network error should not
    // surface as an unhandled rejection to the user.
    const scenario = { id: 'sc-5', overrides: { '45': { start: '2026-02-01' } } };
    const menu = makeMenu({ scenarios: [scenario] });

    mockOpenAzureDevopsModal.mockResolvedValue({ features: [{ id: '45', start: '2026-02-01' }], groupChanges: [] });
    mockRefreshBaseline.mockRejectedValue(new Error('network error'));

    await expect(menu._onSaveToAzure(makeEvent(), scenario)).resolves.toBeUndefined();
    expect(mockPublishBaseline).toHaveBeenCalledOnce();
    expect(mockRefreshBaseline).toHaveBeenCalledOnce();
  });
});
