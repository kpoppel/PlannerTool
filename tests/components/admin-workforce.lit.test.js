import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../www/admin/js/services/providerREST.js', () => ({
  adminProvider: { getWorkforce: vi.fn(), saveWorkforce: vi.fn(), createWorkforceDefinition: vi.fn(),
    reviewWorkforceTeamDeletion: vi.fn(), deleteWorkforceTeam: vi.fn() },
}));

import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/Workforce.lit.js';
import '../../www/admin/js/components/AdminApp.lit.js';

it('routes workforce administration exclusively to the canonical editor', () => {
  const app = document.createElement('admin-app');
  app.setPermissions(['admin']);
  expect(app.sections).not.toContain('Cost');
  expect(app.sections).not.toContain('People');
  expect(app.sections).not.toContain('Teams');
  expect(customElements.get('admin-teams')).toBeUndefined();
  expect(customElements.get('admin-people')).toBeUndefined();
  expect(customElements.get('admin-cost')).toBeUndefined();
  app.activeSection = 'Workforce';
  expect(app.renderContent().strings.join('')).toContain('<admin-workforce');
});

it('opens only authorized administration deep links', () => {
  const previousUrl = window.location.href;
  try {
    window.history.replaceState(null, '', '#iterations');
    const app = document.createElement('admin-app');
    app.setPermissions(['manage_projects', 'manage_iterations']);
    expect(app.activeSection).toBe('Iterations');
    window.history.replaceState(null, '', '#users');
    app.setPermissions(['manage_projects']);
    expect(app.activeSection).toBe('Plans');
  } finally {
    window.history.replaceState(null, '', previousUrl);
  }
});

it('keeps sidebar navigation on the canonical URL despite the static asset base', () => {
  const previousUrl = window.location.href;
  const base = document.createElement('base');
  try {
    window.history.replaceState(null, '', '/admin/');
    base.href = '/static/admin/';
    document.head.prepend(base);
    const app = document.createElement('admin-app');
    app.setPermissions(['admin']);
    app._onSelect('Users');
    expect(window.location.pathname).toBe('/admin/');
    expect(window.location.hash).toBe('#users');
  } finally {
    base.remove();
    window.history.replaceState(null, '', previousUrl);
  }
});

it('limits delegated navigation and rejects direct selection of restricted sections', () => {
  const app = document.createElement('admin-app');
  expect(app.sections).toEqual([]);
  app.setPermissions(['manage_projects', 'manage_iterations']);
  expect(app.sections).toEqual([
    'Plans', 'Azure DevOps Processes', 'Global Project Settings', 'Iterations',
  ]);
  expect(app.activeSection).toBe('Plans');
  app._onSelect('Users');
  expect(app.activeSection).toBe('Plans');
  app.setPermissions(['manage_workforce_costs']);
  expect(app.sections).toEqual(['Workforce']);
  app.setPermissions([]);
  expect(app.sections).toEqual([]);
});

function fixture() {
  return {
    revision: 'first',
    teams: { schema_version: 3, teams: [
      { id: 'team-one', allocation_token: 'ONE', name: 'One', short_name: 'One',
        archived: false, group_id: 'group-one' },
      { id: 'team-empty', allocation_token: 'EMPTY', name: 'Empty', short_name: 'Empty',
        archived: false, group_id: null },
    ], groups: [
      { id: 'group-one', allocation_token: 'GROUP', name: 'Delivery', short_name: 'Delivery',
        archived: false },
      { id: 'group-old', allocation_token: 'OLD', name: 'Retired group', short_name: 'Old',
        archived: true },
    ] },
    workforce: { schema_version: 2, suppliers: [{
      id: 'supplier-one', name: 'Internal provider', external: false, archived: false,
      profiles: [{ id: 'standard', name: 'Standard', monthly_project_hours: 160,
        hourly_rate: 50, archived: false }],
    }], staffing: [{ id: 'row-one', team_id: 'team-one', supplier_id: 'supplier-one',
      profile_id: 'standard', fte: 0.5 }] },
  };
}

async function settle(element) {
  await Promise.resolve();
  await element.updateComplete;
  await Promise.resolve();
  await element.updateComplete;
}

function input(element, selector, value) {
  const field = element.shadowRoot.querySelector(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Canonical Workforce editor', () => {
  let element;

  beforeEach(async () => {
    vi.resetAllMocks();
    adminProvider.getWorkforce.mockResolvedValue({ ok: true, data: { content: fixture() } });
    adminProvider.saveWorkforce.mockImplementation(async (candidate) => ({
      ok: true, data: { ok: true, content: { ...candidate, revision: 'saved' } },
    }));
    element = document.createElement('admin-workforce');
    element.permissions = ['admin'];
    document.body.append(element);
    await settle(element);
  });

  afterEach(() => element.remove());

  it('shows archived incomplete migration items and explicitly completes their review', async () => {
    const snapshot = fixture();
    snapshot.teams.teams[0].archived = true;
    snapshot.teams.teams[0].migration_incomplete = true;
    element.snapshot = snapshot;
    element.showArchived = true;
    await settle(element);
    expect(element.shadowRoot.querySelector('[data-team="team-one"]').textContent)
      .toContain('Needs review');
    element.shadowRoot.querySelector('[data-edit-team="team-one"]').click();
    await settle(element);
    input(element, '[name="name"]', 'Reviewed team');
    const incomplete = element.shadowRoot.querySelector('[name="migration_incomplete"]');
    expect(incomplete.checked).toBe(true);
    incomplete.checked = false;
    incomplete.dispatchEvent(new Event('input', { bubbles: true }));
    element.shadowRoot.querySelector('.dialog form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(element);
    const saved = adminProvider.saveWorkforce.mock.calls[0][0].teams.teams[0];
    expect(saved.migration_incomplete).toBe(false);
    expect(saved.archived).toBe(true);
    expect(saved.id).toBe('team-one');
    expect(saved.allocation_token).toBe('ONE');
    expect(saved.name).toBe('Reviewed team');
  });

  it('prevents team delegates from editing pricing while retaining staffing controls', async () => {
    element.permissions = ['manage_workforce_teams'];
    element.expandedTeams = new Set(['team-one']);
    await settle(element);
    expect(element.shadowRoot.querySelector('[data-edit-team="team-one"]').disabled).toBe(false);
    expect(element.shadowRoot.querySelector('[data-open-profile="row-one"]').disabled).toBe(true);
    element.activeTab = 'suppliers';
    await settle(element);
    expect(element.shadowRoot.querySelector('[data-edit-supplier="supplier-one"]').disabled).toBe(true);
  });

  it('prevents cost delegates from editing teams or staffing', async () => {
    element.permissions = ['manage_workforce_costs'];
    element.expandedTeams = new Set(['team-one']);
    await settle(element);
    expect(element.shadowRoot.querySelector('[data-edit-team="team-one"]').disabled).toBe(true);
    expect(element.shadowRoot.querySelector('[data-edit-staffing="row-one"]').disabled).toBe(true);
    element.activeTab = 'suppliers';
    await settle(element);
    expect(element.shadowRoot.querySelector('[data-edit-supplier="supplier-one"]').disabled).toBe(false);
  });

  it('reviews deletion impact and cancelling or archiving never calls the destructive endpoint', async () => {
    const snapshot = fixture();
    adminProvider.reviewWorkforceTeamDeletion.mockResolvedValue({ ok: true, data: { content: {
      revision: 'first', review_revision: 'review-one', team: snapshot.teams.teams[0],
      group: snapshot.teams.groups[0], staffing: snapshot.workforce.staffing,
      availability: [{ namespace: 'config', key: 'projects', path: ['allocation_defaults', 'project'] }],
      retained_allocations: [{ namespace: 'scenarios', key: 'scenario', path: ['overrides', 'task', 'capacity'] }],
      saved_selections: [{ namespace: 'views', key: 'view', path: ['teams'] }],
      coverage: { historically_complete: false, retained_task_snapshots: 1 },
    } } });
    element.shadowRoot.querySelector('[data-delete-team="team-one"]').click();
    await settle(element);
    const dialog = element.shadowRoot.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('past ADO tasks unusable');
    expect(dialog.textContent).toContain('row-one');
    expect(dialog.textContent).toContain('Unloaded or expired ADO tasks');
    expect(dialog.textContent).toContain('projects');
    expect(dialog.textContent).toContain('scenario');
    expect(dialog.textContent).toContain('view');
    expect(dialog.querySelector('[data-action="confirm-delete"]').disabled).toBe(true);
    dialog.querySelector('[data-action="cancel-delete"]').click();
    await settle(element);
    expect(adminProvider.deleteWorkforceTeam).not.toHaveBeenCalled();
    expect(element.snapshot.revision).toBe('first');
    element.shadowRoot.querySelector('[data-delete-team="team-one"]').click();
    await settle(element);
    element.shadowRoot.querySelector('[data-action="archive-instead"]').click();
    await settle(element);
    expect(adminProvider.saveWorkforce.mock.calls[0][0].teams.teams[0].archived).toBe(true);
    expect(adminProvider.deleteWorkforceTeam).not.toHaveBeenCalled();
  });

  it('deletes only with explicit acknowledgement and the reviewed receipt, preserving survivors', async () => {
    const snapshot = fixture();
    adminProvider.reviewWorkforceTeamDeletion.mockResolvedValue({ ok: true, data: { content: {
      revision: 'first', review_revision: 'review-one', team: snapshot.teams.teams[0],
      group: snapshot.teams.groups[0], staffing: snapshot.workforce.staffing,
      availability: [], retained_allocations: [], saved_selections: [],
      coverage: { historically_complete: false, retained_task_snapshots: 0 },
    } } });
    const committed = fixture();
    committed.revision = 'deleted';
    committed.teams.teams.shift();
    committed.workforce.staffing = [];
    adminProvider.deleteWorkforceTeam.mockResolvedValue({ ok: true, data: { content: committed } });
    element.shadowRoot.querySelector('[data-delete-team="team-one"]').click();
    await settle(element);
    element.shadowRoot.querySelector('[name="deletion_acknowledged"]').click();
    await settle(element);
    element.shadowRoot.querySelector('[data-action="confirm-delete"]').click();
    await settle(element);
    expect(adminProvider.deleteWorkforceTeam).toHaveBeenCalledWith('team-one', {
      revision: 'first', confirmation: { acknowledged: true, review_revision: 'review-one' },
    });
    expect(adminProvider.saveWorkforce).not.toHaveBeenCalled();
    expect(element.snapshot.revision).toBe('deleted');
    expect(element.shadowRoot.querySelector('[data-team="team-one"]')).toBeNull();
    expect(element.shadowRoot.querySelector('[data-team="team-empty"]')).not.toBeNull();
    expect(element.snapshot.workforce.suppliers).toEqual(fixture().workforce.suppliers);
  });

  it('shows only read-only last_updated for teams, groups, staffing, suppliers and profiles', async () => {
    const snapshot = fixture();
    const dates = { last_updated: '2026-10-12T13:45:00Z' };
    Object.assign(snapshot.teams.teams[0], dates);
    Object.assign(snapshot.teams.groups[0], dates);
    Object.assign(snapshot.workforce.staffing[0], dates);
    Object.assign(snapshot.workforce.suppliers[0], dates);
    Object.assign(snapshot.workforce.suppliers[0].profiles[0], dates);
    element.snapshot = snapshot;
    await settle(element);
    expect(element.shadowRoot.querySelector('[data-team="team-one"] time[datetime="2026-10-12T13:45:00Z"]'))
      .not.toBeNull();
    expect(element.shadowRoot.querySelector('[data-group="group-one"] .group-row time[datetime="2026-10-12T13:45:00Z"]'))
      .not.toBeNull();
    expect(element.shadowRoot.querySelector('[data-team="team-empty"]').textContent).toContain('Not recorded');
    element.shadowRoot.querySelector('[data-expand="team-one"]').click();
    await settle(element);
    expect(element.shadowRoot.querySelector('[data-composition="team-one"] time').dateTime)
      .toBe(dates.last_updated);
    element.shadowRoot.querySelector('[data-edit-team="team-one"]').click();
    await settle(element);
    expect(element.shadowRoot.querySelector('.dialog time[datetime="2026-10-12T13:45:00Z"]')).not.toBeNull();
    expect(element.shadowRoot.querySelector('[name="last_updated"]')).toBeNull();
    expect(element.shadowRoot.textContent).not.toContain('Last Archived');
    expect(element.shadowRoot.querySelectorAll('.dialog time')).toHaveLength(1);
    input(element, '[name="name"]', 'Dated team');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(adminProvider.saveWorkforce.mock.calls[0][0].teams.teams[0]).toMatchObject(dates);
    element.shadowRoot.querySelector('[data-action="suppliers-tab"]').click();
    await settle(element);
    expect(element.shadowRoot.querySelector('[data-supplier="supplier-one"] time').dateTime)
      .toBe(dates.last_updated);
    expect(element.shadowRoot.querySelector('[data-profile="standard"] time').dateTime)
      .toBe(dates.last_updated);
  });

  it('places grouped teams and expandable anonymous composition in one view', async () => {
    expect(element.shadowRoot.querySelector('[data-group="group-one"]').textContent).toContain('Delivery');
    expect(element.shadowRoot.querySelector('[data-team="team-empty"]')).not.toBeNull();
    element.shadowRoot.querySelector('[data-expand="team-one"]').click();
    await settle(element);
    const composition = element.shadowRoot.querySelector('[data-composition="team-one"]');
    expect(composition.textContent).toContain('Internal provider');
    expect(composition.textContent).toContain('Standard');
    expect(composition.textContent).toContain('80');
    expect(element.shadowRoot.querySelector('[data-action="staffing-tab"]')).toBeNull();
  });

  it('edits labels and group membership without changing IDs or allocation tokens', async () => {
    element.shadowRoot.querySelector('[data-edit-team="team-one"]').click();
    await settle(element);
    input(element, '[name="name"]', 'Renamed');
    input(element, '[name="group_id"]', '');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    const candidate = adminProvider.saveWorkforce.mock.calls[0][0];
    expect(candidate.revision).toBe('first');
    expect(candidate.teams.teams[0]).toMatchObject({
      id: 'team-one', allocation_token: 'ONE', name: 'Renamed', group_id: null,
    });
    expect(element.snapshot.revision).toBe('saved');
  });

  it('does not offer archived groups for new membership', async () => {
    element.shadowRoot.querySelector('[data-edit-team="team-one"]').click();
    await settle(element);
    const options = element.shadowRoot.querySelectorAll('[name="group_id"] option');
    expect([...options].map((option) => option.value)).toEqual(['', 'group-one']);
  });

  it('edits fractional staffing in the owning team and preserves identity references', async () => {
    element.shadowRoot.querySelector('[data-expand="team-one"]').click();
    await settle(element);
    element.shadowRoot.querySelector('[data-edit-staffing="row-one"]').click();
    await settle(element);
    input(element, '[name="fte"]', '0.75');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(adminProvider.saveWorkforce.mock.calls[0][0].workforce.staffing[0]).toEqual({
      id: 'row-one', team_id: 'team-one', supplier_id: 'supplier-one',
      profile_id: 'standard', fte: 0.75,
    });
  });

  it('deletes a staffing row after confirmation and preserves the other rows', async () => {
    const snapshot = fixture();
    snapshot.workforce.staffing.push({ id: 'row-two', team_id: 'team-one',
      supplier_id: 'supplier-one', profile_id: 'standard', fte: 0.25 });
    element.snapshot = snapshot;
    element.expandedTeams = new Set(['team-one']);
    await settle(element);
    element.shadowRoot.querySelector('[data-edit-staffing="row-one"]').click();
    await settle(element);
    element.shadowRoot.querySelector('[data-action="delete-staffing"]').click();
    await settle(element);
    expect(adminProvider.saveWorkforce).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('[data-action="confirm-delete-staffing"]')).not.toBeNull();
    element.shadowRoot.querySelector('[data-action="cancel-delete-staffing"]').click();
    await settle(element);
    expect(adminProvider.saveWorkforce).not.toHaveBeenCalled();
    element.shadowRoot.querySelector('[data-action="delete-staffing"]').click();
    await settle(element);
    element.shadowRoot.querySelector('[data-action="confirm-delete-staffing"]').click();
    await settle(element);
    expect(adminProvider.saveWorkforce).toHaveBeenCalledTimes(1);
    expect(adminProvider.saveWorkforce.mock.calls[0][0].workforce.staffing).toEqual([
      { id: 'row-two', team_id: 'team-one', supplier_id: 'supplier-one',
        profile_id: 'standard', fte: 0.25 },
    ]);
    expect(element.snapshot.workforce.staffing).toEqual([
      { id: 'row-two', team_id: 'team-one', supplier_id: 'supplier-one',
        profile_id: 'standard', fte: 0.25 },
    ]);
    expect(element.dialog).toBeNull();
  });

  it('requests a server-issued team identity using editable fields only', async () => {
    const committed = fixture();
    committed.revision = 'created';
    committed.teams.teams.push({ id: 'server-issued', allocation_token: 'server-issued',
      name: 'New team', short_name: 'New', archived: false, group_id: null });
    adminProvider.createWorkforceDefinition.mockResolvedValue({
      ok: true, data: { ok: true, content: committed },
    });
    element.shadowRoot.querySelector('[data-action="new-team"]').click();
    await settle(element);
    input(element, '[name="name"]', 'New team');
    input(element, '[name="short_name"]', 'New');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(adminProvider.createWorkforceDefinition).toHaveBeenCalledWith('team', {
      revision: 'first', fields: { name: 'New team', short_name: 'New', group_id: null },
    });
    expect(element.snapshot.revision).toBe('created');
  });

  it('keeps drafts and the original revision on a rejected save', async () => {
    adminProvider.saveWorkforce.mockResolvedValue({ ok: false, error: {
      message: 'HTTP 409', status: 409,
      detail: { detail: { error: 'workforce_conflict', message: 'Reload before saving' } },
    } });
    element.shadowRoot.querySelector('[data-edit-team="team-one"]').click();
    await settle(element);
    input(element, '[name="name"]', 'Unsaved');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(element.snapshot.revision).toBe('first');
    expect(element.snapshot.teams.teams[0].name).toBe('One');
    expect(element.shadowRoot.querySelector('[name="name"]').value).toBe('Unsaved');
    expect(element.shadowRoot.textContent).toContain('Reload before saving');
  });

  it('adopts the committed revision and surfaces cache warnings without replay', async () => {
    adminProvider.saveWorkforce.mockImplementation(async (candidate) => ({ ok: true, data: {
      ok: true, content: { ...candidate, revision: 'committed' },
      warnings: [{ error: 'cost_cache_invalidation_failed', message: 'Saved; cost refresh failed' }],
    } }));
    element.shadowRoot.querySelector('[data-edit-team="team-one"]').click();
    await settle(element);
    input(element, '[name="name"]', 'Committed label');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(element.snapshot.revision).toBe('committed');
    expect(element.shadowRoot.textContent).toContain('Saved; cost refresh failed');
    expect(adminProvider.saveWorkforce).toHaveBeenCalledTimes(1);
  });

  it('shows supplier/profile inventory separately from team composition', async () => {
    element.shadowRoot.querySelector('[data-action="suppliers-tab"]').click();
    await settle(element);
    expect(element.shadowRoot.querySelector('[data-supplier="supplier-one"]').textContent)
      .toContain('Internal provider');
    expect(element.shadowRoot.querySelector('[data-team="team-one"]')).toBeNull();
  });

  it('creates suppliers with editable classification fields and server-owned identity', async () => {
    const committed = fixture();
    committed.workforce.suppliers.push({ id: 'supplier-issued', name: 'Company',
      external: true, archived: false, profiles: [], last_updated: '2026-10-14T12:00:00Z' });
    adminProvider.createWorkforceDefinition.mockResolvedValue({ ok: true, data: { content: committed } });
    element.shadowRoot.querySelector('[data-action="suppliers-tab"]').click();
    await settle(element);
    element.shadowRoot.querySelector('[data-action="new-supplier"]').click();
    await settle(element);
    input(element, '[name="name"]', 'Company');
    element.shadowRoot.querySelector('[name="external"]').click();
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(adminProvider.createWorkforceDefinition).toHaveBeenCalledWith('supplier', {
      revision: 'first', fields: { name: 'Company', external: true },
    });
    expect(element.shadowRoot.querySelector('[data-supplier="supplier-issued"]')).not.toBeNull();
  });

  it('creates a supplier-scoped profile with numeric hours and rate', async () => {
    const committed = fixture();
    committed.workforce.suppliers[0].profiles.push({ id: 'profile-issued', name: 'Specialist',
      monthly_project_hours: 120, hourly_rate: 90, archived: false });
    adminProvider.createWorkforceDefinition.mockResolvedValue({ ok: true, data: { content: committed } });
    element.shadowRoot.querySelector('[data-action="suppliers-tab"]').click();
    await settle(element);
    element.shadowRoot.querySelector('[data-new-profile="supplier-one"]').click();
    await settle(element);
    input(element, '[name="name"]', 'Specialist');
    input(element, '[name="monthly_project_hours"]', '120');
    input(element, '[name="hourly_rate"]', '90');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(adminProvider.createWorkforceDefinition).toHaveBeenCalledWith('profile', {
      revision: 'first', supplier_id: 'supplier-one',
      fields: { name: 'Specialist', monthly_project_hours: 120, hourly_rate: 90 },
    });
  });

  it('reviews all affected staffing rows before editing or archiving a shared profile', async () => {
    const snapshot = fixture();
    snapshot.workforce.staffing.push({ id: 'row-two', team_id: 'team-empty',
      supplier_id: 'supplier-one', profile_id: 'standard', fte: 0.25 });
    element.snapshot = snapshot;
    element.activeTab = 'suppliers';
    await settle(element);
    element.shadowRoot.querySelector('[data-edit-profile="standard"]').click();
    await settle(element);
    expect(element.shadowRoot.querySelectorAll('[data-affected-staffing]')).toHaveLength(2);
    expect(element.shadowRoot.querySelector('.impact').textContent).toContain('One');
    expect(element.shadowRoot.querySelector('.impact').textContent).toContain('Empty');
    input(element, '[name="monthly_project_hours"]', '120');
    input(element, '[name="hourly_rate"]', '75');
    element.shadowRoot.querySelector('[name="archived"]').click();
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    const candidate = adminProvider.saveWorkforce.mock.calls[0][0];
    expect(candidate.workforce.suppliers[0].profiles[0]).toMatchObject({ id: 'standard',
      monthly_project_hours: 120, hourly_rate: 75, archived: true });
    expect(candidate.workforce.staffing).toEqual(snapshot.workforce.staffing);
  });

  it('edits supplier classification and archive state without changing profiles or staffing', async () => {
    element.activeTab = 'suppliers';
    await settle(element);
    element.shadowRoot.querySelector('[data-edit-supplier="supplier-one"]').click();
    await settle(element);
    input(element, '[name="name"]', 'Renamed company');
    element.shadowRoot.querySelector('[name="external"]').click();
    element.shadowRoot.querySelector('[name="archived"]').click();
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    const candidate = adminProvider.saveWorkforce.mock.calls[0][0];
    expect(candidate.workforce.suppliers[0]).toMatchObject({ id: 'supplier-one',
      name: 'Renamed company', external: true, archived: true });
    expect(candidate.workforce.staffing).toEqual(fixture().workforce.staffing);
    expect(candidate.workforce.suppliers[0].profiles).toEqual(fixture().workforce.suppliers[0].profiles);
  });

  it('returns from a profile edit to the unsaved staffing draft using the committed revision', async () => {
    element.shadowRoot.querySelector('[data-expand="team-one"]').click();
    await settle(element);
    element.shadowRoot.querySelector('[data-edit-staffing="row-one"]').click();
    await settle(element);
    input(element, '[name="fte"]', '0.75');
    await settle(element);
    element.shadowRoot.querySelector('[data-action="edit-selected-profile"]').click();
    await settle(element);
    input(element, '[name="hourly_rate"]', '75');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(element.dialog.kind).toBe('staffing');
    expect(element.shadowRoot.querySelector('[name="fte"]').value).toBe('0.75');
    expect(element.snapshot.workforce.staffing[0].fte).toBe(0.5);
    expect(element.snapshot.workforce.suppliers[0].profiles[0].hourly_rate).toBe(75);
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(adminProvider.saveWorkforce.mock.calls[1][0].revision).toBe('saved');
    expect(element.snapshot.workforce.staffing[0].fte).toBe(0.75);
    expect(element.expandedTeams.has('team-one')).toBe(true);
  });

  it('cancels a nested profile edit without discarding the unsaved staffing draft', async () => {
    await element._open('staffing', 'row-one');
    input(element, '[name="fte"]', '1.25');
    await settle(element);
    element.shadowRoot.querySelector('[data-action="edit-selected-profile"]').click();
    await settle(element);
    input(element, '[name="hourly_rate"]', '99');
    element.shadowRoot.querySelector('button[type="button"]').click();
    await settle(element);
    expect(element.dialog.kind).toBe('staffing');
    expect(element.shadowRoot.querySelector('[name="fte"]').value).toBe('1.25');
    expect(element.snapshot.workforce.suppliers[0].profiles[0].hourly_rate).toBe(50);
    expect(adminProvider.saveWorkforce).not.toHaveBeenCalled();
  });

  it('retains a conflicting profile draft and can return to pending staffing without retrying', async () => {
    adminProvider.saveWorkforce.mockResolvedValue({ ok: false, error: {
      message: 'HTTP 409', status: 409,
      detail: { detail: { error: 'workforce_conflict', message: 'Reload before saving' } },
    } });
    await element._open('staffing', 'row-one');
    input(element, '[name="fte"]', '0.875');
    await settle(element);
    element.shadowRoot.querySelector('[data-action="edit-selected-profile"]').click();
    await settle(element);
    input(element, '[name="hourly_rate"]', '99');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(element.dialog.kind).toBe('profile');
    expect(element.shadowRoot.querySelector('[name="hourly_rate"]').value).toBe('99');
    expect(element.snapshot.revision).toBe('first');
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Reload before saving');
    element.shadowRoot.querySelector('button[type="button"]').click();
    await settle(element);
    expect(element.dialog.kind).toBe('staffing');
    expect(element.shadowRoot.querySelector('[name="fte"]').value).toBe('0.875');
    expect(adminProvider.saveWorkforce).toHaveBeenCalledTimes(1);
  });

  it('creates fractional staffing for the selected team with server-owned identity', async () => {
    const committed = fixture();
    committed.revision = 'staffing-created';
    committed.workforce.staffing.push({ id: 'new-server-row', team_id: 'team-empty',
      supplier_id: 'supplier-one', profile_id: 'standard', fte: 0.125 });
    adminProvider.createWorkforceDefinition.mockResolvedValue({
      ok: true, data: { ok: true, content: committed },
    });
    element.shadowRoot.querySelector('[data-expand="team-empty"]').click();
    await settle(element);
    const composition = element.shadowRoot.querySelector('[data-composition="team-empty"]');
    expect(composition.textContent).toContain('No staffing assigned');
    composition.querySelector('button').click();
    await settle(element);
    input(element, '[name="supplier_id"]', 'supplier-one');
    await settle(element);
    input(element, '[name="profile_id"]', 'standard');
    input(element, '[name="fte"]', '0.125');
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    expect(adminProvider.createWorkforceDefinition).toHaveBeenCalledWith('staffing', {
      revision: 'first', fields: { team_id: 'team-empty', supplier_id: 'supplier-one',
        profile_id: 'standard', fte: 0.125 },
    });
  });

  it('cancels a draft without mutation or revision changes', async () => {
    element.shadowRoot.querySelector('[data-edit-team="team-one"]').click();
    await settle(element);
    input(element, '[name="name"]', 'Discarded');
    const cancel = [...element.shadowRoot.querySelectorAll('.dialog button')]
      .find((button) => button.textContent === 'Cancel');
    cancel.click();
    await settle(element);
    expect(element.dialog).toBeNull();
    expect(element.snapshot.revision).toBe('first');
    expect(element.snapshot.teams.teams[0].name).toBe('One');
    expect(adminProvider.saveWorkforce).not.toHaveBeenCalled();
    expect(adminProvider.createWorkforceDefinition).not.toHaveBeenCalled();
  });

  it('archives a group without archiving or hiding its active member team', async () => {
    element.shadowRoot.querySelector('[data-group="group-one"] button:not(.disclosure)').click();
    await settle(element);
    const archived = element.shadowRoot.querySelector('[name="archived"]');
    archived.checked = true;
    archived.dispatchEvent(new Event('input', { bubbles: true }));
    element.shadowRoot.querySelector('[data-action="save-dialog"]').click();
    await settle(element);
    const candidate = adminProvider.saveWorkforce.mock.calls[0][0];
    expect(candidate.teams.groups[0].archived).toBe(true);
    expect(candidate.teams.teams[0].archived).toBe(false);
    expect(element.shadowRoot.querySelector('[data-team="team-one"]')).not.toBeNull();
  });
});