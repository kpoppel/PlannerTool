import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/Teams.lit.js';
import '../../www/admin/js/components/AdminApp.lit.js';

async function settle(component) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await component.updateComplete;
}

describe('Workforce team administration', () => {
  let component;

  beforeEach(async () => {
    vi.spyOn(adminProvider, 'getTeams').mockResolvedValue({ ok: true, data: {
      schema_version: 2,
      teams: [
        { name: 'Engineering', short_name: 'ENG', exclude: false },
        { name: 'Retired', short_name: 'OLD', exclude: true },
      ],
    } });
    vi.spyOn(adminProvider, 'getPeopleInspect').mockResolvedValue({ ok: true, data: {
      matched_teams: [{ name: 'Engineering', internal_count: 4, external_count: 2,
        members: [
          { name: 'Private person', site: 'Site A', external: false },
          { name: 'Private person 2', site: 'Site A', external: false },
          { name: 'Private person 3', site: 'Site A', external: false },
          { name: 'Private person 4', site: 'Site B', external: false },
          { name: 'Private person 5', site: 'Site A', external: true },
          { name: 'Private person 6', site: 'Site B', external: true },
        ] }],
      excluded_teams: [{ name: 'Retired', internal_count: 1, external_count: 0,
        members: [{ name: 'Private retired person', site: 'Site B', external: false }] }],
      teams_without_people: [], unmatched_teams: [],
    } });
    vi.spyOn(adminProvider, 'saveTeams').mockResolvedValue({ ok: true, data: {} });
    vi.spyOn(adminProvider, 'getSchema').mockResolvedValue({ ok: true, data: {} });
    component = document.createElement('admin-teams');
    document.body.appendChild(component);
    await settle(component);
  });

  afterEach(() => {
    component.remove();
    vi.restoreAllMocks();
  });

  it('loads teams and staffing in a single workforce workspace without personal details', () => {
    expect(adminProvider.getPeopleInspect).toHaveBeenCalledOnce();
    expect(component.shadowRoot.textContent).toContain('Workforce');
    expect(component.shadowRoot.textContent).toContain('Engineering');
    expect(component.shadowRoot.textContent).not.toContain('Private person');
    expect(component.shadowRoot.querySelector('[data-action="staffing"]')).toBeNull();
    expect(component.shadowRoot.querySelector('[data-action="sites"]')).not.toBeNull();
  });

  it('hides archives by default and allows inspection of archived definitions', async () => {
    expect(component.shadowRoot.querySelector('[data-team="Retired"]')).toBeNull();
    const toggle = component.shadowRoot.querySelector('[data-action="show-archived"]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await component.updateComplete;
    expect(component.shadowRoot.querySelector('[data-team="Retired"]')).not.toBeNull();
  });

  it('archives a team without removing its definition or staffing data', async () => {
    component.shadowRoot.querySelector('[data-team="Engineering"] [data-action="archive"]').click();
    await settle(component);
    const saved = adminProvider.saveTeams.mock.calls[0][0];
    expect(saved.teams).toHaveLength(2);
    expect(saved.teams[0]).toEqual({ name: 'Engineering', short_name: 'ENG', exclude: true });
    expect(component.staffing[0].internal_count).toBe(4);
  });

  it('restores an archived team', async () => {
    component.showArchived = true;
    await component.updateComplete;
    component.shadowRoot.querySelector('[data-team="Retired"] [data-action="restore"]').click();
    await settle(component);
    expect(adminProvider.saveTeams.mock.calls[0][0].teams[1].exclude).toBe(false);
  });

  it('requires destructive acknowledgement and supports cancelling deletion', async () => {
    component.shadowRoot.querySelector('[data-team="Engineering"] [data-action="delete"]').click();
    await component.updateComplete;
    expect(component.shadowRoot.querySelector('[role="dialog"]').textContent).toContain('past ADO tasks');
    expect(component.shadowRoot.querySelector('[data-action="confirm-delete"]').disabled).toBe(true);
    expect(adminProvider.saveTeams).not.toHaveBeenCalled();
    component.shadowRoot.querySelector('[data-action="cancel-delete"]').click();
    await component.updateComplete;
    expect(component.shadowRoot.querySelector('[role="dialog"]')).toBeNull();
    expect(component.content.teams).toHaveLength(2);
  });

  it('deletes only the acknowledged team and leaves other definitions intact', async () => {
    component.shadowRoot.querySelector('[data-team="Engineering"] [data-action="delete"]').click();
    await component.updateComplete;
    const acknowledgement = component.shadowRoot.querySelector('[data-action="acknowledge-delete"]');
    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new Event('change'));
    await component.updateComplete;
    component.shadowRoot.querySelector('[data-action="confirm-delete"]').click();
    await settle(component);
    expect(adminProvider.saveTeams.mock.calls[0][0].teams.map((team) => team.name)).toEqual(['Retired']);
    const retained = component.shadowRoot.querySelector('[data-team="Engineering"]');
    expect(retained.textContent).toContain('Not configured');
    expect(retained.querySelector('[data-action="delete"]')).toBeNull();
    expect(retained.querySelector('[data-action="archive"]')).toBeNull();
  });

  it('retains the loaded configuration when a save fails and shows the error', async () => {
    adminProvider.saveTeams.mockResolvedValue({ ok: false, error: { message: 'Permission denied' } });
    component.shadowRoot.querySelector('[data-team="Engineering"] [data-action="archive"]').click();
    await settle(component);
    expect(component.content.teams[0].exclude).toBe(false);
    expect(component.shadowRoot.textContent).toContain('Permission denied');
  });

  it('expands anonymous site composition directly under the team', async () => {
    const team = component.shadowRoot.querySelector('[data-team="Engineering"]');
    team.querySelector('[data-action="composition"]').click();
    await component.updateComplete;
    const composition = component.shadowRoot.querySelector('[data-composition="Engineering"]');
    expect(composition.textContent).toContain('Site A');
    expect(composition.textContent).toContain('Site B');
    const rows = composition.querySelector('table').querySelectorAll('tbody > tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('3');
    expect(rows[0].textContent).toContain('1');
    expect(component.shadowRoot.querySelector('[data-action="staffing"]')).toBeNull();
    expect(component.shadowRoot.textContent).not.toContain('Private person');
    expect(JSON.stringify(component.staffing)).not.toContain('Private person');
    team.querySelector('[data-action="composition"]').click();
    await component.updateComplete;
    expect(component.shadowRoot.querySelector('[data-composition="Engineering"]')).toBeNull();
  });

  it('keeps site inventory separate and includes archived team composition', async () => {
    component.shadowRoot.querySelector('[data-action="sites"]').click();
    await component.updateComplete;
    expect(component.shadowRoot.querySelector('[data-team="Engineering"]')).toBeNull();
    const site = component.shadowRoot.querySelector('[data-site="Site B"]');
    expect(site.textContent).toContain('Engineering');
    expect(site.textContent).toContain('Retired');
    expect(component.shadowRoot.textContent).not.toContain('Private retired person');
  });

  it('keeps teams without staffing visible and shows an explicit empty composition', async () => {
    component.content = { schema_version: 2, teams: [
      ...component.content.teams, { name: 'Empty', short_name: 'EMP', exclude: false },
    ] };
    await component.updateComplete;
    component.shadowRoot.querySelector('[data-team="Empty"] [data-action="composition"]').click();
    await component.updateComplete;
    expect(component.shadowRoot.querySelector('[data-composition="Empty"]').textContent)
      .toContain('No staffing assigned');
  });

  it('reloads both sources on explicit refresh', async () => {
    component.shadowRoot.querySelector('[data-action="reload"]').click();
    await settle(component);
    expect(adminProvider.saveTeams).not.toHaveBeenCalled();
    expect(adminProvider.getTeams).toHaveBeenCalledTimes(2);
    expect(adminProvider.getPeopleInspect).toHaveBeenCalledTimes(2);
  });

  it('does not expose mutable name or token editors before identity migration', () => {
    expect(component.shadowRoot.querySelector('[data-team="Engineering"] input')).toBeNull();
    expect(component.shadowRoot.querySelector('[data-action="create-team"]')).toBeNull();
  });

  it('merges Teams and People into one Workforce navigation entry', () => {
    const app = document.createElement('admin-app');
    expect(app.sections).toContain('Workforce');
    expect(app.sections).not.toContain('Teams');
    expect(app.sections).not.toContain('People');
    app.activeSection = 'Workforce';
    expect(app.renderContent().strings.join('')).toContain('admin-teams');
  });
});