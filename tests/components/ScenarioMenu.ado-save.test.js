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
  mockPublishBaseline: vi.fn().mockResolvedValue({ ok: true, updated: 2, errors: [] }),
  mockOpenAzureDevopsModal: vi.fn(),
}));

const {
  mockPendingGroupChanges,
  mockConfirmGroupCreate,
  mockScenarioGetScenarios,
  mockScenarioGetActiveScenarioId,
  mockGetChangedScenarioIds,
  mockSaveScenario,
} = vi.hoisted(() => ({
  mockPendingGroupChanges: vi.fn(() => []),
  mockConfirmGroupCreate: vi.fn(),
  mockScenarioGetScenarios: vi.fn(() => []),
  mockScenarioGetActiveScenarioId: vi.fn(() => null),
  mockGetChangedScenarioIds: vi.fn(() => []),
  mockSaveScenario: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../www/js/services/dataService.js', () => ({
  dataService: {
    publishBaseline: mockPublishBaseline,
    createGroup: vi.fn().mockResolvedValue(null),
    updateGroup: vi.fn().mockResolvedValue(null),
    deleteGroup: vi.fn().mockResolvedValue(true),
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
    replaceId: vi.fn(),
    evictPlan: vi.fn(),
    loadGroups: vi.fn().mockResolvedValue([]),
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
      confirmGroupCreate: mockConfirmGroupCreate,
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
      isScenarioUnsaved: vi.fn((s) => mockGetChangedScenarioIds().includes(String(s?.id))),
    },
    group: {
      getPendingGroupChanges: mockPendingGroupChanges,
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
import { ScenarioMenuLit } from '../../www/js/components/ScenarioMenu.lit.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMenu(overrides = {}) {
  const menu = new ScenarioMenuLit();
  menu.scenarios = [];
  menu.activeScenarioId = null;
  Object.assign(menu, overrides);
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
    mockPublishBaseline.mockResolvedValue({ ok: true, updated: 2, errors: [] });
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

  it('does NOT call state.refreshBaseline() when user cancels the modal', async () => {
    const scenario = { id: 'sc-2', overrides: { '43': { end: '2026-06-30' } } };
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
    mockPublishBaseline.mockResolvedValue({ ok: false, updated: 1, errors: ['99: bad'] });

    await menu._onSaveToAzure(makeEvent(), scenario);

    expect(mockPublishBaseline).toHaveBeenCalledOnce();
    expect(mockRefreshBaseline).toHaveBeenCalledOnce();
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
