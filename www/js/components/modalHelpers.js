// Lightweight helpers to open common modal components.
// Helpers lazy-load the module via static imports, create or reuse an element,
// wait for user action events, then cleanup and resolve with a value.

import { cmd, sel } from '../application/imports.js';
import { dataService } from '../services/dataService.js';

// Static import map for all modal modules (bundler includes them and emits hashed filenames)
const _modalImports = {
  './ConfigModal.lit.js': () => import('./ConfigModal.lit.js'),
  './HelpModal.lit.js': () => import('./HelpModal.lit.js'),
  './OnboardingModal.lit.js': () => import('./OnboardingModal.lit.js'),
  './PublishScenarioModal.lit.js': () => import('./PublishScenarioModal.lit.js'),
  './EmptyBoardModal.lit.js': () => import('./EmptyBoardModal.lit.js'),
  './ScenarioCloneModal.lit.js': () => import('./ScenarioCloneModal.lit.js'),
  './ScenarioRenameModal.lit.js': () => import('./ScenarioRenameModal.lit.js'),
  './ScenarioDeleteModal.lit.js': () => import('./ScenarioDeleteModal.lit.js'),
  './ViewSaveModal.lit.js': () => import('./ViewSaveModal.lit.js'),
  './ViewRenameModal.lit.js': () => import('./ViewRenameModal.lit.js'),
  './ViewDeleteModal.lit.js': () => import('./ViewDeleteModal.lit.js'),
};

export async function openCreateTask() {
  if (document.getElementById('task-dialog-heading')) return;
  const result = await dataService.getTaskBackend();
  if (!result.ok || !result.data.capabilities.includes('task_create')) return;
  const [project] = sel.selection.getSelectedProjects();
  return openTaskEditor({ planId: project === undefined ? '' : String(project.id),
    refresh: () => cmd.scenario.refreshBaseline() });
}

export async function openTaskEditor({ task = null, planId = '', canDelete = false, refresh, readTask }) {
  await import('./TaskEditor.lit.js');
  if (document.getElementById('task-dialog-heading')) return;
  const refreshTasks = async () => {
    const result = await refresh();
    if (!result.ok) throw new Error(result.error.message);
  };
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'width:min(520px, 85vw);max-height:85vh;padding:20px;border:1px solid #cbd5e1;border-radius:8px';
  const heading = document.createElement('h2');
  heading.id = 'task-dialog-heading';
  heading.textContent = task === null ? 'Create Task' : 'Edit Task';
  dialog.setAttribute('aria-labelledby', heading.id);
  const notice = document.createElement('p');
  notice.setAttribute('role', 'status');
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.addEventListener('click', () => dialog.close());
  const createEditor = (current) => {
    const editor = document.createElement('task-editor');
    const moveTargets = current === null || !Number.isSafeInteger(current.number) ? []
      : sel.feature.getBaselineFeatures().filter((entry) => entry.id !== current.id && Number.isSafeInteger(entry.number));
    Object.assign(editor, { task: current, planId, canDelete, moveTargets });
    editor.addEventListener('task-committed', async () => {
      editor.inert = true;
      notice.textContent = 'Refreshing tasks...';
      try {
        await refreshTasks();
        dialog.close();
      } catch (error) {
        notice.textContent = `Task saved, but refreshing failed: ${error.message}`;
      }
    });
    editor.addEventListener('task-reload', async () => {
      if (!window.confirm('Discard this draft and reload the current task?')) return;
      notice.textContent = 'Refreshing task...';
      try {
        await refreshTasks();
        const latest = readTask(current.id);
        notice.textContent = latest ? '' : 'This task is no longer available.';
        if (latest) editor.replaceWith(createEditor(latest));
        else editor.remove();
      } catch (error) { notice.textContent = error.message; }
    });
    return editor;
  };
  dialog.append(heading, notice, createEditor(task), close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

const _createModal = async (
  modulePath,
  tagName,
  { parent = document.body, attrs = {}, autoOpen = false } = {}
) => {
  // Use static import map - works in both dev and production
  const importer = _modalImports[modulePath];
  if (importer) {
    await importer();
  } else {
    throw new Error(`Modal module not found: ${modulePath}`);
  }

  const existing = parent.querySelector(tagName);
  let el;
  let created = false;
  if (existing) el = existing;
  else {
    el = document.createElement(tagName);
    parent.appendChild(el);
    created = true;
  }
  Object.assign(el, attrs);
  if (autoOpen) {
    const inner = el.querySelector('modal-lit');
    if (inner) inner.open = true;
  }
  if (el.updateComplete) await el.updateComplete;
  const cleanup = (ev, listeners = []) => {
    listeners.forEach(([n, h]) => el.removeEventListener(n, h));
    if (created) el.remove();
  };
  return { el, cleanup };
};

export const openConfigModal = async ({ parent = document.body } = {}) => {
  const { el, cleanup } = await _createModal('./ConfigModal.lit.js', 'config-modal', {
    parent,
    autoOpen: true,
  });
  return new Promise((resolve) => {
    const onClose = (e) => {
      cleanup(e, [['modal-close', onClose]]);
      resolve(e?.detail ?? null);
    };
    el.addEventListener('modal-close', onClose);
  });
};

export const openHelpModal = async (opts = { parent: document.body }) => {
  const { el, cleanup } = await _createModal('./HelpModal.lit.js', 'help-modal', {
    parent: opts.parent,
  });
  return new Promise((resolve) => {
    const onClose = (e) => {
      cleanup(e, [['modal-close', onClose]]);
      resolve(e?.detail ?? null);
    };
    el.addEventListener('modal-close', onClose);
  });
};

export const openOnboardingModal = async (opts = { parent: document.body }) => {
  const { el, cleanup } = await _createModal(
    './OnboardingModal.lit.js',
    'onboarding-modal',
    {
      parent: opts.parent,
    }
  );
  return new Promise((resolve) => {
    const onClose = (e) => {
      cleanup(e, [['modal-close', onClose]]);
      resolve(e?.detail ?? null);
    };
    el.addEventListener('modal-close', onClose);
  });
};

export const openPublishScenarioModal = async ({
  overrides = {},
  pendingGroupChanges = [],
  decisions = [],
  conflicts = [],
  publicationContext,
  state = null,
  parent = document.body,
} = {}) => {
  const { el, cleanup } = await _createModal(
    './PublishScenarioModal.lit.js',
    'publish-scenario-modal',
    {
      parent,
      attrs: { overrides, pendingGroupChanges, decisions, conflicts, state,
        ...(publicationContext === undefined ? {} : { publicationContext }) },
    }
  );
  return new Promise((resolve) => {
    const onSave = (e) => {
      cleanup(e, [
        ['scenario-publish', onSave],
        ['modal-close', onClose],
      ]);
      resolve(e.detail);
    };
    const onClose = () => {
      cleanup(null, [
        ['scenario-publish', onSave],
        ['modal-close', onClose],
      ]);
      resolve(null);
    };
    el.addEventListener('scenario-publish', onSave);
    el.addEventListener('modal-close', onClose);
  });
};

export const openEmptyBoardModal = async ({ parent = document.body } = {}) => {
  const { el, cleanup } = await _createModal(
    './EmptyBoardModal.lit.js',
    'empty-board-modal',
    {
      parent,
    }
  );
  return new Promise((resolve) => {
    const onClose = (e) => {
      cleanup(e, [['modal-close', onClose]]);
      resolve(e?.detail ?? null);
    };
    el.addEventListener('modal-close', onClose);
  });
};

const _simpleModal = async (
  modulePath,
  tagName,
  { id, name, parent = document.body, attrs: extraAttrs = {} } = {}
) => {
  const attrs = { ...extraAttrs };
  if (id) attrs.id = id;
  if (name) attrs.name = name;
  const { el, cleanup } = await _createModal(modulePath, tagName, {
    parent,
    attrs,
  });
  return new Promise((resolve) => {
    const onClose = (e) => {
      cleanup(e, [['modal-close', onClose]]);
      resolve(e?.detail ?? null);
    };
    el.addEventListener('modal-close', onClose);
  });
};

export const openScenarioCloneModal = (opts = {}) =>
  _simpleModal('./ScenarioCloneModal.lit.js', 'scenario-clone-modal', opts);
export const openScenarioRenameModal = (opts = {}) =>
  _simpleModal('./ScenarioRenameModal.lit.js', 'scenario-rename-modal', opts);
export const openScenarioDeleteModal = (opts = {}) =>
  _simpleModal('./ScenarioDeleteModal.lit.js', 'scenario-delete-modal', opts);

export const openViewSaveModal = (opts = {}) =>
  _simpleModal('./ViewSaveModal.lit.js', 'view-save-modal', opts);
export const openViewRenameModal = ({ id, ...opts } = {}) =>
  _simpleModal('./ViewRenameModal.lit.js', 'view-rename-modal', {
    ...opts,
    attrs: id ? { viewId: id } : {},
  });
export const openViewDeleteModal = (opts = {}) =>
  _simpleModal('./ViewDeleteModal.lit.js', 'view-delete-modal', opts);
