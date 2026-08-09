import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSaveCurrentView,
  mockRenameView,
  mockDeleteView,
  mockLoadAndApplyView,
  mockCaptureCurrentView,
} = vi.hoisted(() => ({
  mockSaveCurrentView: vi.fn(async () => ({ id: 'v1' })),
  mockRenameView: vi.fn(async () => {}),
  mockDeleteView: vi.fn(async () => {}),
  mockLoadAndApplyView: vi.fn(async () => {}),
  mockCaptureCurrentView: vi.fn(() => ({
    timelineScale: 'months',
    displayMode: 'normal',
    condensedCards: false,
    featureSortMode: 'rank',
    showDependencies: true,
  })),
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {
    viewRestore: {
      saveCurrentView: mockSaveCurrentView,
      renameView: mockRenameView,
      deleteView: mockDeleteView,
      loadAndApplyView: mockLoadAndApplyView,
      captureCurrentView: mockCaptureCurrentView,
    },
  },
}));

import { ViewSaveModal } from '../../www/js/components/ViewSaveModal.lit.js';
import { ViewRenameModal } from '../../www/js/components/ViewRenameModal.lit.js';
import { ViewDeleteModal } from '../../www/js/components/ViewDeleteModal.lit.js';

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
        return refs[selector] || null;
      },
    },
  });
}

describe('view modals phase 5 seam migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ViewSaveModal uses cmd.viewRestore.saveCurrentView', async () => {
    const input = makeElement('input');
    input.value = 'My View';
    const saveBtn = makeElement();

    const modal = new ViewSaveModal();
    modal.remove = vi.fn();
    modal.dispatchEvent = vi.fn();
    wireModal(modal, {
      '#saveViewInput': input,
      '#saveViewBtn': saveBtn,
    });

    await modal._handleSave();
    expect(mockSaveCurrentView).toHaveBeenCalledWith('My View');
    expect(modal.remove).toHaveBeenCalledOnce();
  });

  it('ViewRenameModal uses cmd.viewRestore.renameView', async () => {
    const input = makeElement('input');
    input.value = 'Renamed';
    const saveBtn = makeElement();
    const cancelBtn = makeElement();
    const status = makeElement('div');

    const modal = new ViewRenameModal();
    modal.id = 'v1';
    modal.remove = vi.fn();
    wireModal(modal, {
      '#renameViewInput': input,
      '#renameViewBtn': saveBtn,
      '#cancelRenameViewBtn': cancelBtn,
      '#renameViewStatus': status,
    });

    modal.firstUpdated();
    await saveBtn.click();
    expect(mockRenameView).toHaveBeenCalledWith('v1', 'Renamed');
  });

  it('ViewDeleteModal uses cmd.viewRestore.deleteView', async () => {
    const delBtn = makeElement();
    const cancelBtn = makeElement();
    const status = makeElement('div');

    const modal = new ViewDeleteModal();
    modal.id = 'v1';
    modal.remove = vi.fn();
    wireModal(modal, {
      '#deleteViewBtn': delBtn,
      '#cancelDeleteViewBtn': cancelBtn,
      '#deleteViewStatus': status,
    });

    modal.firstUpdated();
    await delBtn.click();
    expect(mockDeleteView).toHaveBeenCalledWith('v1');
  });
});
