import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCloneScenario,
  mockActivateScenario,
  mockRenameScenario,
  mockDeleteScenario,
  mockRenameRequest,
  mockDeleteRequest,
} = vi.hoisted(() => ({
  mockCloneScenario: vi.fn(),
  mockActivateScenario: vi.fn(),
  mockRenameScenario: vi.fn(),
  mockDeleteScenario: vi.fn(),
  mockRenameRequest: vi.fn(),
  mockDeleteRequest: vi.fn(),
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {
    scenario: {
      cloneScenario: mockCloneScenario,
      activateScenario: mockActivateScenario,
      renameScenario: mockRenameScenario,
      deleteScenario: mockDeleteScenario,
    },
  },
}));

vi.mock('../../www/js/services/dataService.js', () => ({
  dataService: {
    renameScenario: mockRenameRequest,
    deleteScenario: mockDeleteRequest,
  },
}));

import { ScenarioCloneModal } from '../../www/js/components/ScenarioCloneModal.lit.js';
import { ScenarioRenameModal } from '../../www/js/components/ScenarioRenameModal.lit.js';
import { ScenarioDeleteModal } from '../../www/js/components/ScenarioDeleteModal.lit.js';

function makeElement(tag = 'button') {
  const listeners = new Map();
  return {
    tag,
    disabled: false,
    value: '',
    textContent: '',
    focus: vi.fn(),
    addEventListener: (event, handler) => listeners.set(event, handler),
    click: () => listeners.get('click')?.(),
    dispatchKey: (key) => listeners.get('keydown')?.({ key }),
    listeners,
  };
}

function wireModal(instance, refs) {
  const inner = {
    open: false,
    querySelector: (selector) => refs[selector] || null,
  };
  Object.defineProperty(instance, 'renderRoot', {
    configurable: true,
    value: {
      querySelector: (selector) => {
        if (selector === 'modal-lit') return inner;
        return null;
      },
    },
  });
}

describe('scenario modal phase 5 command migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ScenarioCloneModal uses cmd.scenario clone + activate', async () => {
    const saveBtn = makeElement();
    const cancelBtn = makeElement();
    const input = makeElement('input');
    const status = makeElement('div');
    input.value = '  New Scenario  ';

    const modal = new ScenarioCloneModal();
    modal.id = 'sc-1';
    modal.remove = vi.fn();
    wireModal(modal, {
      '#cloneBtn': saveBtn,
      '#cancelCloneBtn': cancelBtn,
      '#cloneInput': input,
      '#cloneStatus': status,
    });

    mockCloneScenario.mockReturnValue({ id: 'sc-2' });

    modal.firstUpdated();
    await saveBtn.click();

    expect(mockCloneScenario).toHaveBeenCalledWith('sc-1', 'New Scenario');
    expect(mockActivateScenario).toHaveBeenCalledWith('sc-2');
    expect(modal.remove).toHaveBeenCalledOnce();
  });

  it('ScenarioRenameModal uses cmd.scenario rename and persists via dataService', async () => {
    const saveBtn = makeElement();
    const cancelBtn = makeElement();
    const input = makeElement('input');
    const status = makeElement('div');
    input.value = '  Renamed  ';

    const modal = new ScenarioRenameModal();
    modal.id = 'sc-9';
    modal.remove = vi.fn();
    wireModal(modal, {
      '#renameBtn': saveBtn,
      '#cancelRenameBtn': cancelBtn,
      '#renameInput': input,
      '#renameStatus': status,
    });

    mockRenameRequest.mockResolvedValue({ ok: true });

    modal.firstUpdated();
    await saveBtn.click();

    expect(mockRenameScenario).toHaveBeenCalledWith('sc-9', 'Renamed');
    expect(mockRenameRequest).toHaveBeenCalledWith('sc-9', 'Renamed');
    expect(modal.remove).toHaveBeenCalledOnce();
  });

  it('ScenarioDeleteModal uses cmd.scenario delete and persists via dataService', async () => {
    const deleteBtn = makeElement();
    const cancelBtn = makeElement();
    const status = makeElement('div');

    const modal = new ScenarioDeleteModal();
    modal.id = 'sc-12';
    modal.remove = vi.fn();
    wireModal(modal, {
      '#deleteBtn': deleteBtn,
      '#cancelDeleteBtn': cancelBtn,
      '#deleteStatus': status,
    });

    mockDeleteRequest.mockResolvedValue({ ok: true });

    modal.firstUpdated();
    await deleteBtn.click();

    expect(mockDeleteScenario).toHaveBeenCalledWith('sc-12');
    expect(mockDeleteRequest).toHaveBeenCalledWith('sc-12');
    expect(modal.remove).toHaveBeenCalledOnce();
  });
});
