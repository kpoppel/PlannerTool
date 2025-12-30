// Lightweight helpers to open common modal components.
// Helpers dynamically import the module, create or reuse an element,
// wait for user action events, then cleanup and resolve with a value.

const _createModal = async (modulePath, tagName, { parent = document.body, attrs = {}, autoOpen = false } = {}) => {
  await import(modulePath);
  const existing = parent.querySelector(tagName);
  let el;
  let created = false;
  if (existing) el = existing; else { el = document.createElement(tagName); parent.appendChild(el); created = true; }
  Object.assign(el, attrs);
  if (autoOpen) {
    const inner = el.querySelector('modal-lit'); if (inner) inner.open = true;
  }
  if (el.updateComplete) await el.updateComplete;
  const cleanup = (ev, listeners=[]) => { listeners.forEach(([n, h]) => el.removeEventListener(n, h)); if (created) el.remove(); };
  return { el, cleanup };
};

export const openConfigModal = async (opts={ parent: document.body }) => {
  const { el, cleanup } = await _createModal('./ConfigModal.lit.js', 'config-modal', { parent: opts.parent, autoOpen: true });
  return new Promise(resolve => {
    const onClose = (e) => { cleanup(e, [['modal-close', onClose]]); resolve(e?.detail ?? null); };
    el.addEventListener('modal-close', onClose);
  });
};

export const openHelpModal = async (opts={ parent: document.body }) => {
  const { el, cleanup } = await _createModal('./HelpModal.lit.js', 'help-modal', { parent: opts.parent });
  return new Promise(resolve => {
    const onClose = (e) => { cleanup(e, [['modal-close', onClose]]); resolve(e?.detail ?? null); };
    el.addEventListener('modal-close', onClose);
  });
};

export const openAzureDevopsModal = async ({ overrides = {}, state = null, parent = document.body } = {}) => {
  const { el, cleanup } = await _createModal('./AzureDevopsModal.lit.js', 'azure-devops-modal', { parent, attrs: { overrides, state } });
  return new Promise(resolve => {
    const onSave = (e) => { cleanup(e, [['azure-save', onSave], ['modal-close', onClose]]); resolve(e.detail ?? []); };
    const onClose = () => { cleanup(null, [['azure-save', onSave], ['modal-close', onClose]]); resolve(null); };
    el.addEventListener('azure-save', onSave);
    el.addEventListener('modal-close', onClose);
  });
};

const _simpleModal = async (modulePath, tagName, { id, name, parent = document.body } = {}) => {
  const attrs = {};
  if (id) attrs.id = id; if (name) attrs.name = name;
  const { el, cleanup } = await _createModal(modulePath, tagName, { parent, attrs });
  return new Promise(resolve => {
    const onClose = (e) => { cleanup(e, [['modal-close', onClose]]); resolve(e?.detail ?? null); };
    el.addEventListener('modal-close', onClose);
  });
};

export const openScenarioCloneModal = (opts={}) => _simpleModal('./ScenarioCloneModal.lit.js', 'scenario-clone-modal', opts);
export const openScenarioRenameModal = (opts={}) => _simpleModal('./ScenarioRenameModal.lit.js', 'scenario-rename-modal', opts);
export const openScenarioDeleteModal = (opts={}) => _simpleModal('./ScenarioDeleteModal.lit.js', 'scenario-delete-modal', opts);
