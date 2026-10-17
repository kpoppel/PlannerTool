import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../www/admin/js/components/admin/plans/WorkforceTree.lit.js';
import '../../../www/admin/js/components/admin/plans/PlanLevels.lit.js';
import '../../../www/admin/js/components/admin/plans/DefaultWorkforce.lit.js';
import '../../../www/admin/js/components/admin/plans/PlansList.lit.js';
import '../../../www/admin/js/components/admin/plans/AreaPathPicker.lit.js';
import '../../../www/admin/js/components/admin/plans/PlanDrawer.lit.js';
import '../../../www/admin/js/components/admin/plans/AdminPlans.lit.js';
import { adminProvider } from '../../../www/admin/js/services/providerREST.js';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('plans shell', () => {
  async function mount(permissions = ['manage_projects']) {
    vi.spyOn(adminProvider, 'getProjects').mockResolvedValue({ ok: true, data: {
      schema_version: 4, container_types: ['Team'], allocation_defaults: { Team: [] }, project_map: [],
    } });
    vi.spyOn(adminProvider, 'getWorkforce').mockResolvedValue({ ok: true, data: { content: {
      teams: { schema_version: 3, groups: [], teams: [] },
    } } });
    vi.spyOn(adminProvider, 'getIterations').mockResolvedValue({ ok: true, data: { iteration_sets: [] } });
    vi.spyOn(adminProvider, 'getAdoProcesses').mockResolvedValue({ ok: true, data: { schema_version: 1, processes: [] } });
    vi.spyOn(adminProvider, 'getBrowseConfig').mockResolvedValue({ ok: true, data: { organization_url: 'org' } });
    vi.spyOn(adminProvider, 'browseAzureProjects').mockResolvedValue({ ok: true, data: { projects: [] } });
    const shell = document.createElement('admin-projects');
    shell.permissions = permissions;
    document.body.append(shell);
    await vi.waitFor(() => expect(shell.loading).toBe(false));
    return shell;
  }
  const plan = { id: 'new', name: 'New', type: 'Team', area_path: 'Platform\\New',
    task_types: ['Feature'], closed_history_days: 0 };

  it('restricts raw JSON to administrators, including direct mode changes', async () => {
    const shell = await mount();
    expect(shell.shadowRoot.textContent).not.toContain('Raw JSON');
    shell.useRawMode = true;
    await shell.updateComplete;
    expect(shell.shadowRoot.querySelector('textarea')).toBeNull();
    shell.permissions = ['admin'];
    await shell.updateComplete;
    expect(shell.shadowRoot.querySelector('textarea')).not.toBeNull();
  });

  it('retains a failed draft and imports, then keeps a saved plan when loading fails and retries', async () => {
    const shell = await mount();
    const save = vi.spyOn(adminProvider, 'saveProjects')
      .mockResolvedValueOnce({ ok: false, error: { message: 'Invalid selection' } })
      .mockResolvedValueOnce({ ok: true, data: { ok: true } });
    const refresh = vi.spyOn(adminProvider, 'refreshPlan')
      .mockResolvedValueOnce({ ok: false, error: { message: 'Cannot read area' } })
      .mockResolvedValueOnce({ ok: true, data: { item_count: 7 } });
    shell.openDrawer(null);
    const detail = { plan, processImports: { agile: ['feature'] }, refresh: true };
    await shell.submitPlan({ detail });
    expect(shell.content.project_map).toEqual([]);
    expect(shell.drawerError).toBe('Invalid selection');
    expect(shell.drawerOpen).toBe(true);
    await shell.submitPlan({ detail });
    expect(save.mock.calls[1][1]).toEqual({ agile: ['feature'] });
    expect(shell.content.project_map).toEqual([plan]);
    expect(shell.statuses.new.message).toContain('Data not loaded');
    expect(shell.drawerSaved).toBe(true);
    await shell.refreshPlan('new');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(shell.statuses.new).toEqual({ error: false, message: 'Loaded 7 work items' });
  });

  it('serializes immediate config saves and restores a plan before refreshing it', async () => {
    const shell = await mount();
    const order = [];
    vi.spyOn(adminProvider, 'saveProjects').mockImplementation(async () => {
      order.push('save'); return { ok: true, data: {} };
    });
    vi.spyOn(adminProvider, 'refreshPlan').mockImplementation(async () => {
      order.push('refresh'); return { ok: true, data: { item_count: 1 } };
    });
    shell.content = { ...shell.content, project_map: [{ ...plan, archived: true }] };
    await shell.planAction({ detail: { id: 'new', action: 'restore' } });
    expect(order).toEqual(['save', 'refresh']);
    expect(shell.content.project_map[0].archived).toBe(false);
    await Promise.all([shell.saveContent({ ...shell.content }), shell.saveContent({ ...shell.content })]);
    expect(order).toEqual(['save', 'refresh', 'save', 'save']);
  });
});

describe('plan drawer', () => {
  const process = { id: 'agile', name: 'Agile', projects: ['Platform'], types: [
    { name: 'Feature', reference_name: 'feature', backlog_level: 'portfolio', imported: false, missing: false },
    { name: 'Epic', reference_name: 'epic', backlog_level: 'portfolio', imported: true, missing: false },
    { name: 'Task', reference_name: 'task', backlog_level: 'task', imported: false, missing: false },
    { name: 'Gone', reference_name: 'gone', backlog_level: 'portfolio', imported: true, missing: true },
  ] };
  async function mount(plan = null) {
    vi.spyOn(adminProvider, 'getBrowseConfig').mockResolvedValue({ ok: true, data: { organization_url: 'org' } });
    vi.spyOn(adminProvider, 'browseAzureProjects').mockResolvedValue({ ok: true, data: { projects: [] } });
    vi.spyOn(adminProvider, 'browseAreaPaths').mockResolvedValue({ ok: true, data: { area_paths: [] } });
    vi.spyOn(adminProvider, 'resolveAdoProcess').mockResolvedValue({ ok: true, data: { content: process } });
    const drawer = document.createElement('plan-drawer');
    drawer.content = { container_types: ['Team', 'Program'], allocation_defaults: { Team: [], Program: [] },
      project_map: [{ id: 'existing', name: 'Existing', type: 'Team', area_path: 'Platform\\Existing', task_types: ['feature'] }] };
    drawer.plan = plan;
    document.body.append(drawer);
    await drawer.updateComplete;
    return drawer;
  }

  it('gates wizard steps, prefills names, chooses conventions and submits explicit imports', async () => {
    const drawer = await mount();
    expect(drawer.draft.closed_history_days).toBe(0);
    expect(drawer.validStep).toBe(false);
    drawer._onArea({ detail: { areaPath: 'Platform\\New', process, pending: true, error: '' } });
    expect(drawer.validStep).toBe(false);
    drawer._onArea({ detail: { areaPath: 'Platform\\New', process, pending: false, error: '' } });
    expect(drawer.draft.name).toBe('New');
    expect(drawer.draft.task_types).toEqual(['Feature']);
    drawer.next();
    await drawer.updateComplete;
    expect(drawer.step).toBe(1);
    expect(drawer.shadowRoot.querySelector('input[value="Task"]').disabled).toBe(true);
    expect(drawer.shadowRoot.querySelector('input[value="Gone"]')).toBeNull();
    expect(drawer.shadowRoot.textContent).toContain('used by other Team plans');
    drawer.setName('Manual');
    drawer._onArea({ detail: { areaPath: 'Platform\\Renamed', process, pending: false, error: '' } });
    expect(drawer.draft.name).toBe('Manual');
    drawer.toggleType('Feature', false);
    expect(drawer.validStep).toBe(false);
    drawer.toggleType('Feature', true);
    drawer.next();
    await drawer.updateComplete;
    expect(drawer.shadowRoot.textContent).toContain('Inherit level default');
    drawer.setWorkforce(false);
    expect(drawer.draft.allocatable_ids).toEqual([]);
    drawer.setWorkforce(true);
    expect(Object.hasOwn(drawer.draft, 'allocatable_ids')).toBe(false);
    drawer.draft = { ...drawer.draft, closed_history_days: 90 };
    drawer.next();
    const submit = vi.fn();
    drawer.addEventListener('plan-submit', submit);
    drawer.submit();
    expect(submit.mock.calls[0][0].detail.processImports).toEqual({ agile: ['feature'] });
    expect(submit.mock.calls[0][0].detail.plan.closed_history_days).toBe(90);
    expect(submit.mock.calls[0][0].detail.refresh).toBe(true);
  });

  it('resolves edited plans, warns about changing paths and retains source data on cancel', async () => {
    const original = { id: 'edit', name: 'Original', type: 'Team', area_path: 'Platform\\Edit',
      task_types: ['Feature'], closed_history_days: 30 };
    const drawer = await mount(original);
    await vi.waitFor(() => expect(drawer.process).not.toBeNull());
    expect(adminProvider.resolveAdoProcess).toHaveBeenCalledWith('Platform');
    expect(drawer.shadowRoot.textContent).toContain('Change area path');
    drawer.changeArea = true;
    await drawer.updateComplete;
    expect(drawer.shadowRoot.textContent).toContain('Changing the area path');
    drawer.setName('Draft');
    expect(original.name).toBe('Original');
    const submit = vi.fn();
    drawer.addEventListener('plan-submit', submit);
    drawer.submit();
    expect(submit.mock.calls[0][0].detail.refresh).toBe(false);
    drawer.draft = { ...drawer.draft, closed_history_days: 365 };
    drawer.submit();
    expect(submit.mock.calls[1][0].detail.refresh).toBe(true);
    drawer.error = 'Validation failed';
    await drawer.updateComplete;
    expect(drawer.draft.name).toBe('Draft');
    expect(drawer.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Validation failed');
  });

  it('makes nested picker controls inert while saving and after the plan is saved', async () => {
    const drawer = await mount();
    drawer.busy = true;
    await drawer.updateComplete;
    expect(drawer.shadowRoot.querySelector('.body > fieldset').hasAttribute('inert')).toBe(true);
    drawer.busy = false;
    drawer.saved = true;
    await drawer.updateComplete;
    expect(drawer.shadowRoot.querySelector('.body > fieldset').hasAttribute('inert')).toBe(true);
  });

  it('lets an existing plan remove obsolete selections without offering them as eligible types', async () => {
    const drawer = await mount({ id: 'edit', name: 'Repair', type: 'Team', area_path: 'Platform\\Repair',
      task_types: ['Gone', 'Unknown', 'Task'], closed_history_days: 0 });
    await vi.waitFor(() => expect(drawer.process).not.toBeNull());
    await drawer.updateComplete;
    expect(drawer.detailsValid).toBe(false);
    for (const name of ['Gone', 'Unknown', 'Task']) {
      drawer.shadowRoot.querySelector(`[aria-label="Remove unavailable type ${name}"]`).click();
      await drawer.updateComplete;
    }
    drawer.toggleType('Feature', true);
    expect(drawer.detailsValid).toBe(true);
    expect(drawer.shadowRoot.querySelector('input[value="Gone"]')).toBeNull();
  });
});

describe('area path picker', () => {
  const process = { id: 'agile', name: 'Agile', types: [] };
  async function mount(areaPath = '') {
    vi.spyOn(adminProvider, 'getBrowseConfig').mockResolvedValue({ ok: true, data: { organization_url: 'org' } });
    vi.spyOn(adminProvider, 'browseAzureProjects').mockResolvedValue({ ok: true,
      data: { projects: ['Platform', 'Other'] } });
    vi.spyOn(adminProvider, 'browseAreaPaths').mockImplementation(async (project) => ({ ok: true,
      data: { area_paths: [project, `${project}\\Used`, `${project}\\Free`] } }));
    vi.spyOn(adminProvider, 'resolveAdoProcess').mockResolvedValue({ ok: true, data: { content: process } });
    const picker = document.createElement('plan-area-path-picker');
    picker.areaPath = areaPath;
    picker.plans = [{ id: 'used', name: 'Existing', area_path: 'Platform\\Used', archived: true }];
    document.body.append(picker);
    await vi.waitFor(() => expect(picker.projects).toHaveLength(2));
    return picker;
  }

  it('disables used paths and resolves the existing project on open', async () => {
    const picker = await mount('Platform\\Free');
    await vi.waitFor(() => expect(picker.pending).toBe(false));
    const projectOptions = [...picker.shadowRoot.querySelectorAll('#project option')]
      .map((option) => option.textContent.trim());
    expect(projectOptions).toEqual(['Select a project', 'Platform', 'Other']);
    expect(adminProvider.resolveAdoProcess).toHaveBeenCalledWith('Platform');
    await picker.updateComplete;
    const used = [...picker.shadowRoot.querySelectorAll('[data-path]')]
      .find((button) => button.dataset.path === 'Platform\\Used');
    expect(used.disabled).toBe(true);
    expect(used.textContent).toContain('used by Existing');
    expect(picker.process.id).toBe('agile');
  });

  it('ignores stale resolutions and exposes errors with a working retry', async () => {
    const picker = await mount();
    let finish;
    adminProvider.resolveAdoProcess.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ ok: false, error: { message: 'Access denied' } })
      .mockResolvedValueOnce({ ok: true, data: { content: { ...process, id: 'other' } } });
    const stale = picker.selectProject('Platform');
    expect(picker.pending).toBe(true);
    await picker.selectProject('Other');
    finish({ ok: true, data: { content: process } });
    await stale;
    expect(picker.error).toBe('Access denied');
    expect(picker.process).toBeNull();
    await picker.updateComplete;
    picker.shadowRoot.querySelector('[data-retry]').click();
    await vi.waitFor(() => expect(picker.process.id).toBe('other'));
    expect(picker.project).toBe('Other');
    expect(picker.paths).toEqual(['Other', 'Other\\Used', 'Other\\Free']);
  });
});

describe('plans list', () => {
  async function mount() {
    const list = document.createElement('plans-list');
    list.content = { container_types: ['Program', 'Team'], project_map: [
      { id: 'one', name: 'Alpha', type: 'Team', area_path: 'Platform\\Alpha', task_types: ['Feature'], closed_history_days: 0 },
      { id: 'middle', name: 'Portfolio', type: 'Program', area_path: 'Platform', task_types: ['Epic'], closed_history_days: 90 },
      { id: 'two', name: 'Beta', type: 'Team', area_path: 'Platform\\Beta', task_types: ['Feature'], closed_history_days: 0 },
      { id: 'old', name: 'Old', type: 'Team', area_path: 'Platform\\Old', task_types: ['Feature'], closed_history_days: 0, archived: true },
    ] };
    document.body.append(list);
    await list.updateComplete;
    return list;
  }

  it('groups by level, searches and resets an empty archived filter', async () => {
    const list = await mount();
    expect([...list.shadowRoot.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual(['Program', 'Team']);
    expect(list.shadowRoot.querySelector('option[value="archived"]').textContent).toContain('(1)');
    list.search = 'alpha';
    await list.updateComplete;
    expect(list.shadowRoot.querySelectorAll('.plan-row')).toHaveLength(1);
    list.search = '';
    list.level = 'archived';
    await list.updateComplete;
    expect(list.shadowRoot.querySelector('.plan-row').textContent).toContain('Old');
    list.content = { ...list.content, project_map: list.content.project_map.filter((plan) => !plan.archived) };
    await list.updateComplete;
    expect(list.level).toBe('');
    expect(list.shadowRoot.querySelector('option[value="archived"]')).toBeNull();
  });

  it('reorders within a level without moving other levels or archived entries', async () => {
    const list = await mount();
    const changed = vi.fn();
    list.addEventListener('config-change', changed);
    expect(list.shadowRoot.querySelector('[data-plan="one"] [title="Move up"]').disabled).toBe(true);
    expect(list.shadowRoot.querySelector('[data-plan="two"] [title="Move down"]').disabled).toBe(true);
    list.movePlan('two', 'one');
    expect(changed.mock.calls[0][0].detail.project_map.map((plan) => plan.id))
      .toEqual(['two', 'middle', 'one', 'old']);
    list.movePlan('one', 'middle');
    list.movePlan('old', 'one');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('closes the action menu before a reordered row can reuse its open state', async () => {
    const list = await mount();
    const row = list.shadowRoot.querySelector('[data-plan="two"]');
    const menu = row.querySelector('details');
    menu.open = true;
    row.querySelector('[title="Move up"]').click();
    expect(menu.open).toBe(false);
  });

  it('rejects cross-level drops and persists valid same-level drops through config-change', async () => {
    const list = await mount();
    expect(list.shadowRoot.querySelector('[data-plan="one"] .handle').draggable).toBe(true);
    const changed = vi.fn();
    list.addEventListener('config-change', changed);
    list._dragId = 'one';
    list.shadowRoot.querySelector('[data-plan="middle"]').dispatchEvent(new Event('drop', { cancelable: true }));
    expect(changed).not.toHaveBeenCalled();
    list._dragId = 'two';
    list.shadowRoot.querySelector('[data-plan="one"]').dispatchEvent(new MouseEvent('dragover', { clientY: -1, cancelable: true }));
    list.shadowRoot.querySelector('[data-plan="one"]').dispatchEvent(new Event('drop', { cancelable: true }));
    expect(changed.mock.calls[0][0].detail.project_map.map((plan) => plan.id)).toEqual(['two', 'middle', 'one', 'old']);
  });

  it('highlights the dragged plan and shows the exact insertion edge without shifting rows', async () => {
    const list = await mount();
    const source = list.shadowRoot.querySelector('[data-plan="one"]');
    const target = list.shadowRoot.querySelector('[data-plan="two"]');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 60 });
    const transfer = { setData: vi.fn(), effectAllowed: '' };
    const start = new Event('dragstart', { bubbles: true });
    Object.defineProperty(start, 'dataTransfer', { value: transfer });
    source.querySelector('.handle').dispatchEvent(start);
    await list.updateComplete;
    expect(source.classList.contains('dragging')).toBe(true);
    expect(transfer.effectAllowed).toBe('move');
    expect(source.querySelector('.handle').getAttribute('aria-label')).toBe('Drag Alpha to reorder');
    target.dispatchEvent(new MouseEvent('dragover', { clientY: 110, cancelable: true }));
    await list.updateComplete;
    expect(target.dataset.dropPosition).toBe('before');
    target.dispatchEvent(new MouseEvent('dragover', { clientY: 150, cancelable: true }));
    await list.updateComplete;
    expect(target.dataset.dropPosition).toBe('after');
    expect(list.shadowRoot.querySelectorAll('.plan-row')).toHaveLength(3);
    const changed = vi.fn();
    list.addEventListener('config-change', changed);
    target.dispatchEvent(new Event('drop', { cancelable: true }));
    await list.updateComplete;
    expect(changed.mock.calls[0][0].detail.project_map.map((plan) => plan.id))
      .toEqual(['two', 'middle', 'one', 'old']);
    expect(list.shadowRoot.querySelector('.dragging')).toBeNull();
    expect(list.shadowRoot.querySelector('[data-drop-position="after"]')).toBeNull();
  });

  it('clears insertion feedback on invalid targets, leaving the list and cancelling a drag', async () => {
    const list = await mount();
    list._dragId = 'two';
    const target = list.shadowRoot.querySelector('[data-plan="one"]');
    target.dispatchEvent(new MouseEvent('dragover', { clientY: -1, cancelable: true }));
    await list.updateComplete;
    expect(target.dataset.dropPosition).toBe('before');
    const invalid = new MouseEvent('dragover', { cancelable: true });
    list.shadowRoot.querySelector('[data-plan="middle"]').dispatchEvent(invalid);
    await list.updateComplete;
    expect(invalid.defaultPrevented).toBe(false);
    expect(target.dataset.dropPosition).toBe('');
    target.dispatchEvent(new MouseEvent('dragover', { clientY: -1, cancelable: true }));
    target.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: null }));
    await list.updateComplete;
    expect(target.dataset.dropPosition).toBe('');
    target.dispatchEvent(new MouseEvent('dragover', { clientY: -1, cancelable: true }));
    list.shadowRoot.querySelector('[data-plan="two"] .handle').dispatchEvent(new Event('dragend'));
    await list.updateComplete;
    expect(list._dragId).toBe('');
    expect(target.dataset.dropPosition).toBe('');
  });
});

describe('plan level configuration', () => {
  it('protects used levels, rejects case-insensitive duplicates and reorders levels', async () => {
    const levels = document.createElement('plan-levels');
    levels.content = { container_types: ['Program', 'Team'],
      project_map: [{ name: 'Existing', type: 'Program', archived: true }],
      allocation_defaults: { Program: [], Team: [] } };
    const changed = vi.fn();
    levels.addEventListener('config-change', changed);
    document.body.append(levels);
    await levels.updateComplete;
    const remove = levels.shadowRoot.querySelector('[title="Used by Existing"]');
    expect(remove.disabled).toBe(true);
    levels.addLevel('program');
    expect(changed).not.toHaveBeenCalled();
    levels.addLevel('Portfolio');
    expect(changed.mock.calls[0][0].detail.allocation_defaults.Portfolio).toEqual([]);
    levels.moveLevel(1, -1);
    expect(changed.mock.calls[1][0].detail.container_types).toEqual(['Team', 'Program']);
  });

  it('edits a level default and counts explicit overrides including empty ones', async () => {
    const defaults = document.createElement('plan-default-workforce');
    defaults.content = { container_types: ['Team'], allocation_defaults: { Team: ['group'] },
      project_map: [{ type: 'Team' }, { type: 'Team', allocatable_ids: [] }] };
    defaults.catalogue = { groups: [{ id: 'group', name: 'Delivery', archived: false }], teams: [] };
    const changed = vi.fn();
    defaults.addEventListener('config-change', changed);
    document.body.append(defaults);
    await defaults.updateComplete;
    expect(defaults.shadowRoot.textContent).toContain('1 plan overrides');
    expect(defaults.shadowRoot.querySelector('.summary').textContent).toContain('Delivery');
    const tree = defaults.shadowRoot.querySelector('plan-workforce-tree');
    await tree.updateComplete;
    tree.shadowRoot.querySelector('input[value="group"]').click();
    expect(changed.mock.calls[0][0].detail.allocation_defaults.Team).toEqual([]);
  });
});

describe('plan workforce tree', () => {
  async function mount(selected = []) {
    const tree = document.createElement('plan-workforce-tree');
    tree.catalogue = { groups: [
      { id: 'group', name: 'Delivery', archived: false },
      { id: 'old-group', name: 'Old group', archived: true },
    ], teams: [
      { id: 'team', name: 'Engine', group_id: 'group', archived: false },
      { id: 'solo', name: 'Independent', group_id: null, archived: false },
      { id: 'old', name: 'Retired', group_id: 'group', archived: true },
    ] };
    tree.selected = selected;
    document.body.append(tree);
    await tree.updateComplete;
    return tree;
  }

  it('nests teams, separates ungrouped teams and selects a group without its teams', async () => {
    const tree = await mount();
    expect(tree.shadowRoot.querySelector('[data-group="group"]').textContent).toContain('Engine');
    expect(tree.shadowRoot.textContent).toContain('Teams without a group');
    const changed = vi.fn();
    tree.addEventListener('selection-change', changed);
    tree.shadowRoot.querySelector('input[value="group"]').click();
    expect(changed.mock.calls[0][0].detail).toEqual(['group']);
    expect(tree.shadowRoot.querySelector('input[value="team"]').checked).toBe(false);
  });

  it('hides archived records unless selected and allows deselection', async () => {
    const tree = await mount(['old']);
    expect(tree.shadowRoot.textContent).not.toContain('Old group');
    const old = tree.shadowRoot.querySelector('input[value="old"]');
    expect(old.disabled).toBe(false);
    expect(old.closest('label').textContent).toContain('archived');
    old.click();
    await tree.updateComplete;
    expect(tree.shadowRoot.querySelector('input[value="old"]')).toBeNull();
  });

  it('keeps teams selectable without exposing their unselected archived group', async () => {
    const tree = await mount();
    tree.catalogue = { ...tree.catalogue, teams: [...tree.catalogue.teams,
      { id: 'orphan', name: 'Still active', group_id: 'old-group', archived: false }] };
    await tree.updateComplete;
    expect(tree.shadowRoot.textContent).not.toContain('Old group');
    expect(tree.shadowRoot.querySelector('input[value="orphan"]')).not.toBeNull();
    tree.selected = ['old-group'];
    await tree.updateComplete;
    expect(tree.shadowRoot.querySelector('input[value="old-group"]').checked).toBe(true);
  });

  it('filters names without exposing allocation tokens', async () => {
    const tree = await mount();
    tree.catalogue.teams[0].allocation_token = 'SECRET_TOKEN';
    const filter = tree.shadowRoot.querySelector('input[type="search"]');
    filter.value = 'Independent';
    filter.dispatchEvent(new Event('input'));
    await tree.updateComplete;
    expect(tree.shadowRoot.textContent).toContain('Independent');
    expect(tree.shadowRoot.textContent).not.toContain('Engine');
    expect(tree.shadowRoot.textContent).not.toContain('SECRET_TOKEN');
  });
});