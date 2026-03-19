// Lightweight helpers to open common modal components.
// Helpers dynamically import the module, create or reuse an element,
// wait for user action events, then cleanup and resolve with a value.

const _availableStaticImports = (typeof import.meta !== 'undefined' && typeof import.meta.glob === 'function') ? import.meta.glob('./*.js') : {};

const _createModal = async (modulePath, tagName, { parent = document.body, attrs = {}, autoOpen = false } = {}) => {
  // Prefer build-time glob imports so the bundler includes modal files and
  // loads them with their hashed chunk URLs automatically. Keys in
  // `_availableStaticImports` are relative to this file (e.g. './ConfigModal.lit.js').
  let importedViaGlob = false;
  try {
    const keyCandidates = [modulePath, './' + modulePath.replace(/^\.\//, ''), modulePath.replace(/^\.\//, './')];
    for (const k of keyCandidates) {
      if (k && Object.prototype.hasOwnProperty.call(_availableStaticImports, k)) {
        // Call the importer function returned by import.meta.glob
        await _availableStaticImports[k]();
        importedViaGlob = true;
        break;
      }
    }
  } catch (e) {
    // Ignore and fallthrough to resolver/fallback below
  }

  if (!importedViaGlob) {
    // If the glob didn't handle it (e.g., running in dev server without build),
    // fall back to asking the server for a resolved URL, then import that.
    try {
      const res = await fetch(`/api/assets/resolve?path=${encodeURIComponent(modulePath)}`);
      if (res && res.ok) {
        const j = await res.json();
        if (j && j.url) {
          await import(j.url);
        } else {
          await import(modulePath);
        }
      } else {
        await import(modulePath);
      }
    } catch (e) {
      // Last resort: direct import
      await import(modulePath);
    }
  }
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

export const openOnboardingModal = async (opts={ parent: document.body }) => {
  const { el, cleanup } = await _createModal('./OnboardingModal.lit.js', 'onboarding-modal', { parent: opts.parent });
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

export const openEmptyBoardModal = async ({ parent = document.body } = {}) => {
  const { el, cleanup } = await _createModal('./EmptyBoardModal.lit.js', 'empty-board-modal', { parent });
  return new Promise(resolve => {
    const onClose = (e) => { cleanup(e, [['modal-close', onClose]]); resolve(e?.detail ?? null); };
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

export const openViewSaveModal = (opts={}) => _simpleModal('./ViewSaveModal.lit.js', 'view-save-modal', opts);
export const openViewRenameModal = (opts={}) => _simpleModal('./ViewRenameModal.lit.js', 'view-rename-modal', opts);
export const openViewDeleteModal = (opts={}) => _simpleModal('./ViewDeleteModal.lit.js', 'view-delete-modal', opts);
