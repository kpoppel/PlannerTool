import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLocalPref: vi.fn(),
  setLocalPref: vi.fn(),
  getEffectiveFeatures: vi.fn(),
  getSelectedProjectIds: vi.fn(),
}));
vi.mock('../../www/js/services/dataService.js', () => ({
  dataService: { getLocalPref: mocks.getLocalPref, setLocalPref: mocks.setLocalPref },
}));
vi.mock('../../www/js/application/imports.js', () => ({
  sel: {
    feature: { getEffectiveFeatures: mocks.getEffectiveFeatures },
    selection: { getSelectedProjectIds: mocks.getSelectedProjectIds },
  },
}));

import { DEFAULT_SCOPES } from '../../www/js/plugins/coneOfUncertainty.js';
import '../../www/js/plugins/PluginConeOfUncertaintyComponent.lit.js';
import PluginConeOfUncertainty from '../../www/js/plugins/PluginConeOfUncertainty.js';
import { resolvePluginComponentLoader } from '../../www/js/plugins/MountedPlugin.js';
import PluginRegistry from '../../www/js/core/pluginRegistry.js';
import modulesConfig from '../../www/js/modules.config.json';
import { mergePluginConfig } from '../../www/js/core/pluginConfigMerge.js';

async function mount() {
  const el = document.createElement('plugin-cone-of-uncertainty');
  el.origin = '2027-01-01';
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
    mocks.getEffectiveFeatures.mockReturnValue([
      { id: 'root', title: 'Executive roadmap', type: 'Epic', project: 'p1', parentId: null,
        start: '2027-01-01', end: '2027-04-01' },
      { id: 'child', title: 'Implementation', type: 'Feature', project: 'p1', parentId: 'root',
        start: '2027-02-01', end: '2027-03-01' },
    ]);
  });
  afterEach(() => document.body.replaceChildren());

  it('shows top-level tasks, three labeled scopes and the forecast disclaimer', async () => {
    const el = await mount();
    expect(el.shadowRoot.querySelectorAll('.task-row')).toHaveLength(1);
    expect(el.shadowRoot.querySelectorAll('.scope-summary')).toHaveLength(3);
    expect(el.shadowRoot.textContent).toContain('not statistical confidence intervals');
    expect(el.shadowRoot.textContent).toContain('0-6 months');
    expect(el.shadowRoot.textContent).toContain('-40% / +150%');
    expect(el.shadowRoot.querySelector('.finish-range').textContent).toContain('2027');
    const levels = el.shadowRoot.querySelector('[name="levels"]');
    levels.value = 'all';
    levels.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('.task-row')).toHaveLength(2);
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
    mocks.getLocalPref.mockResolvedValue(expected);
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
