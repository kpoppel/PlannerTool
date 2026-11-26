import { expect } from '@open-wc/testing';
import { vi } from 'vitest';
import '../../www/js/components/TopMenu.lit.js';
import { cmd, sel } from '../../www/js/application/imports.js';
import { store } from '../../www/js/application/store.js';
import { pluginManager } from '../../www/js/core/PluginManager.js';
import { SampleMenuPlugin } from '../../www/js/plugins/SampleMenuPlugin.js';
import PluginReconciliation from '../../www/js/plugins/PluginReconciliation.js';
import modulesConfig from '../../www/js/modules.config.json';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';

describe('TopMenu Data Funnel', () => {
  let menu;

  beforeEach(async () => {
    store.setState({ notifications: [] });
    await customElements.whenDefined('top-menu-bar');
    menu = document.createElement('top-menu-bar');
    document.body.appendChild(menu);
    await menu.updateComplete;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it('opens board controls without mounting a sidebar and restores focus on Escape', async () => {
    expect(menu.shadowRoot.querySelector('#teamsMenuBtn')).to.equal(null);
    expect(menu.shadowRoot.querySelector('#hierarchyMenuBtn')).to.equal(null);
    for (const [name, label] of [['filters', 'Filters']]) {
      const trigger = menu.shadowRoot.querySelector(`#${name}MenuBtn`);
      expect(trigger, label).to.exist;
      trigger.click();
      await menu.updateComplete;
      const controls = menu.shadowRoot.querySelector('board-controls-menu');
      await controls.updateComplete;
      expect(controls.section).to.equal('all');
      expect(controls.getAttribute('aria-label')).to.equal(label);
      expect(controls.shadowRoot.querySelector('[aria-label="Teams"]')).to.exist;
      expect(controls.shadowRoot.querySelector('[aria-label="Hierarchy"]')).to.exist;
      expect(controls.shadowRoot.querySelector('[aria-label="Task filters"]')).to.exist;
      expect(document.querySelector('app-sidebar')).to.equal(null);
      controls.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
      await menu.updateComplete;
      expect(menu.openMenu).to.equal(null);
      expect(menu.shadowRoot.activeElement).to.equal(trigger);
    }
  });

  it('offers configuration and administration from the gear for authorized users', async () => {
    menu.permissions = ['manage_projects'];
    menu.taskBackendId = 'ado';
    await menu.updateComplete;
    menu.shadowRoot.querySelector('#openConfigBtn').click();
    await menu.updateComplete;
    const settings = menu.shadowRoot.querySelector('[role="menu"][aria-label="Settings"]');
    expect(settings).to.exist;
    expect(settings.querySelector('#configurationMenuItem')).to.exist;
    expect(menu.shadowRoot.querySelector('.settings-chevron')).to.exist;
    expect(menu.shadowRoot.querySelector('.application-link[aria-label="Open administration"]')).to.equal(null);
    expect([...settings.querySelectorAll('a')].map((link) => link.textContent.trim()))
      .to.deep.equal(['Azure DevOps']);
    expect(settings.querySelector('a').getAttribute('href')).to.equal('/admin/#ado');
    menu.permissions = ['manage_workforce_costs', 'manage_iterations'];
    await menu.updateComplete;
    expect([...settings.querySelectorAll('a')].map((link) => link.textContent.trim()))
      .to.deep.equal(['Azure DevOps', 'Workforce']);
    menu.permissions = [];
    await menu.updateComplete;
    expect(settings.querySelector('a')).to.equal(null);
  });

  it('loads current permissions through the installation-scoped account endpoint', async () => {
    const request = vi.spyOn(window, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => url.endsWith('/task-backend')
        ? { id: 'local', capabilities: ['task_create', 'task_read'] } : { permissions: ['admin'] },
    }));
    menu.baseUrl = '/planner';
    await menu.loadPermissions();
    await menu.updateComplete;
    expect(menu.taskCapabilities).to.deep.equal(['task_create', 'task_read']);
    expect(request.mock.calls[0][0]).to.equal('/planner/api/auth/me');
    menu.shadowRoot.querySelector('#openConfigBtn').click();
    await menu.updateComplete;
    expect(menu.shadowRoot.querySelector('[role="menuitem"][data-section="local"]').getAttribute('href'))
      .to.equal('/planner/admin/#local');
  });

  it('reuses the header in admin mode without board controls and preserves proxy paths', async () => {
    const adminMenu = document.createElement('top-menu-bar');
    adminMenu.application = 'admin';
    adminMenu.baseUrl = '/planner';
    adminMenu.permissions = ['admin'];
    document.body.append(adminMenu);
    try {
      await adminMenu.updateComplete;
      expect(adminMenu.shadowRoot.querySelector('[aria-label="Open planner"]').getAttribute('href'))
        .to.equal('/planner/');
      expect(adminMenu.shadowRoot.querySelector('#planMenuBtn')).to.equal(null);
      expect(adminMenu.shadowRoot.querySelector('#boardInfoBtn')).to.equal(null);
      expect(adminMenu.shadowRoot.querySelector('.app-title').textContent).to.include('Planner');
    } finally {
      adminMenu.remove();
    }
  });

  it('collects repeated warnings quietly and marks the log read when opened', async () => {
    expect(menu.shadowRoot.querySelector('#notificationsBtn')).to.equal(null);
    const notice = { source: 'Backend', code: 'schedule_missing', severity: 'warning',
      message: '3 items have an assigned schedule that could not be found.' };
    cmd.ui.addNotification(notice);
    cmd.ui.addNotification(notice);
    await menu.updateComplete;
    const trigger = menu.shadowRoot.querySelector('#notificationsBtn');
    expect(trigger).to.exist;
    expect(trigger.getAttribute('aria-label')).to.equal('Notification log');
    expect(trigger.querySelector('.notification-bell')).to.exist;
    expect(trigger.nextElementSibling.id).to.equal('openConfigBtn');
    expect(trigger.querySelector('.menu-attention').textContent.trim()).to.equal('1');
    expect(menu.openMenu).to.equal(null);
    expect(document.getElementById('app-message-modal')).to.equal(null);
    trigger.click();
    await menu.updateComplete;
    const log = menu.shadowRoot.querySelector('#notificationLog');
    expect(log.textContent).to.include(notice.message);
    expect(log.textContent).to.include('2 occurrences');
    expect(store.getState().notifications[0].unread).to.equal(false);
    expect(trigger.querySelector('.menu-attention')).to.equal(null);
    cmd.ui.addNotification(notice);
    await menu.updateComplete;
    expect(store.getState().notifications[0].count).to.equal(3);
    expect(store.getState().notifications[0].unread).to.equal(false);
    log.querySelector('#clearNotificationsBtn').click();
    await menu.updateComplete;
    expect(store.getState().notifications.length).to.equal(0);
    expect(menu.shadowRoot.querySelector('#notificationLog')).to.equal(null);
    expect(menu.shadowRoot.activeElement.id).to.equal('openConfigBtn');
    expect(menu.shadowRoot.querySelector('#notificationsBtn')).to.equal(null);
  });

  it('keeps a bounded log, treats new occurrences as unread, and rejects invalid notices', () => {
    for (let index = 0; index < 105; index += 1) {
      cmd.ui.addNotification({ source: 'Backend', code: String(index), severity: 'info',
        message: `Notice ${index}` });
    }
    expect(store.getState().notifications.length).to.equal(100);
    expect(store.getState().notifications[0].message).to.equal('Notice 104');
    cmd.ui.markNotificationsRead();
    cmd.ui.addNotification({ source: 'Backend', code: '104', severity: 'info', message: 'Notice 104' });
    expect(store.getState().notifications[0].unread).to.equal(true);
    expect(() => cmd.ui.addNotification({ message: '', severity: 'warning' })).to.throw();
  });

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

  it('shows the active tool name or count and clears the badge when none are active', async () => {
    const tools = [
      { id: 'first-tool', name: 'First tool' },
      { id: 'second-tool', name: 'Second tool' },
    ];
    const activeIds = new Set();
    vi.spyOn(pluginManager, 'listTools').mockImplementation(() => tools);
    vi.spyOn(pluginManager, 'isActive').mockImplementation((id) => activeIds.has(id));
    const badge = () => menu.shadowRoot.querySelector('#toolsMenuBtn .menu-count-badge');
    expect(badge()).to.equal(null);

    activeIds.add('first-tool');
    bus.emit(PluginEvents.ACTIVATED, { plugin: 'first-tool' });
    await menu.updateComplete;
    expect(badge().textContent).to.equal('First tool');

    activeIds.add('second-tool');
    bus.emit(PluginEvents.ACTIVATED, { plugin: 'second-tool' });
    await menu.updateComplete;
    expect(badge().textContent).to.equal('2');

    activeIds.delete('first-tool');
    bus.emit(PluginEvents.DEACTIVATED, { plugin: 'first-tool' });
    await menu.updateComplete;
    expect(badge().textContent).to.equal('Second tool');

    tools.pop();
    bus.emit(PluginEvents.UNREGISTERED, { plugin: 'second-tool' });
    await menu.updateComplete;
    expect(badge()).to.equal(null);
  });

  it('shows a tool that is already active when the top menu connects', async () => {
    menu.remove();
    vi.spyOn(pluginManager, 'listTools').mockReturnValue([
      { id: 'existing-tool', name: 'Existing tool' },
    ]);
    vi.spyOn(pluginManager, 'isActive').mockReturnValue(true);
    menu = document.createElement('top-menu-bar');
    document.body.appendChild(menu);
    await menu.updateComplete;
    expect(menu.shadowRoot.querySelector('#toolsMenuBtn .menu-count-badge').textContent)
      .to.equal('Existing tool');
  });

  it('places Scope before Filters and plugin menus on both sides of Tools', async () => {
    await registerMenu('test-before-menu', 'before-tools');
    await registerMenu('test-after-menu', 'after-tools');
    const labels = [...menu.shadowRoot.querySelectorAll('.menu-item')].map((element) =>
      element.dataset.pluginId === undefined ? element.id : element.dataset.pluginId);
    expect(labels.slice(-5)).to.deep.equal([
      'scopeMenuBtn', 'filtersMenuBtn', 'test-before-menu', 'toolsMenuBtn', 'test-after-menu',
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
    const content = document.querySelector('reconciliation-review');
    await content.updateComplete;
    expect(content.shadowRoot.querySelectorAll('[data-category]').length).to.equal(2);
    expect(content.shadowRoot.querySelector('.close')).to.equal(null);
    expect(tool.active).to.equal(true);
    expect(plugin.active).to.equal(false);
    expect(menu.shadowRoot.querySelector('.plugin-menu-popover')).to.equal(null);
    expect(trigger.getAttribute('aria-pressed')).to.equal('true');
    trigger.click();
    await menu.updateComplete;
    expect(menu.openMenu).to.equal(null);
    expect(document.querySelector('reconciliation-review')).to.equal(null);
    expect(trigger.getAttribute('aria-pressed')).to.equal('false');
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