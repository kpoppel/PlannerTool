import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import { createMockAuth } from '../helpers/mockAuth.js';
import '../../www/admin/js/components/admin/DataSources.lit.js';
async function mount(authentication = null, ado = {}) {
  vi.spyOn(adminProvider, 'getEventsConfig').mockResolvedValue({ ok: true, data: { event_backend: 'local' } });
  vi.spyOn(adminProvider, 'getAdo').mockResolvedValue({ ok: true,
    data: { organization_url: 'example', feature_flags: {}, transport: 'live', ...ado } });
  vi.spyOn(adminProvider, 'getSystem').mockResolvedValue({ ok: true,
    data: { task_backend_id: 'ado', feature_flags: {} } });
  vi.spyOn(adminProvider, 'getGroupsConfig').mockResolvedValue({ ok: true, data: { groups_backend: 'local' } });
  for (const method of ['saveEventsConfig', 'saveAdo', 'saveSystem', 'saveGroupsConfig']) {
    vi.spyOn(adminProvider, method).mockResolvedValue({ ok: true });
  }
  const element = document.createElement('admin-data-sources');
  element.authentication = authentication;
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
    expect(element.shadowRoot.querySelector('[data-authentication-settings] select')).toBeNull();
    expect(element.shadowRoot.querySelector('[data-authentication-settings] label').textContent)
      .toBe('ADO authentication method');
    expect(element.shadowRoot.querySelector('#ado-authentication-status').textContent.trim())
      .toBe('Personal Access Token');
  });

  it.each(['ado_mock_fixture', 'ado_mock_generator', 'ado_static'])(
    'hides the ADO authentication policy for %s', async (backend) => {
      const element = await mount();
      await select(element, '.backend-select', backend);
      expect(element.shadowRoot.querySelector('[data-authentication-settings]')).toBeNull();
      await select(element, '.backend-select', 'ado_live');
      expect(element.shadowRoot.querySelector('#ado-authentication-status').textContent.trim())
        .toBe('Personal Access Token');
    });

  it.each(['entra_signed_in', 'unavailable'])('shows only the Entra method for %s', async (scenario) => {
    const element = await mount(createMockAuth(scenario));
    expect(element.shadowRoot.querySelector('[data-authentication-settings] select')).toBeNull();
    expect(element.shadowRoot.querySelector('#ado-authentication-status').textContent.trim()).toBe('Entra ID');
    expect(element.shadowRoot.querySelector('auth-status')).toBeNull();
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
    expect(element.shadowRoot.querySelector('#ado-authentication-status').textContent.trim())
      .toBe('Personal Access Token');
    expect(element._statusMsg).toBe('Saved.');
  });
});

describe('Data Sources ADO transport', () => {
  it('loads the persisted transport and saves it without selector flags', async () => {
    const element = await mount(null, { transport: 'mock_fixture' });
    expect(element.shadowRoot.querySelector('.backend-select').value).toBe('ado_mock_fixture');
    await select(element, '.backend-select', 'ado_static');
    element._staticDataPath = 'data/static.yml';
    await element._save();
    const payload = adminProvider.saveAdo.mock.calls[0][0];
    expect(payload.transport).toBe('static');
    for (const flag of ['use_static_backend', 'use_azure_mock', 'use_azure_mock_generator']) {
      expect(payload.feature_flags).not.toHaveProperty(flag);
    }
    expect(adminProvider.saveSystem.mock.calls[0][0].task_backend_id).toBe('ado');
  });
});