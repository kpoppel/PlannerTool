import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/DataSources.lit.js';
async function mount(active = 'enrollment', readiness = 'pat') {
  vi.spyOn(adminProvider, 'getAuthenticationSettings').mockResolvedValue({ ok: true,
    data: { active, readiness } });
  vi.spyOn(adminProvider, 'getEventsConfig').mockResolvedValue({ ok: true, data: { event_backend: 'local' } });
  vi.spyOn(adminProvider, 'getAdo').mockResolvedValue({ ok: true,
    data: { organization_url: 'example', feature_flags: {} } });
  vi.spyOn(adminProvider, 'getSystem').mockResolvedValue({ ok: true, data: {} });
  vi.spyOn(adminProvider, 'getGroupsConfig').mockResolvedValue({ ok: true, data: { groups_backend: 'local' } });
  for (const method of ['saveEventsConfig', 'saveAdo', 'saveSystem', 'saveGroupsConfig']) {
    vi.spyOn(adminProvider, method).mockResolvedValue({ ok: true });
  }
  const element = document.createElement('admin-data-sources');
  document.body.append(element);
  await vi.waitFor(() => expect(element._loading).toBe(false));
  await element.updateComplete;
  return element;
}

async function select(element, selector, value) {
  const control = element.shadowRoot.querySelector(selector);
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
  await element.updateComplete;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Data Sources authentication policy', () => {
  it('shows read-only deployment policy', async () => {
    const element = await mount();
    const control = element.shadowRoot.querySelector('#ado-authentication-mode');
    expect(control.value).toBe('pat');
    expect(control.disabled).toBe(true);
    expect([...control.options].map(option => option.textContent)).toEqual(['PAT', 'Entra ID']);
    expect(element.shadowRoot.querySelector('#ado-authentication-status').textContent).toContain('Active: PAT');
    expect(element.shadowRoot.querySelector('#ado-authentication-status').textContent).toContain('Deployment controlled');
  });

  it.each(['ado_mock_fixture', 'ado_mock_generator', 'ado_static'])(
    'hides the ADO authentication selector for %s', async (backend) => {
      const element = await mount();
      await select(element, '.backend-select', backend);
      expect(element.shadowRoot.querySelector('#ado-authentication-mode')).toBeNull();
      await select(element, '.backend-select', 'ado_live');
      expect(element.shadowRoot.querySelector('#ado-authentication-mode').value).toBe('pat');
    });

  it.each(['ready', 'unavailable'])('shows Entra policy with %s broker', async (readiness) => {
    const element = await mount('entra', readiness);
    const control = element.shadowRoot.querySelector('#ado-authentication-mode');
    expect(control.value).toBe('entra');
    expect(control.disabled).toBe(true);
    expect(element.shadowRoot.querySelector('#ado-authentication-status').textContent)
      .toContain(readiness === 'ready' ? 'service ready' : 'service unavailable');
  });

  it('does not save authentication policy with data sources', async () => {
    const element = await mount();
    await element._save();
    const patPayloads = ['saveEventsConfig', 'saveGroupsConfig', 'saveAdo', 'saveSystem']
      .map(method => structuredClone(adminProvider[method].mock.calls[0][0]));
    await element._load();
    await element._save();
    for (const [index, method] of ['saveEventsConfig', 'saveGroupsConfig', 'saveAdo', 'saveSystem'].entries()) {
      expect(adminProvider[method].mock.calls[1][0]).toEqual(patPayloads[index]);
    }
    expect(element.authenticationSettings.activeMode).toBe('pat');
    expect(element._statusMsg).toBe('Saved.');
  });
});