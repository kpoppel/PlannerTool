import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLocalPref: vi.fn(),
  setLocalPref: vi.fn(),
  getEffectiveFeatures: vi.fn(),
  getSelectedProjectIds: vi.fn(),
  getFeatureSortMode: vi.fn(),
  getFeatureStateCategory: vi.fn(),
  getSelectedFeatureStateNames: vi.fn(),
  getSelectedTaskTypeNames: vi.fn(),
  getTaskFilters: vi.fn(),
  getTaskTypeOptions: vi.fn(),
  getFeatureStates: vi.fn(),
  setFeatureSortMode: vi.fn(),
  setSelectedStates: vi.fn(),
  setSelectedTaskTypes: vi.fn(),
  setSelectedFeature: vi.fn(),
  setSidebarDisabledElements: vi.fn(),
  clearSidebarDisabledElements: vi.fn(),
}));
vi.mock('../../www/js/services/dataService.js', () => ({
  dataService: { getLocalPref: mocks.getLocalPref, setLocalPref: mocks.setLocalPref },
}));
vi.mock('../../www/js/application/imports.js', () => ({
  sel: {
    feature: {
      getEffectiveFeatures: mocks.getEffectiveFeatures,
      getTaskTypeOptions: mocks.getTaskTypeOptions,
    },
    selection: { getSelectedProjectIds: mocks.getSelectedProjectIds },
    view: { getFeatureSortMode: mocks.getFeatureSortMode },
    filter: {
      getFeatureStateCategory: mocks.getFeatureStateCategory,
      getFeatureStates: mocks.getFeatureStates,
      getSelectedFeatureStateNames: mocks.getSelectedFeatureStateNames,
      getSelectedTaskTypeNames: mocks.getSelectedTaskTypeNames,
      getTaskFilters: mocks.getTaskFilters,
    },
  },
  cmd: {
    view: { setFeatureSortMode: mocks.setFeatureSortMode },
    feature: { setSelectedFeature: mocks.setSelectedFeature },
      filter: {
        setSelectedStates: mocks.setSelectedStates,
        setSelectedTaskTypes: mocks.setSelectedTaskTypes,
        setSidebarDisabledElements: mocks.setSidebarDisabledElements,
        clearSidebarDisabledElements: mocks.clearSidebarDisabledElements,
      },
  },
}));

import { DEFAULT_SCOPES } from '../../www/js/plugins/coneOfUncertainty.js';
import '../../www/js/plugins/PluginConeOfUncertaintyComponent.lit.js';
import PluginConeOfUncertainty from '../../www/js/plugins/PluginConeOfUncertainty.js';
import { resolvePluginComponentLoader } from '../../www/js/plugins/MountedPlugin.js';
import PluginRegistry from '../../www/js/core/pluginRegistry.js';
import modulesConfig from '../../www/js/modules.config.json';
import { mergePluginConfig } from '../../www/js/core/pluginConfigMerge.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FeatureEvents, FilterEvents } from '../../www/js/core/EventRegistry.js';

async function mount() {
  const el = document.createElement('plugin-cone-of-uncertainty');
  document.body.append(el);
  await el.ready;
  await el.updateComplete;
  return el;
}

describe('cone of uncertainty plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalPref.mockResolvedValue(undefined);
    mocks.setLocalPref.mockResolvedValue(undefined);
    mocks.getSelectedProjectIds.mockReturnValue(['p1']);
    mocks.getFeatureSortMode.mockReturnValue('rank');
    mocks.getFeatureStateCategory.mockReturnValue(undefined);
    mocks.getSelectedFeatureStateNames.mockReturnValue(['Open', 'Closed']);
    mocks.getSelectedTaskTypeNames.mockReturnValue(['["p1","epic"]', '["p1","feature"]']);
    mocks.getTaskFilters.mockReturnValue({
      schedule: { planned: true, unplanned: true },
      allocation: { allocated: true, unallocated: true },
      hierarchy: { hasParent: true, noParent: true },
      relations: { hasLinks: true, noLinks: true },
    });
    mocks.getTaskTypeOptions.mockReturnValue([
      { key: '["p1","epic"]', name: 'Epic' },
      { key: '["p1","feature"]', name: 'Feature' },
    ]);
    mocks.getFeatureStates.mockReturnValue([{ name: 'Open' }, { name: 'Closed' }]);
    mocks.setFeatureSortMode.mockImplementation((mode) => mocks.getFeatureSortMode.mockReturnValue(mode));
    mocks.setSelectedStates.mockImplementation((states) =>
      mocks.getSelectedFeatureStateNames.mockReturnValue(states));
    mocks.setSelectedTaskTypes.mockImplementation((types) =>
      mocks.getSelectedTaskTypeNames.mockReturnValue(types));
    mocks.getEffectiveFeatures.mockReturnValue([
      { id: 'root', title: 'Executive roadmap', type: 'Epic', process_id: 'p1', state: 'Open', project: 'p1', parentId: null,
        start: '2027-01-01', end: '2027-04-01', originalRank: 1 },
      { id: 'child', title: 'Implementation', type: 'Feature', process_id: 'p1', state: 'Closed', project: 'p1', parentId: 'root',
        start: '2027-02-01', end: '2027-03-01', originalRank: 2 },
    ]);
  });
  afterEach(() => document.body.replaceChildren());

  it('shows top-level tasks, three labeled scopes and the forecast note', async () => {
    const el = await mount();
    const now = new Date();
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(el.origin).toBe(localToday);
    expect(el.shadowRoot.querySelector('input[type="date"]')).toBeNull();
    expect(el.shadowRoot.querySelector('.forecast-origin').textContent).toContain(localToday);
    expect(el.shadowRoot.querySelectorAll('.task-row')).toHaveLength(1);
    expect(el.shadowRoot.querySelectorAll('.scope-summary')).toHaveLength(0);
    const periodLabels = [...el.shadowRoot.querySelectorAll('.period-label')];
    expect(periodLabels.map((label) => label.textContent.trim().replace(/\s+/g, ' ')))
      .toEqual(['0-6m -10% +30%', '6-18m -25% +75%', '18-48m -40% +150%']);
    expect(periodLabels.map((label) => label.title))
      .toEqual(['0-6 months: -10% / +30%', '6-18 months: -25% / +75%',
        '18-48 months: -40% / +150%']);
    expect(el.constructor.styles.cssText)
      .toMatch(/\.period-label\s*\{[^}]*font-size:\s*14px/);
    expect(el.constructor.styles.cssText)
      .toMatch(/\.period-label\s*\{[^}]*flex-direction:\s*row/);
    expect(el.shadowRoot.textContent).not.toContain('illustrative');
    expect(el.shadowRoot.textContent).toContain('not statistical confidence intervals');
    expect(el.shadowRoot.textContent).toContain('0-6 months');
    expect(el.shadowRoot.querySelector('.finish-range').textContent).toContain('2027');
    el.origin = '2000-01-01';
    await el.open();
    expect(el.origin).toBe(localToday);
    el.close();
    const bar = el.shadowRoot.querySelector('.bar');
    expect(bar.title).toContain('State:');
    expect(bar.title).toContain('Start: 2027-01-01');
    expect(bar.title).toContain('End: 2027-04-01');
    const levels = el.shadowRoot.querySelector('[name="levels"]');
    levels.value = 'all';
    levels.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('.task-row')).toHaveLength(2);
  });

  it('sets the saved sort mode while open and restores the previous global mode on close', async () => {
    mocks.getLocalPref.mockImplementation((key) => Promise.resolve(
      key === 'coneOfUncertainty.sortMode' ? 'rank' : undefined));
    const el = await mount();
    await el.open();
    expect(mocks.setFeatureSortMode).toHaveBeenLastCalledWith('rank');
    const sort = el.shadowRoot.querySelector('[name="sortMode"]');
    sort.value = 'date';
    sort.dispatchEvent(new Event('change'));
    await el.updateComplete;
    await Promise.resolve();
    expect(mocks.setLocalPref).toHaveBeenCalledWith('coneOfUncertainty.sortMode', 'date');
    expect(mocks.setFeatureSortMode).toHaveBeenLastCalledWith('date');
    el.close();
    expect(mocks.setFeatureSortMode).toHaveBeenLastCalledWith('rank');
  });

  it('selects a task and refreshes rendered data after feature changes', async () => {
    const el = await mount();
    const taskLabel = el.shadowRoot.querySelector('.task-label');
    taskLabel.click();
    expect(mocks.setSelectedFeature).toHaveBeenCalledWith(expect.objectContaining({ id: 'root' }));
    mocks.getEffectiveFeatures.mockReturnValue([
      { id: 'root', title: 'Updated roadmap', type: 'Epic', process_id: 'p1', state: 'Open', project: 'p1', parentId: null,
        start: '2027-01-01', end: '2027-04-01', originalRank: 1 },
    ]);
    bus.emit(FeatureEvents.UPDATED);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.task-copy strong').textContent).toBe('Updated roadmap');
  });

  it('sorts by board rank or latest forecast finish, including ongoing work', async () => {
    const dateAt = (offset) => {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    mocks.getEffectiveFeatures.mockReturnValue([
      { id: 'long', title: 'Alpha', type: 'Epic', process_id: 'p1', state: 'Open', project: 'p1', parentId: null,
        start: dateAt(5), end: dateAt(23), originalRank: 30 },
      { id: 'short', title: 'Zulu', type: 'Epic', process_id: 'p1', state: 'Open', project: 'p1', parentId: null,
        start: dateAt(20), end: dateAt(24), originalRank: 10 },
      { id: 'ongoing', title: 'Middle', type: 'Epic', process_id: 'p1', state: 'Open', project: 'p1', parentId: null,
        start: dateAt(-155), end: dateAt(14), originalRank: 20 },
    ]);
    mocks.getFeatureStateCategory.mockImplementation((feature) =>
      feature.id === 'ongoing' ? 'InProgress' : undefined);
    const el = await mount();
    const titles = () => [...el.shadowRoot.querySelectorAll('.task-copy strong')]
      .map((item) => item.textContent);
    expect(titles()).toEqual(['Zulu', 'Middle', 'Alpha']);
    const ongoingRow = el.shadowRoot.querySelector('.task-row[aria-label^="ongoing:"]');
    expect(Number.parseFloat(ongoingRow.querySelector('.bar').style.left))
      .toBeLessThan(Number.parseFloat(ongoingRow.querySelector('.period').style.left));

    mocks.getFeatureSortMode.mockReturnValue('date');
    el.requestUpdate();
    await el.updateComplete;
    expect(titles()).toEqual(['Middle', 'Zulu', 'Alpha']);
  });

  it('uses the native state/type filters, persists changes and restores them on close', async () => {
    mocks.getSelectedFeatureStateNames.mockReturnValue(['Open']);
    const el = await mount();
    el.rootsOnly = false;
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('.task-row')).toHaveLength(1);
    expect(el.shadowRoot.querySelector('.task-filter-settings')).toBeNull();

    await el.open();
    expect(mocks.setSelectedStates).toHaveBeenLastCalledWith(['Open']);
    expect(mocks.setSelectedTaskTypes).toHaveBeenLastCalledWith(['["p1","epic"]', '["p1","feature"]']);
    expect(mocks.setSidebarDisabledElements).toHaveBeenCalledWith({ taskFilters: {
      schedule: ['planned', 'unplanned'],
      allocation: ['allocated', 'unallocated'],
      hierarchy: ['hasParent', 'noParent'],
      relations: ['hasLinks', 'noLinks'],
    } });

    mocks.getSelectedFeatureStateNames.mockReturnValue(['Open', 'Closed']);
    bus.emit(FilterEvents.CHANGED);
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('.task-row')).toHaveLength(2);
    expect(mocks.setLocalPref).toHaveBeenCalledWith('coneOfUncertainty.filters', {
      states: ['Open', 'Closed'], types: ['["p1","epic"]', '["p1","feature"]'],
    });

    el.close();
    expect(mocks.setSelectedStates).toHaveBeenLastCalledWith(['Open']);
    expect(mocks.setSelectedTaskTypes).toHaveBeenLastCalledWith(['["p1","epic"]', '["p1","feature"]']);
    expect(mocks.clearSidebarDisabledElements).toHaveBeenCalledOnce();
    el.remove();
    mocks.getLocalPref.mockImplementation((key) => Promise.resolve(
      key === 'coneOfUncertainty.filters'
        ? { states: ['Closed'], types: ['["p1","feature"]'] } : undefined));
    const restored = await mount();
    restored.rootsOnly = false;
    await restored.open();
    await restored.updateComplete;
    expect(mocks.setSelectedStates).toHaveBeenLastCalledWith(['Closed']);
    expect(mocks.setSelectedTaskTypes).toHaveBeenLastCalledWith(['["p1","feature"]']);
    expect([...restored.shadowRoot.querySelectorAll('.task-copy strong')]
      .map((item) => item.textContent)).toEqual(['Implementation']);
    restored.close();
  });

  it('persists edited scopes in user preferences and restores them on remount', async () => {
    const el = await mount();
    const form = el.shadowRoot.querySelector('form');
    form.elements.namedItem('endMonth-0').value = '9';
    form.elements.namedItem('upper-0').value = '45';
    await el.saveSettings({ preventDefault() {}, currentTarget: form });
    const expected = DEFAULT_SCOPES.map((scope, index) =>
      index === 0 ? { ...scope, endMonth: 9, upper: 45 } : { ...scope });
    expect(mocks.setLocalPref).toHaveBeenCalledWith('coneOfUncertainty.scopes', expected);
    el.remove();
    mocks.getLocalPref.mockImplementation((key) => Promise.resolve(
      key === 'coneOfUncertainty.scopes' ? expected : undefined));
    const restored = await mount();
    expect(restored.scopes).toEqual(expected);
    expect(restored.shadowRoot.textContent).toContain('0-9 months');
  });

  it('renders the board type icons with accessible type labels for every task', async () => {
    const el = await mount();
    el.rootsOnly = false;
    await el.updateComplete;
    const icons = [...el.shadowRoot.querySelectorAll('.task-type')];
    expect(icons.map((icon) => icon.getAttribute('aria-label'))).toEqual(['Epic', 'Feature']);
    expect(icons.map((icon) => icon.getAttribute('title'))).toEqual(['Epic', 'Feature']);
    expect(icons.every((icon) => icon.getAttribute('role') === 'img')).toBe(true);
    expect(icons.map((icon) => icon.querySelector('svg g').getAttribute('fill')))
      .toEqual(['#E6C36A', '#8b5cf6']);
  });

  it('keeps the previous chart and reports validation and persistence failures', async () => {
    const el = await mount();
    const form = el.shadowRoot.querySelector('form');
    form.elements.namedItem('endMonth-0').value = '20';
    await el.saveSettings({ preventDefault() {}, currentTarget: form });
    expect(mocks.setLocalPref).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector('[role="alert"]').textContent).not.toBe('');
    form.elements.namedItem('endMonth-0').value = '9';
    mocks.setLocalPref.mockRejectedValue(new Error('Storage unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await el.saveSettings({ preventDefault() {}, currentTarget: form });
    expect(el.scopes).toEqual(DEFAULT_SCOPES);
    expect(el.shadowRoot.querySelector('[role="alert"]').textContent)
      .toContain('Storage unavailable');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('reports corrupt preferences and allows an explicit replacement with defaults', async () => {
    mocks.getLocalPref.mockResolvedValue([{ endMonth: 0 }]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = await mount();
    expect(el.shadowRoot.querySelector('[role="alert"]').textContent).not.toBe('');
    expect(el.shadowRoot.querySelector('.chart')).toBeNull();
    await el.resetSettings();
    await el.updateComplete;
    expect(mocks.setLocalPref).toHaveBeenCalledWith('coneOfUncertainty.scopes', DEFAULT_SCOPES);
    expect(el.shadowRoot.querySelector('.chart')).not.toBeNull();
    log.mockRestore();
  });

  it('registers a loadable fullscreen tool and restores the board on close', async () => {
    const config = mergePluginConfig(modulesConfig, [
      { id: 'plugin-portfolio-board', enabled: true, activateOnStartup: false },
    ]).modules.find((entry) => entry.id === PluginConeOfUncertainty.defaultId);
    expect(config).toMatchObject({
      type: 'tool', name: 'Cone of Uncertainty', enabled: true,
      exclusive: true, activateOnStartup: false,
    });
    expect(PluginRegistry[config.id]).toBe(PluginConeOfUncertainty);
    expect(resolvePluginComponentLoader('./PluginConeOfUncertaintyComponent.lit.js'))
      .toBeTypeOf('function');
    const host = document.createElement('div');
    host.id = 'app';
    const board = document.createElement('timeline-board');
    board.style.display = 'grid';
    document.body.append(host, board);
    const plugin = new PluginConeOfUncertainty();
    await plugin.init();
    await plugin.activate();
    expect(plugin.isFullscreen).toBe(true);
    expect(board.style.display).toBe('none');
    expect(host.querySelector('plugin-cone-of-uncertainty')).not.toBeNull();
    await plugin.deactivate();
    expect(board.style.display).toBe('grid');
    await plugin.destroy();
    expect(host.children).toHaveLength(0);
  });
});
