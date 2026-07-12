// Lightweight helpers to open common modal components.
// Helpers lazy-load the module via static imports, create or reuse an element,
// wait for user action events, then cleanup and resolve with a value.

// Static import map for all modal modules (bundler includes them and emits hashed filenames)
const _modalImports = {
  './ConfigModal.lit.js': () => import('./ConfigModal.lit.js'),
  './HelpModal.lit.js': () => import('./HelpModal.lit.js'),
  './OnboardingModal.lit.js': () => import('./OnboardingModal.lit.js'),
  './AzureDevopsModal.lit.js': () => import('./AzureDevopsModal.lit.js'),
  './EmptyBoardModal.lit.js': () => import('./EmptyBoardModal.lit.js'),
  './ScenarioCloneModal.lit.js': () => import('./ScenarioCloneModal.lit.js'),
  './ScenarioRenameModal.lit.js': () => import('./ScenarioRenameModal.lit.js'),
  './ScenarioDeleteModal.lit.js': () => import('./ScenarioDeleteModal.lit.js'),
  './ViewSaveModal.lit.js': () => import('./ViewSaveModal.lit.js'),
  './ViewRenameModal.lit.js': () => import('./ViewRenameModal.lit.js'),
  './ViewDeleteModal.lit.js': () => import('./ViewDeleteModal.lit.js'),
};

const MODAL_CLOSE_EVENT = 'modal-close';
const MODAL_SUBMIT_EVENT = 'modal-submit';

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

const _waitForModalResult = (el, cleanup, {
  submitEvent,
  submitValue = (e) => e?.detail ?? null,
  closeEvent = MODAL_CLOSE_EVENT,
  closeValue = (e) => e?.detail ?? null,
}) => new Promise((resolve) => {
  const listeners = [];
  const done = (value) => {
    cleanup(null, listeners);
    resolve(value);
  };
  if (submitEvent) {
    const onSubmit = (e) => done(submitValue(e));
    listeners.push([submitEvent, onSubmit]);
    el.addEventListener(submitEvent, onSubmit);
  }
  if (closeEvent) {
    const onClose = (e) => done(closeValue(e));
    listeners.push([closeEvent, onClose]);
    el.addEventListener(closeEvent, onClose);
  }
});

const _openAndWaitForClose = async (modulePath, tagName, {
  parent = document.body,
  attrs = {},
  autoOpen = false,
} = {}) => {
  const { el, cleanup } = await _createModal(modulePath, tagName, {
    parent,
    attrs,
    autoOpen,
  });
  return _waitForModalResult(el, cleanup, {});
};

export const openConfigModal = async (opts = { parent: document.body }) => {
  return _openAndWaitForClose('./ConfigModal.lit.js', 'config-modal', {
    parent: opts.parent,
    autoOpen: true,
  });
};

export const openHelpModal = async (opts = { parent: document.body }) => {
  return _openAndWaitForClose('./HelpModal.lit.js', 'help-modal', {
    parent: opts.parent,
  });
};

export const openOnboardingModal = async (opts = { parent: document.body }) => {
  return _openAndWaitForClose('./OnboardingModal.lit.js', 'onboarding-modal', {
    parent: opts.parent,
  });
};

export const openAzureDevopsModal = async ({
  overrides = {},
  pendingGroupChanges = [],
  state = null,
  parent = document.body,
} = {}) => {
  const { el, cleanup } = await _createModal('./AzureDevopsModal.lit.js', 'azure-devops-modal', {
    parent,
    attrs: { overrides, pendingGroupChanges, state },
  });
  return _waitForModalResult(el, cleanup, {
    submitEvent: MODAL_SUBMIT_EVENT,
    submitValue: (e) => e?.detail ?? [],
    closeValue: () => null,
  });
};

export const openEmptyBoardModal = async ({ parent = document.body } = {}) => {
  return _openAndWaitForClose('./EmptyBoardModal.lit.js', 'empty-board-modal', {
    parent,
  });
};

const _simpleModal = async (
  modulePath,
  tagName,
  { id, name, parent = document.body } = {}
) => {
  const attrs = {};
  if (id) attrs.id = id;
  if (name) attrs.name = name;
  const { el, cleanup } = await _createModal(modulePath, tagName, {
    parent,
    attrs,
  });
  return _waitForModalResult(el, cleanup, {});
};

export const openScenarioCloneModal = (opts = {}) =>
  _simpleModal('./ScenarioCloneModal.lit.js', 'scenario-clone-modal', opts);
export const openScenarioRenameModal = (opts = {}) =>
  _simpleModal('./ScenarioRenameModal.lit.js', 'scenario-rename-modal', opts);
export const openScenarioDeleteModal = (opts = {}) =>
  _simpleModal('./ScenarioDeleteModal.lit.js', 'scenario-delete-modal', opts);

export const openViewSaveModal = (opts = {}) =>
  _simpleModal('./ViewSaveModal.lit.js', 'view-save-modal', opts);
export const openViewRenameModal = (opts = {}) =>
  _simpleModal('./ViewRenameModal.lit.js', 'view-rename-modal', opts);
export const openViewDeleteModal = (opts = {}) =>
  _simpleModal('./ViewDeleteModal.lit.js', 'view-delete-modal', opts);
