import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/DataSources.lit.js';
import { createMockAuth } from '../helpers/mockAuth.js';

const mockSettings = Object.freeze({
  activeMode: 'pat',
  activationUnavailableReason: 'Mock broker is not an activation service.',
});

async function mount(settings = mockSettings) {
  vi.spyOn(adminProvider, 'getAuthenticationSettings').mockResolvedValue({ ok: true,
    data: { active: 'enrollment', readiness: 'pat', deployment_controlled: true } });
  vi.spyOn(adminProvider, 'getEventsConfig').mockResolvedValue({ ok: true, data: { event_backend: 'local' } });
  vi.spyOn(adminProvider, 'getAdo').mockResolvedValue({ ok: true,
    data: { organization_url: 'example', feature_flags: {} } });
  vi.spyOn(adminProvider, 'getSystem').mockResolvedValue({ ok: true, data: {} });
  vi.spyOn(adminProvider, 'getGroupsConfig').mockResolvedValue({ ok: true, data: { groups_backend: 'local' } });
  for (const method of ['saveEventsConfig', 'saveAdo', 'saveSystem', 'saveGroupsConfig']) {
    vi.spyOn(adminProvider, method).mockResolvedValue({ ok: true });
  }
  const element = document.createElement('admin-data-sources');
  if (settings !== null) element.authenticationSettings = settings;
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

describe('Data Sources authentication preview', () => {
  it('drives an injected sign-in preview from the draft and resets it on Cancel', async () => {
    const element = await mount();
    const model = createMockAuth('pat_current');
    element.authentication = model;
    element.addEventListener('authentication-mode-preview', event => {
      model.select(event.detail.mode === 'pat' ? 'pat_current' : 'entra_signed_out');
    });
    await element.updateComplete;
    const fetch = vi.spyOn(globalThis, 'fetch');
    await select(element, '#ado-authentication-mode', 'entra');
    const status = element.shadowRoot.querySelector('auth-status');
    await status.updateComplete;
    expect(status.shadowRoot.textContent).toContain('Sign in');
    await status._onSignIn();
    expect(model.state.status).toBe('connected');
    expect(element.authenticationSettings.activeMode).toBe('pat');
    [...element.shadowRoot.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click();
    await vi.waitFor(() => expect(element._loading).toBe(false));
    await element.updateComplete;
    expect(model.state.mode).toBe('pat');
    expect(fetch).not.toHaveBeenCalled();
    expect(adminProvider.saveAdo).not.toHaveBeenCalled();
  });
  it('shows read-only deployment policy in production', async () => {
    const element = await mount(null);
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

  it('previews Entra without changing active mode or making a request', async () => {
    const element = await mount();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await select(element, '#ado-authentication-mode', 'entra');
    expect(element.shadowRoot.querySelector('#ado-authentication-status').textContent).toContain('Active: PAT');
    expect(element.shadowRoot.querySelector('#ado-authentication-status').textContent).toContain('Selected: Entra ID');
    expect(element.shadowRoot.querySelector('#ado-authentication-unavailable').textContent).toContain(mockSettings.activationUnavailableReason);
    expect(element.shadowRoot.querySelector('button[disabled]').disabled).toBe(true);
    expect(mockSettings.activeMode).toBe('pat');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(adminProvider.saveAdo).not.toHaveBeenCalled();
  });

  it('discards selection on Cancel and when reopening', async () => {
    const element = await mount();
    await select(element, '#ado-authentication-mode', 'entra');
    [...element.shadowRoot.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click();
    await vi.waitFor(() => expect(element._loading).toBe(false));
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('#ado-authentication-mode').value).toBe('pat');
    await select(element, '#ado-authentication-mode', 'entra');
    element.remove();
    document.body.append(element);
    await vi.waitFor(() => expect(element._loading).toBe(false));
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('#ado-authentication-mode').value).toBe('pat');
    expect(adminProvider.saveAdo).not.toHaveBeenCalled();
  });

  it('keeps the existing save payload unchanged with an Entra draft', async () => {
    const element = await mount();
    await element._save();
    const patPayloads = ['saveEventsConfig', 'saveGroupsConfig', 'saveAdo', 'saveSystem']
      .map(method => structuredClone(adminProvider[method].mock.calls[0][0]));
    await select(element, '#ado-authentication-mode', 'entra');
    await element._save();
    for (const [index, method] of ['saveEventsConfig', 'saveGroupsConfig', 'saveAdo', 'saveSystem'].entries()) {
      expect(adminProvider[method].mock.calls[1][0]).toEqual(patPayloads[index]);
    }
    expect(element.authenticationSettings.activeMode).toBe('pat');
    expect(element._statusMsg).toBe('Data sources saved. Authentication selection was not applied.');
  });
});