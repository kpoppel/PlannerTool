import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/IterationSets.lit.js';

const adoSet = () => ({ id: 'ado-set', name: 'Release', source_type: 'ado', source_project: 'ADO',
  root_path: null, selected_paths: ['ADO\\Release\\One'], generator: null,
  values: [{ path: 'ADO\\Release\\One', name: 'One', startDate: '2026-10-19', finishDate: '2026-11-01' }], cached_at: null });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let component;

beforeEach(async () => {
  vi.spyOn(adminProvider, 'getIterations').mockResolvedValue({ ok: true, data: { iteration_sets: [], usage: {} } });
  vi.spyOn(adminProvider, 'saveIterations').mockResolvedValue({ ok: true });
  vi.spyOn(adminProvider, 'deleteIterationSet').mockResolvedValue({ ok: true });
  vi.spyOn(adminProvider, 'getBrowseConfig').mockResolvedValue({ ok: true, data: { organization_url: 'org' } });
  vi.spyOn(adminProvider, 'browseAzureProjects').mockResolvedValue({ ok: true, data: { projects: ['ADO'] } });
  vi.spyOn(adminProvider, 'browseIterations').mockResolvedValue({ ok: true, data: { iterations: [
    { path: 'ADO\\Release', name: 'Release', startDate: null, finishDate: null },
    ...adoSet().values,
    { path: 'ADO\\Release\\Two', name: 'Two', startDate: '2026-11-02', finishDate: '2026-11-15' },
  ] } });
  component = document.createElement('admin-iterations');
  document.body.append(component);
  await flush();
  await component.updateComplete;
});
afterEach(() => { component.remove(); vi.restoreAllMocks(); });

describe('admin iteration sets', () => {
  it('loads without requesting ADO metadata', () => {
    expect(adminProvider.browseAzureProjects).not.toHaveBeenCalled();
    expect(adminProvider.browseIterations).not.toHaveBeenCalled();
    expect(component.shadowRoot.textContent).toContain('No iteration sets');
  });
  it('creates and saves a generated snapshot without an ADO source', async () => {
    component.createDraft('Delivery', 'generated', '');
    component.generatePreview();
    await component.saveSet();
    const saved = adminProvider.saveIterations.mock.calls[0][0].iteration_sets[0];
    expect(saved.source_type).toBe('generated');
    expect(saved.source_project).toBeNull();
    expect(saved.values).toHaveLength(3);
    expect(component.hasUnsavedChanges).toBe(false);
  });
  it('blocks saving stale generator settings until regenerated', async () => {
    component.createDraft('Delivery', 'generated', '');
    component.generatePreview();
    component.updateGenerator('count', 4);
    expect(component.generatorPending).toBe(true);
    await component.saveSet();
    expect(adminProvider.saveIterations).not.toHaveBeenCalled();
    component.generatePreview();
    expect(component.draft.values).toHaveLength(4);
  });
  it('retains a previous preview when generation fails', () => {
    component.createDraft('Delivery', 'generated', '');
    component.generatePreview();
    const previous = structuredClone(component.draft.values);
    component.updateGenerator('length', 0);
    component.generatePreview();
    expect(component.draft.values).toEqual(previous);
    expect(component.error).toContain('length');
  });
  it('preserves a draft after a failed save', async () => {
    component.createDraft('Delivery', 'generated', '');
    component.generatePreview();
    adminProvider.saveIterations.mockResolvedValue({ ok: false, error: { message: 'Save denied' } });
    await component.saveSet();
    expect(component.error).toBe('Save denied');
    expect(component.hasUnsavedChanges).toBe(true);
  });
  it('selects an ADO subtree but includes only dated members', async () => {
    component.createDraft('Release', 'ado', 'ADO');
    await component.loadSource();
    component.toggleSourcePath('ADO\\Release', true);
    expect(component.draft.selected_paths).toHaveLength(3);
    expect(component.draft.values).toHaveLength(2);
    component.filterText = 'Two';
    expect(component.filteredSourceRows).toHaveLength(1);
    expect(component.draft.values).toHaveLength(2);
  });
  it('does not silently add new descendants when reloading a saved selection', async () => {
    component.sets = [adoSet()];
    component.activateSet(component.sets[0]);
    await component.loadSource();
    expect(component.draft.values.map((value) => value.name)).toEqual(['One']);
  });

  it('collapses ADO branches independently of subtree selection', async () => {
    component.createDraft('Release', 'ado', 'ADO');
    await component.loadSource();
    await component.updateComplete;
    expect(component.shadowRoot.querySelectorAll('.iteration-tree input[type=checkbox]')).toHaveLength(1);
    const expand = component.shadowRoot.querySelector('button[aria-label="Expand ADO\\\\Release"]');
    expect(expand).not.toBeNull();
    const before = JSON.stringify(component.draft);
    expand.click();
    await component.updateComplete;
    expect(JSON.stringify(component.draft)).toBe(before);
    expect(component.shadowRoot.querySelectorAll('.iteration-tree input[type=checkbox]')).toHaveLength(3);
    component.toggleSourcePath('ADO\\Release', true);
    await component.updateComplete;
    component.shadowRoot.querySelector('button[aria-label="Collapse ADO\\\\Release"]').click();
    await component.updateComplete;
    expect(component.shadowRoot.querySelectorAll('.iteration-tree input[type=checkbox]')).toHaveLength(1);
    expect(component.draft.values).toHaveLength(2);
    expect(component.draft.selected_paths).toHaveLength(3);
  });

  it('reveals filtered descendants with ancestors and restores collapsed branches after clearing', async () => {
    component.createDraft('Release', 'ado', 'ADO');
    await component.loadSource();
    component.setSourceFilter('Two');
    await component.updateComplete;
    expect(component.shadowRoot.querySelectorAll('.iteration-tree input[type=checkbox]')).toHaveLength(2);
    expect(component.shadowRoot.querySelector('button[aria-expanded="true"]')).not.toBeNull();
    component.setSourceFilter('');
    await component.updateComplete;
    expect(component.shadowRoot.querySelectorAll('.iteration-tree input[type=checkbox]')).toHaveLength(1);
  });

  it('keeps a partially selected collapsed branch indeterminate', async () => {
    component.createDraft('Release', 'ado', 'ADO');
    await component.loadSource();
    component.toggleSourcePath('ADO\\Release\\One', true);
    await component.updateComplete;
    expect(component.shadowRoot.querySelector('.iteration-tree input[type=checkbox]').indeterminate).toBe(true);
    expect(component.draft.values).toHaveLength(1);
  });

  it('expands and collapses all branches without changing the draft', async () => {
    component.createDraft('Release', 'ado', 'ADO');
    await component.loadSource();
    const before = JSON.stringify(component.draft);
    component.expandAllBranches();
    await component.updateComplete;
    expect(component.shadowRoot.querySelectorAll('.iteration-tree input[type=checkbox]')).toHaveLength(3);
    component.collapseAllBranches();
    await component.updateComplete;
    expect(component.shadowRoot.querySelectorAll('.iteration-tree input[type=checkbox]')).toHaveLength(1);
    expect(JSON.stringify(component.draft)).toBe(before);
  });
  it('shows usage and blocks deletion without unassociating plans', async () => {
    component.sets = [adoSet()];
    component.usage = { 'ado-set': [{ id: 'plan', name: 'Delivery plan' }] };
    component.activateSet(component.sets[0]);
    await component.deleteSet();
    expect(adminProvider.deleteIterationSet).not.toHaveBeenCalled();
    expect(component.assignedPlans).toHaveLength(1);
  });
  it('guards switching away from an unsaved draft', () => {
    component.createDraft('Draft', 'manual', '');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    component.selectSet(adoSet());
    expect(component.draft.name).toBe('Draft');
  });

  it('preserves structured validation errors from the HTTP response body', async () => {
    adminProvider.saveIterations.mockRestore();
    vi.spyOn(adminProvider, '_saveContent').mockResolvedValue({ ok: false, error: {
      message: 'HTTP 400', status: 400,
      detail: { error: 'invalid_payload', message: 'Iteration save denied' },
    } });
    const result = await adminProvider.saveIterations({ iteration_sets: [] });
    expect(result.error.message).toBe('Iteration save denied');
  });
});