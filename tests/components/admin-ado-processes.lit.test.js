import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import { getAdminSections } from '../../www/js/services/adminNavigation.js';
import '../../www/admin/js/components/admin/AdoProcesses.lit.js';

function catalogue() {
  const type = (name, imported, backlogLevel = 'portfolio', missing = false) => ({
    reference_name: name, name, imported, missing, backlog_level: backlogLevel,
    backlog: name, states: [{ name: 'New', category: 'Proposed', order: 1 },
      { name: 'Closed', category: 'Completed', order: 2 }],
  });
  return { schema_version: 1, processes: [{ id: 'agile', name: 'Planner Agile',
    parent_name: 'Agile', projects: ['Platform'], loaded_at: '2026-10-17T10:00:00Z',
    types: [type('Epic', true), type('Feature', false), type('Task', false, 'task'),
      type('Missing', true, 'portfolio', true), type('Unavailable', false, 'portfolio', true)],
  }] };
}

async function mount(plans = [], content = catalogue()) {
  vi.spyOn(adminProvider, 'getAdoProcesses').mockResolvedValue({ ok: true, data: content });
  vi.spyOn(adminProvider, 'getProjects').mockResolvedValue({ ok: true, data: { project_map: plans } });
  const element = document.createElement('admin-ado-processes');
  document.body.append(element);
  await vi.waitFor(() => expect(element.loading).toBe(false));
  await element.updateComplete;
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('ADO process navigation', () => {
  it.each(['admin', 'manage_projects'])('exposes catalogue and tiers to %s', (permission) => {
    const sections = getAdminSections([permission]).map((section) => section.id);
    expect(sections).toContain('ado-processes');
    expect(sections).toContain('global-project-settings');
  });
  it.each([[], ['manage_iterations'], ['manage_workforce_teams']])('hides catalogue without permission %j', (...permissions) => {
    expect(getAdminSections(permissions.flat()).map((section) => section.id)).not.toContain('ado-processes');
  });
});

describe('ADO process catalogue', () => {
  it('points an empty catalogue to plan setup without offering an all-process refresh', async () => {
    const element = await mount();
    element.content = { schema_version: 1, processes: [] };
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('[data-action="reload"]').disabled).toBe(true);
    const setup = element.shadowRoot.querySelector('a');
    expect(setup.textContent).toBe('Add a plan');
    expect(new URL(setup.href).hash).toBe('#projects');
    expect(element.shadowRoot.querySelector('[data-action="save"]').disabled).toBe(true);
  });

  it('renders process metadata, state categories and explicit import selection', async () => {
    const element = await mount();
    const save = vi.spyOn(adminProvider, 'saveAdoProcesses').mockImplementation(async (content) => ({
      ok: true, data: { content },
    }));
    expect(element.shadowRoot.textContent).toContain('Planner Agile');
    expect(element.shadowRoot.textContent).toContain('Agile');
    expect(element.shadowRoot.textContent).toContain('Platform');
    expect(element.shadowRoot.querySelector('[data-category="Completed"]')).not.toBeNull();
    element.shadowRoot.querySelector('[data-type="Feature"]').click();
    await element.updateComplete;
    expect(save).not.toHaveBeenCalled();
    element.shadowRoot.querySelector('[data-action="save"]').click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].processes[0].types[1].imported).toBe(true);
  });

  it('disables task and newly missing imports, but permits removing missing imports', async () => {
    const element = await mount();
    expect(element.shadowRoot.querySelector('[data-type="Task"]').disabled).toBe(true);
    expect(element.shadowRoot.querySelector('[data-type="Unavailable"]').disabled).toBe(true);
    const missing = element.shadowRoot.querySelector('[data-type="Missing"]');
    expect(missing.disabled).toBe(false);
    missing.click();
    await element.updateComplete;
    expect(element.content.processes[0].types[3].imported).toBe(false);
    expect(element.shadowRoot.textContent).toContain('Missing in Azure DevOps');
  });

  it('names plans that block un-importing a type, including archived plans', async () => {
    const element = await mount([{ name: 'Platform roadmap', area_path: 'platform\\Team',
      task_types: ['epic'], archived: true }]);
    const checkbox = element.shadowRoot.querySelector('[data-type="Epic"]');
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.title).toContain('Platform roadmap');
    expect(element.shadowRoot.textContent).toContain('Platform roadmap');
  });

  it('shows automatically imported plan types checked and locked without unsaved changes', async () => {
    const content = catalogue();
    content.processes[0].types[1].imported = true;
    const element = await mount([{ name: 'Existing roadmap', area_path: '\\PLATFORM/Team',
      task_types: ['feature'], archived: true }], content);
    const checkbox = element.shadowRoot.querySelector('[data-type="Feature"]');
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.title).toContain('Existing roadmap');
    checkbox.click();
    await element.updateComplete;
    expect(element.content.processes[0].types[1].imported).toBe(true);
    expect(element.dirty).toBe(false);
    expect(element.shadowRoot.querySelector('[data-action="save"]').disabled).toBe(true);
  });

  it('shows server save errors inline and retains draft selections', async () => {
    const element = await mount();
    vi.spyOn(adminProvider, 'saveAdoProcesses').mockResolvedValue({ ok: false,
      error: { message: 'Import required by Platform roadmap' } });
    element.shadowRoot.querySelector('[data-type="Feature"]').click();
    await element.saveConfig();
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('[role="status"]').textContent).toContain('Platform roadmap');
    expect(element.content.processes[0].types[1].imported).toBe(true);
  });

  it('reloads catalogue metadata through adminProvider', async () => {
    const element = await mount();
    const fresh = catalogue();
    fresh.processes[0].name = 'Reloaded Agile';
    const refresh = vi.spyOn(adminProvider, 'refreshAdoProcesses').mockResolvedValue({
      ok: true, data: { content: fresh },
    });
    element.shadowRoot.querySelector('[data-action="reload"]').click();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(element.shadowRoot.textContent).toContain('Reloaded Agile'));
  });

  it('shows load failures and allows retry', async () => {
    vi.spyOn(adminProvider, 'getAdoProcesses').mockResolvedValue({ ok: false,
      error: { message: 'Catalogue unavailable' } });
    vi.spyOn(adminProvider, 'getProjects').mockResolvedValue({ ok: true, data: { project_map: [] } });
    const element = document.createElement('admin-ado-processes');
    document.body.append(element);
    await vi.waitFor(() => expect(element.loading).toBe(false));
    await element.updateComplete;
    expect(element.shadowRoot.textContent).toContain('Catalogue unavailable');
    expect(element.shadowRoot.querySelector('[data-action="reload"]').disabled).toBe(false);
  });
});