import { expect } from '@open-wc/testing';
import { vi } from 'vitest';
import '../../www/js/components/TopMenu.lit.js';
import { sel } from '../../www/js/application/imports.js';
import { pluginManager } from '../../www/js/core/PluginManager.js';
import { SampleMenuPlugin } from '../../www/js/plugins/SampleMenuPlugin.js';
import PluginReconciliation from '../../www/js/plugins/PluginReconciliation.js';
import modulesConfig from '../../www/js/modules.config.json';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';

describe('TopMenu Data Funnel', () => {
  let menu;

  beforeEach(async () => {
    await customElements.whenDefined('top-menu-bar');
    menu = document.createElement('top-menu-bar');
    document.body.appendChild(menu);
    await menu.updateComplete;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (menu && menu.isConnected) menu.remove();
    for (const id of ['test-after-menu', 'test-before-menu', 'test-active-tool', 'plugin-reconciliation']) {
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

  it('shows the selected plan name only when exactly one plan is selected', async () => {
    const projects = [
      { id: 'first', name: 'First plan', selected: false },
      { id: 'second', name: 'Second plan', selected: false },
    ];
    vi.spyOn(sel.selection, 'getProjects').mockImplementation(() => [...projects]);

    menu._onProjectsChanged();
    await menu.updateComplete;
    const trigger = menu.shadowRoot.querySelector('#planMenuBtn');
    expect(trigger.querySelector('.menu-count-badge')).to.equal(null);

    projects[0].selected = true;
    projects[1].selected = true;
    menu._onProjectsChanged();
    await menu.updateComplete;
    expect(trigger.querySelector('.menu-count-badge').textContent).to.equal('2');

    projects[0].selected = false;
    menu._onProjectsChanged();
    await menu.updateComplete;
    expect(trigger.querySelector('.menu-count-badge').textContent).to.equal('Second plan');

    projects[0].selected = true;
    projects[1].selected = false;
    menu._onProjectsChanged();
    await menu.updateComplete;
    expect(trigger.querySelector('.menu-count-badge').textContent).to.equal('First plan');
  });

  it('places plugin menus after Scope on both sides of Tools', async () => {
    await registerMenu('test-before-menu', 'before-tools');
    await registerMenu('test-after-menu', 'after-tools');
    const labels = [...menu.shadowRoot.querySelectorAll('.menu-item')].map((element) =>
      element.dataset.pluginId === undefined ? element.id : element.dataset.pluginId);
    expect(labels.slice(-4)).to.deep.equal([
      'scopeMenuBtn', 'test-before-menu', 'toolsMenuBtn', 'test-after-menu',
    ]);
  });

  it('opens a menu without a close button and dismisses with Escape', async () => {
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

  it('opens the Reconciliation shell without replacing an active tool and returns focus', async () => {
    const tool = {
      id: 'test-active-tool', config: { dependencies: [], type: 'tool' },
      async init() {}, async activate() {}, async deactivate() {}, async destroy() {},
      getMetadata() { return { id: this.id, type: 'tool' }; },
    };
    await pluginManager.register(tool);
    await pluginManager.activate(tool.id);
    const config = modulesConfig.modules.find((entry) => entry.id === 'plugin-reconciliation');
    const plugin = new PluginReconciliation(config.id, config);
    await pluginManager.register(plugin);
    await menu.updateComplete;
    const trigger = menu.shadowRoot.querySelector('[data-plugin-id="plugin-reconciliation"]');
    trigger.click();
    await menu.updateComplete;
    const content = menu.shadowRoot.querySelector('plugin-reconciliation-content');
    await content.updateComplete;
    expect(content.shadowRoot.querySelectorAll('[data-category]').length).to.equal(2);
    expect(content.shadowRoot.querySelector('.close')).to.equal(null);
    expect(tool.active).to.equal(true);
    expect(plugin.active).to.equal(false);
    menu.shadowRoot.querySelector('.plugin-menu-popover').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
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

  it('updates a menu attention badge while its dropdown is closed', async () => {
    const plugin = await registerMenu('test-before-menu', 'before-tools');
    const metadata = plugin.getMetadata();
    vi.spyOn(plugin, 'getMetadata').mockReturnValue({ ...metadata, attentionCount: 4 });
    bus.emit(PluginEvents.MENU_STATUS_CHANGED, { id: plugin.id });
    await menu.updateComplete;
    const trigger = menu.shadowRoot.querySelector('[data-plugin-id="test-before-menu"]');
    expect(trigger.querySelector('.menu-attention').textContent).to.equal('4');
    expect(menu.openMenu).to.equal(null);
    plugin.getMetadata.mockReturnValue({ ...metadata, attentionCount: 0 });
    bus.emit(PluginEvents.MENU_STATUS_CHANGED, { id: plugin.id });
    await menu.updateComplete;
    expect(trigger.querySelector('.menu-attention')).to.equal(null);
  });

  it('opens a reconciled information menu from the on-board count', async () => {
    const counts = {
      selectedPlanTasks: 10, sharedPlanTasks: 2,
      scopeAddedTasks: 4, scopeExcludedTasks: 3,
      displayableTasks: 9, taskFilterExcludedTasks: 2, teamExcludedTasks: 2,
      filterExclusions: { schedule: 1, allocation: 0, hierarchy: 0, relations: 0, state: 0, taskTypes: 1 },
      tasksVisible: 5,
      teamsInScope: 3,
    };
    vi.spyOn(sel.scope, 'getBoardBreakdown').mockReturnValue(counts);
    menu._onScopeChanged();
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    const trigger = root.querySelector('#boardInfoBtn');
    expect(trigger.textContent).to.include('5 on board');
    expect(root.querySelector('#dataFunnelSummary')).to.equal(null);
    expect(root.querySelector('#teamMenuBtn')).to.equal(null);
    trigger.click();
    await menu.updateComplete;
    expect(trigger.getAttribute('aria-expanded')).to.equal('true');
    const information = root.querySelector('#boardInformation');
    expect(information).to.exist;
    expect([...information.querySelectorAll('.count-value')].map((value) => value.textContent.trim()))
      .to.deep.equal(['10', '-2', '+4', '-3', '=9', '-1', '-0', '-0', '-0', '-0', '-1', '-2', '=5']);
    expect(information.textContent).to.include('Selected plans (Plan menu total)');
    expect(information.textContent).to.include('Added by Scope');
    expect(information.textContent).to.include('Excluded from current scope');
    for (const label of ['Schedule', 'Allocation', 'Hierarchy', 'Relations', 'State', 'Task Types']) {
      expect(information.textContent).to.include(label);
    }
    expect(information.textContent).to.include('Team selection / focus');
    expect(information.textContent).to.include('3 teams in scope');
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await menu.updateComplete;
    expect(root.querySelector('#boardInformation')).to.equal(null);
    expect(root.activeElement).to.equal(trigger);
  });

  it('keeps Scope separate from the board information menu', async () => {
    await menu.updateComplete;

    const root = menu.shadowRoot || menu;
    expect(root.querySelector('#scopeMenuBtn')).to.exist;
    expect(root.querySelector('#boardInfoBtn')).to.exist;
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