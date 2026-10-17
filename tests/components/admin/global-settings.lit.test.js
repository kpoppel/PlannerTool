import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../../../www/admin/js/components/admin/GlobalSettings.lit.js';
import { adminProvider } from '../../../www/admin/js/services/providerREST.js';

const settings = () => ({ schema_version: 2, process_order: ['first', 'second'],
  type_tiers: { first: [['Epic'], ['Feature'], ['Story', 'Bug']], second: [['Feature']] } });
const states = [{ name: 'New', category: 'Proposed', order: 1 },
  { name: 'Done', category: 'Completed', order: 2 },
  { name: 'Removed', category: 'Removed', order: 3 }];
const catalogue = { schema_version: 1, processes: [
  { id: 'first', name: 'First process', types: ['Epic', 'Feature', 'Story', 'Bug'].map((name) =>
    ({ name, imported: true, states })) },
  { id: 'second', name: 'Second process', types: [{ name: 'Feature', imported: true,
    states: [{ name: 'Working', category: 'InProgress', order: 1 }] }] },
] };

describe('admin-global-settings normalized display editor', () => {
  let comp;

  beforeEach(async () => {
    vi.spyOn(adminProvider, 'getGlobalSettings').mockResolvedValue({ ok: true, data: settings() });
    vi.spyOn(adminProvider, 'getAdoProcesses').mockResolvedValue({ ok: true, data: catalogue });
    vi.spyOn(adminProvider, 'saveGlobalSettings').mockResolvedValue({ ok: true, data: settings() });
    comp = document.createElement('admin-global-settings');
    document.body.appendChild(comp);
    await comp.updateComplete;
  });

  afterEach(() => {
    if (comp) comp.remove();
    vi.restoreAllMocks();
  });

  it('loads process cards and sibling tier rows without schema or manual pools', async () => {
    expect(comp.content).toEqual(settings());
    expect([...comp.shadowRoot.querySelectorAll('.process-title')].map((node) => node.textContent.trim()))
      .toEqual(['First process', 'Second process']);
    expect([...comp.shadowRoot.querySelectorAll('.tier')][2].textContent).toContain('Story');
    expect([...comp.shadowRoot.querySelectorAll('.tier')][2].textContent).toContain('Bug');
    expect(comp.shadowRoot.querySelector('input')).toBe(null);
  });

  it('reorders processes without saving until Save is clicked', async () => {
    comp.shadowRoot.querySelector('[title="Move First process down"]').click();
    await comp.updateComplete;
    expect(comp.content.process_order).toEqual(['second', 'first']);
    expect(adminProvider.saveGlobalSettings).not.toHaveBeenCalled();
    comp.shadowRoot.querySelector('button.primary').click();
    await comp.updateComplete;
    expect(adminProvider.saveGlobalSettings).toHaveBeenCalledWith(comp.content);
  });

  it('moves types to adjacent tiers, preserves siblings and removes empty tiers', async () => {
    comp.moveType('first', 2, 'Story', -1);
    expect(comp.content.type_tiers.first).toEqual([['Epic'], ['Feature', 'Story'], ['Bug']]);
    comp.moveType('first', 2, 'Bug', -1);
    expect(comp.content.type_tiers.first).toEqual([['Epic'], ['Feature', 'Story', 'Bug']]);
    comp.moveType('first', 0, 'Epic', 1);
    expect(comp.content.type_tiers.first).toEqual([['Feature', 'Story', 'Bug', 'Epic']]);
    await comp.updateComplete;
  });

  it('creates tiers at either end when a sibling moves beyond the boundary', () => {
    comp.moveType('first', 2, 'Bug', 1);
    expect(comp.content.type_tiers.first).toEqual([['Epic'], ['Feature'], ['Story'], ['Bug']]);
    comp.moveType('first', 1, 'Feature', -1);
    comp.moveType('first', 0, 'Feature', -1);
    expect(comp.content.type_tiers.first).toEqual([['Feature'], ['Epic'], ['Story'], ['Bug']]);
  });

  it('groups identical ordered state sequences and hides Removed', async () => {
    const columns = comp.shadowRoot.querySelectorAll('.state-column');
    expect(columns).toHaveLength(2);
    expect(columns[0].querySelector('h4').textContent).toBe('Epic, Feature, Story, Bug');
    expect([...columns[0].querySelectorAll('.state')].map((node) => node.textContent.trim()))
      .toEqual(['New', 'Done']);
    expect(columns[0].querySelector('[data-category="Completed"]')).not.toBe(null);
    expect(comp.shadowRoot.querySelector('[data-category="Removed"]')).toBe(null);
  });

  it('retains the draft and shows Result errors when saving fails', async () => {
    adminProvider.saveGlobalSettings.mockResolvedValue({
      ok: false,
      error: { message: 'save denied' },
    });
    comp.moveType('first', 2, 'Story', -1);
    const draft = structuredClone(comp.content);
    await comp.saveConfig();
    expect(comp.statusType).toBe('error');
    expect(comp.statusMsg).toContain('save denied');
    expect(comp.content).toEqual(draft);
  });

  it('reports load failures and never saves an incomplete editor', async () => {
    adminProvider.getAdoProcesses.mockResolvedValue({ ok: false, error: { message: 'not available' } });
    await comp.loadConfig();
    await comp.updateComplete;
    expect(comp.statusMsg).toBe('not available');
    expect(comp.shadowRoot.querySelector('button.primary').disabled).toBe(true);
  });
});
