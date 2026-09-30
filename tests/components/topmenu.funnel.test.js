import { expect } from '@open-wc/testing';
import '../../www/js/components/TopMenu.lit.js';
import { sel } from '../../www/js/application/imports.js';
import { pluginManager } from '../../www/js/core/PluginManager.js';
import { SampleMenuPlugin } from '../../www/js/plugins/SampleMenuPlugin.js';
import modulesConfig from '../../www/js/modules.config.json';

describe('TopMenu Data Funnel', () => {
  let menu;

  beforeEach(async () => {
    await customElements.whenDefined('top-menu-bar');
    menu = document.createElement('top-menu-bar');
    document.body.appendChild(menu);
    await menu.updateComplete;
  });

  afterEach(async () => {
    if (menu && menu.isConnected) menu.remove();
    for (const id of ['test-after-menu', 'test-before-menu', 'test-active-tool']) {
      await pluginManager.unregister(id);
    }
  });

  async function registerMenu(id, menuPosition) {
    const config = modulesConfig.modules.find((entry) => entry.id === 'sample-menu-plugin');
    const plugin = new SampleMenuPlugin(id, { ...config, id, enabled: true, menuPosition });
    await pluginManager.register(plugin);
    await menu.updateComplete;
    return plugin;
  }

  it('places plugin menus after Scope on both sides of Tools', async () => {
    await registerMenu('test-before-menu', 'before-tools');
    await registerMenu('test-after-menu', 'after-tools');
    const labels = [...menu.shadowRoot.querySelectorAll('.menu-item')].map((element) =>
      element.dataset.pluginId === undefined ? element.id : element.dataset.pluginId);
    expect(labels.slice(-4)).to.deep.equal([
      'scopeMenuBtn', 'test-before-menu', 'toolsMenuBtn', 'test-after-menu',
    ]);
  });

  it('opens and closes a dropdown without deactivating the current tool', async () => {
    const tool = {
      id: 'test-active-tool', config: { dependencies: [], type: 'tool' },
      async init() {}, async activate() {}, async deactivate() {}, async destroy() {},
      getMetadata() { return { id: this.id, type: 'tool' }; },
    };
    await pluginManager.register(tool);
    await pluginManager.activate(tool.id);
    const plugin = await registerMenu('test-before-menu', 'before-tools');
    const trigger = menu.shadowRoot.querySelector('[data-plugin-id="test-before-menu"]');
    trigger.click();
    await menu.updateComplete;
    const content = menu.shadowRoot.querySelector('sample-menu-plugin-content');
    await content.updateComplete;
    expect(content).to.exist;
    expect(tool.active).to.equal(true);
    expect(plugin.active).to.equal(false);
    content.shadowRoot.querySelector('.close').click();
    await menu.updateComplete;
    expect(menu.openMenu).to.equal(null);
    expect(menu.shadowRoot.activeElement).to.equal(trigger);
  });

  it('dismisses with Escape and removes an unregistered plugin menu', async () => {
    await registerMenu('test-before-menu', 'before-tools');
    const trigger = menu.shadowRoot.querySelector('[data-plugin-id="test-before-menu"]');
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    await menu.updateComplete;
    expect(menu.openMenu).to.equal('plugin:test-before-menu');
    menu.shadowRoot.querySelector('.plugin-menu-popover').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await menu.updateComplete;
    expect(menu.openMenu).to.equal(null);
    trigger.click();
    await menu.updateComplete;
    await pluginManager.unregister('test-before-menu');
    await menu.updateComplete;
    expect(menu.openMenu).to.equal(null);
    expect(menu.shadowRoot.querySelector('[data-plugin-id="test-before-menu"]')).to.equal(null);
  });

  it('renders canonical funnel metrics instead of a Team trigger', async () => {
    const originalGetFunnel = sel.scope.getFunnel;
    sel.scope.getFunnel = () => ({
      baseTasks: 4,
      relatedTasks: 3,
      tasksInScope: 7,
      teamsInScope: 3,
      tasksVisible: 5,
      teamsInView: 2,
    });
    menu.funnel = sel.scope.getFunnel();
    menu.requestUpdate();
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    const summary = root.querySelector('#dataFunnelSummary');
    expect(summary.textContent).to.include('7');
    expect(summary.textContent).to.include('3');
    expect(summary.textContent).to.include('5');
    expect(summary.querySelector('[title="Tasks included in the selected plan scope before display filters"]')).to.exist;
    expect(summary.querySelector('[title="Participating teams allocated to tasks in the selected plan scope"]')).to.exist;
    expect(summary.querySelector('[title="Tasks currently displayed after team focus and task filters"]')).to.exist;
    expect(summary.classList.contains('data-funnel-status')).to.equal(true);
    expect(summary.parentElement.classList.contains('menu-right')).to.equal(true);
    expect(root.querySelector('#teamMenuBtn')).to.equal(null);
    sel.scope.getFunnel = originalGetFunnel;
  });

  it('includes Scope as the related-work menu and reports base and related work', async () => {
    menu.funnel = {
      baseTasks: 5,
      relatedTasks: 2,
      tasksInScope: 7,
      teamsInScope: 3,
      tasksVisible: 7,
      teamsInView: 3,
    };
    menu.requestUpdate();
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    expect(root.querySelector('#scopeMenuBtn')).to.exist;
    expect(root.querySelector('#dataFunnelSummary').textContent)
      .to.include('7');
  });

  it('shows active Scope relationship icons in the top menu', async () => {
    menu.scopeContext = { parent: true, child: false, dependency: true, otherAllocations: false };
    menu.requestUpdate();
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    expect(root.querySelector('#scopeMenuBtn').textContent).to.include('↑');
    expect(root.querySelector('#scopeMenuBtn').textContent).to.include('↔');
  });
});