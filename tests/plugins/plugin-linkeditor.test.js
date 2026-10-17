import { expect } from '@open-wc/testing';
import sinon from 'sinon';
import PluginLinkEditor from '../../www/js/plugins/PluginLinkEditor.js';
import { getLinkEditorState, ACTIONS } from '../../www/js/plugins/linkeditor/LinkEditorState.js';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { cmd, sel } from '../../www/js/application/imports.js';

describe('PluginLinkEditor lifecycle', () => {
  it('creates editable relations through the guarded feature command without mutating source relations', () => {
    const relations = [{ type: 'Related', id: 'existing' }];
    const editable = sinon.stub(sel.scenario, 'isActiveScenarioMutable').returns(true);
    const feature = sinon.stub(sel.feature, 'getEffectiveFeatureById').returns({ id: 'source', relations });
    const update = sinon.stub(cmd.feature, 'updateFeatureField').returns({ id: 'source' });
    try {
      const state = getLinkEditorState();
      state.startAction(ACTIONS.RELATED, 'source');
      expect(state.completeAction('target')).to.be.true;
      expect(update.calledOnceWithExactly('source', 'relations', [
        { type: 'Related', id: 'existing' }, { type: 'Related', id: 'target' },
      ])).to.be.true;
      expect(relations).to.deep.equal([{ type: 'Related', id: 'existing' }]);
      expect(state.pendingAction).to.equal(null);
    } finally { editable.restore(); feature.restore(); update.restore(); }
  });

  it('does not enable or start relation edits in a read-only scenario', () => {
    const previous = store.getState();
    store.setState(createInitialAppState(), true);
    try {
      const state = getLinkEditorState();
      state.enable();
      state.startAction(ACTIONS.RELATED, 'task');
      expect(state.enabled).to.be.false;
      expect(state.pendingAction).to.equal(null);
    } finally { store.setState(previous, true); }
  });

  it('inits, activates, deactivates and destroys', async () => {
    const plugin = new PluginLinkEditor('link-editor', {});

    // MountedPlugin.init only calls _ensureComponent (which is no-op when componentPath is empty)
    // and _resolveHost. It does not need any mock element.
    await plugin.init();
    expect(plugin.initialized).to.be.true;

    // Provide the app host so MountedPlugin can resolve _host without failing in JSDOM
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    plugin._host = app;

    // Mock component loaded and element creation to avoid Lit/JSDOM issues
    plugin._componentLoaded = true;

    await plugin.activate();
    expect(plugin.active).to.be.true;

    await plugin.deactivate();
    expect(plugin.active).to.be.false;

    await plugin.destroy();
    expect(plugin._el).to.equal(null);
  });
});
