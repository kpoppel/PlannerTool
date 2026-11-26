import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showAuthDialog, showAccountKeyDialog } from '../../www/js/components/AuthDialog.lit.js';
import '../../www/admin/js/components/admin/Users.lit.js';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import { AUTH_SCENARIOS, createMockAuth, OTHER_MOCK_ACCOUNT } from '../helpers/mockAuth.js';

describe('isolated authentication scenarios', () => {
  it('does not claim a local session is active after signed-out sign-in fails', async () => {
    const model = createMockAuth('entra_signed_out');
    vi.spyOn(model, 'signIn').mockRejectedValue(
      Object.assign(new Error('auth_unavailable'), { code: 'auth_unavailable' }));
    const status = document.createElement('auth-status');
    status.authentication = model;
    document.body.append(status);
    await status.updateComplete;
    await status._onSignIn();
    await status.updateComplete;
    expect(model.state.account).toBeNull();
    expect(status.shadowRoot.textContent).toContain('Please try again later.');
    expect(status.shadowRoot.textContent).not.toContain('local session is still active');
    status.remove();
  });

  it.each(['auth_unavailable', 'access_denied'])('presents typed sign-in failure %s without losing the account', async code => {
    const model = createMockAuth('interaction_required');
    vi.spyOn(model, 'signIn').mockRejectedValue(Object.assign(new Error(code), { code }));
    const status = document.createElement('auth-status');
    status.authentication = model;
    document.body.append(status);
    await status.updateComplete;
    await status._onSignIn();
    await status.updateComplete;
    expect(status.shadowRoot.textContent).toContain(code === 'auth_unavailable' ? 'service unavailable' : 'access denied');
    expect(model.state.account).not.toBeNull();
    expect(status._busy).toBe(false);
    status.remove();
  });
  it.each([
    ['entra_signed_out', 'Signed out'],
    ['entra_signed_in', 'Connected'],
    ['session_expired', 'session has expired'],
    ['interaction_required', 'requires reauthentication'],
    ['access_denied', 'access denied'],
    ['unavailable', 'service unavailable'],
  ])('presents %s with only the permitted recovery controls', async (scenario, message) => {
    const model = createMockAuth(scenario);
    const status = document.createElement('auth-status');
    status.authentication = model;
    document.body.append(status);
    await status.updateComplete;
    expect(status.shadowRoot.textContent).toContain(message);
    const buttons = [...status.shadowRoot.querySelectorAll('button')];
    if (scenario === 'access_denied' || scenario === 'unavailable') {
      expect(buttons).toHaveLength(0);
      expect(model.state.account).not.toBeNull();
    }
    if (model.state.mode === 'broker') {
      expect(status.shadowRoot.querySelector('input')).toBeNull();
      expect(status.shadowRoot.textContent).not.toContain('Enroll this browser');
    }
    status.remove();
  });

  it('keeps cancelled sign-in open, then presents a different returning account', async () => {
    const model = createMockAuth('session_expired');
    const status = document.createElement('auth-status');
    status.authentication = model;
    document.body.append(status);
    await status.updateComplete;
    model.setSignInOutcome({ cancelled: true });
    await status._onSignIn();
    await status.updateComplete;
    expect(status.shadowRoot.textContent).toContain('Sign-in cancelled.');
    expect(model.state.account).toBeNull();
    model.setSignInOutcome({ account: OTHER_MOCK_ACCOUNT });
    await status._onSignIn();
    await status.updateComplete;
    expect(status.shadowRoot.textContent).toContain(OTHER_MOCK_ACCOUNT.email);
    model.select('interaction_required');
    await status.updateComplete;
    expect(status.shadowRoot.querySelector('button').textContent).toBe('Reauthenticate');
    await status._onSignIn();
    expect(model.state.status).toBe('connected');
    status.remove();
  });

  it('unsubscribes on removal and subscribes again when reopened', async () => {
    const model = createMockAuth('entra_signed_out');
    const subscribe = vi.spyOn(model, 'subscribe');
    const status = document.createElement('auth-status');
    status.authentication = model;
    document.body.append(status);
    await status.updateComplete;
    status.remove();
    document.body.append(status);
    await status.updateComplete;
    model.select('entra_signed_in');
    await status.updateComplete;
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(status.shadowRoot.textContent).toContain('Connected');
    status.remove();
  });

  it('retains admin permissions and removal without enrollment or key reset', async () => {
    vi.spyOn(adminProvider, 'getUsers').mockResolvedValue({ ok: true, data: {
      currentId: 'admin', accounts: [
        { id: 'admin', email: 'admin@example.com', permissions: ['admin'], lastActive: null },
        { id: 'user', email: 'user@example.com', permissions: [], lastActive: null },
      ],
    } });
    const model = createMockAuth('entra_signed_in');
    const users = document.createElement('admin-users');
    users.authentication = model;
    document.body.append(users);
    await vi.waitFor(() => expect(users.loading).toBe(false));
    users.account = users.users[1];
    users._openDialog('account');
    await users.updateComplete;
    const buttons = [...users.shadowRoot.querySelectorAll('button')].map(button => button.textContent.trim());
    expect(buttons).toContain('Edit permissions');
    expect(buttons).toContain('Remove user');
    expect(buttons).not.toContain('Reset access');
    expect(buttons).not.toContain('Add user');
    const reset = vi.spyOn(adminProvider, 'resetAccountAccess');
    await users.resetAccess(users.account);
    expect(reset).not.toHaveBeenCalled();
    model.select('local');
    await users.updateComplete;
    expect(users.shadowRoot.textContent).toContain('Reset access');
    expect(users.users[1].permissions).toEqual([]);
  });

  it('switches capabilities without a network or browser session', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const model = createMockAuth('local');
    const changed = vi.fn();
    const unsubscribe = model.subscribe(changed);
    for (const name of Object.keys(AUTH_SCENARIOS)) model.select(name);
    expect(changed).toHaveBeenCalledTimes(Object.keys(AUTH_SCENARIOS).length);
    expect(model.state.capabilities.enrollment).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
    unsubscribe();
  });

  it('keeps cancellation, returning identity and logout explicit', async () => {
    const model = createMockAuth('session_expired');
    const expired = model.state;
    expect(await model.signIn({ cancelled: true })).toBe(false);
    expect(model.state).toBe(expired);
    await model.signIn({ account: OTHER_MOCK_ACCOUNT });
    expect(model.state.account).toBe(OTHER_MOCK_ACCOUNT);
    await model.logout();
    expect(model.state.account).toBeNull();
    expect(model.state.status).toBe('signed_out');
  });

  it('uses the injected Entra sign-in boundary without enrollment prompts', async () => {
    const model = createMockAuth('entra_signed_out');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const completion = showAuthDialog('/prefix/api', model);
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    const status = dialog.renderRoot.querySelector('auth-status');
    await status.updateComplete;
    expect(dialog.renderRoot.querySelector('input')).toBeNull();
    expect(status.shadowRoot.textContent).not.toContain('Enrollment');
    expect(status.shadowRoot.querySelector('button').textContent).toBe('Sign in');
    status.shadowRoot.querySelector('button').click();
    await completion;
    expect(document.querySelector('auth-dialog')).toBeNull();
    expect(model.state.status).toBe('connected');
    expect(fetch).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  document.querySelectorAll('auth-dialog').forEach((dialog) => dialog.remove());
  document.querySelectorAll('admin-users').forEach((component) => component.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  delete window.APP_BASE_URL;
});

describe('account enrollment dialog', () => {
  beforeEach(() => {
    window.APP_BASE_URL = '';
    vi.stubGlobal('IS_VITE_DEV', false);
    vi.stubEnv('DEV', false);
  });

  it('shows overview beside enrollment and opens the enrollment guide in the same panel', async () => {
    showAuthDialog('/prefix/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    const frame = dialog.renderRoot.querySelector('.info-panel iframe');
    expect(frame.getAttribute('src')).toBe('/prefix/static/docs/onboarding/index.html?embedded=1');
    const help = dialog.renderRoot.querySelector('button[aria-label="Enrollment help"]');
    help.click();
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('.info-panel iframe').getAttribute('src'))
      .toBe('/prefix/static/docs/account-access/index.html?embedded=1');
    expect(help.closest('a')).toBeNull();
    dialog.accountKey = 'test-only-key';
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('.info-panel iframe').getAttribute('src'))
      .toBe('/prefix/static/docs/account-access/index.html?embedded=1');
  });

  it('uses Vite docs URLs for both enrollment information pages', async () => {
    const originalIsViteDev = window.IS_VITE_DEV;
    window.IS_VITE_DEV = true;
    showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('.info-panel iframe').getAttribute('src'))
      .toBe('/docs/onboarding/index.html?embedded=1');
    dialog.renderRoot.querySelector('button[aria-label="Enrollment help"]').click();
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('.info-panel iframe').getAttribute('src'))
      .toBe('/docs/account-access/index.html?embedded=1');
    if (originalIsViteDev === undefined) delete window.IS_VITE_DEV;
    else window.IS_VITE_DEV = originalIsViteDev;
  });

  it('shows only one Enroll button in enrollment mode', async () => {
    showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    const enrollButtons = [...dialog.renderRoot.querySelectorAll('button')]
      .filter(button => button.textContent.trim() === 'Enroll');
    expect(enrollButtons).toHaveLength(1);
    expect(enrollButtons[0].type).toBe('submit');
  });

  it('sends only email, name and account key to enrollment', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ requiresKey: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountKey: 'next-key' })));
    vi.stubGlobal('fetch', fetch);
    showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    dialog.renderRoot.querySelector('#email').value = 'owner@example.com';
    await dialog._checkEnrollment();
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelectorAll('input[type="password"]')).toHaveLength(0);
    dialog.renderRoot.querySelector('#name').value = 'Owner';
    await dialog._submit(new Event('submit'));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      email: 'owner@example.com', name: 'Owner', accountKey: '',
    });
  });

  it('shows real name but no account key before first enrollment', async () => {
    showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('#name')).not.toBeNull();
    expect(dialog.renderRoot.querySelector('#accountKey')).toBeNull();
    const buttons = [...dialog.renderRoot.querySelectorAll('button')].map(button => button.textContent.trim());
    expect(buttons).not.toContain('Pair');
    expect(buttons).not.toContain('Recover');
  });

  it('switches to the required account key for an enrolled email', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ requiresKey: true }),
    });
    vi.stubGlobal('fetch', fetch);
    showAuthDialog('/dev/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    dialog.renderRoot.querySelector('#email').value = 'existing@example.com';
    await dialog._checkEnrollment();
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('#name')).toBeNull();
    expect(dialog.renderRoot.querySelector('#accountKey').required).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/dev/api/auth/enrollment-status', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ email: 'existing@example.com' }),
    }));
    dialog.renderRoot.querySelector('#email').value = 'new@example.com';
    dialog._onEmailInput();
    fetch.mockResolvedValue({ ok: true, json: async () => ({ requiresKey: false }) });
    await dialog._checkEnrollment();
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('#name')).not.toBeNull();
    expect(dialog.renderRoot.querySelector('#accountKey')).toBeNull();
  });

  it('ignores enrollment-status responses for an email that has changed', async () => {
    let finish;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(resolve => {
      finish = resolve;
    })));
    showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    dialog.renderRoot.querySelector('#email').value = 'existing@example.com';
    const checking = dialog._checkEnrollment();
    dialog.renderRoot.querySelector('#email').value = 'new@example.com';
    dialog._onEmailInput();
    finish({ ok: true, json: async () => ({ requiresKey: true }) });
    await checking;
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('#email').value).toBe('new@example.com');
    expect(dialog.renderRoot.querySelector('#accountKey')).toBeNull();
    expect(dialog.checkingEmail).toBe(false);
  });

  it('shows an admin-issued key until saved without making authentication requests', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const done = showAccountKeyDialog('replacement-account-key', 'user@example.com');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('code').textContent).toBe('replacement-account-key');
    expect(dialog.renderRoot.textContent).toContain('user@example.com');
    const continueButton = [...dialog.renderRoot.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Continue');
    const saved = dialog.renderRoot.querySelector('#saved');
    expect(continueButton.disabled).toBe(true);
    continueButton.click();
    expect(document.querySelector('auth-dialog')).toBe(dialog);
    expect(dialog.error).toBe('');
    saved.click();
    await dialog.updateComplete;
    expect(continueButton.disabled).toBe(false);
    saved.click();
    await dialog.updateComplete;
    expect(continueButton.disabled).toBe(true);
    saved.click();
    await dialog.updateComplete;
    continueButton.click();
    await done;
    expect(document.querySelector('auth-dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('hands an account reset key to the shared modal without reloading user data', async () => {
    const account = { id: 'account-id', email: 'user@example.com', permissions: [], lastActive: null };
    const getUsers = vi.spyOn(adminProvider, 'getUsers').mockResolvedValue({
      ok: true, data: { accounts: [account], currentId: 'admin-id' },
    });
    const resetAccountAccess = vi.spyOn(adminProvider, 'resetAccountAccess').mockResolvedValue({
      ok: true, data: { accountKey: 'admin-reset-key' },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const component = document.createElement('admin-users');
    document.body.appendChild(component);
    await vi.waitFor(() => expect(component.users).toHaveLength(1));
    const reset = component.resetAccess(account);
    await vi.waitFor(() => expect(document.querySelector('auth-dialog')).not.toBeNull());
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('code').textContent).toBe('admin-reset-key');
    await component.resetAccess(account);
    expect(resetAccountAccess).toHaveBeenCalledTimes(1);
    expect(component.resetting).toBe(true);
    dialog.renderRoot.querySelector('#saved').click();
    await dialog.updateComplete;
    [...dialog.renderRoot.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Continue').click();
    await reset;
    expect(component.resetting).toBe(false);
    expect(getUsers).toHaveBeenCalledTimes(1);
    expect(document.querySelector('auth-dialog')).toBeNull();
  });

  it('requires account-key confirmation and preserves local preferences', async () => {
    localStorage.setItem('az_planner:user_prefs:v1', JSON.stringify({ 'autosave.interval': 5 }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ accountKey: 'generated-account-key' }),
    }));
    const done = showAuthDialog('/dev/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    dialog.renderRoot.querySelector('#email').value = 'user@example.com';
    dialog.renderRoot.querySelector('#name').value = 'Example User';
    await dialog._submit({ preventDefault() {} });
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('code').textContent).toBe('generated-account-key');
    const continueButton = [...dialog.renderRoot.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Continue');
    expect(continueButton.disabled).toBe(true);
    continueButton.click();
    expect(document.querySelector('auth-dialog')).toBe(dialog);
    expect(dialog.error).toBe('');
    dialog.renderRoot.querySelector('#saved').click();
    await dialog.updateComplete;
    continueButton.click();
    await done;
    expect(document.querySelector('auth-dialog')).toBeNull();
    expect(JSON.parse(localStorage.getItem('az_planner:user_prefs:v1'))).toEqual({
      'autosave.interval': 5, 'user.email': 'user@example.com',
    });
  });

  it('keeps the newly issued key visible when local preferences cannot be parsed', async () => {
    localStorage.setItem('az_planner:user_prefs:v1', 'invalid-json');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ accountKey: 'newly-issued-key' }),
    }));
    const done = showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    dialog.renderRoot.querySelector('#email').value = 'user@example.com';
    dialog.renderRoot.querySelector('#name').value = 'Example User';
    await dialog._submit({ preventDefault() {} });
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('code')).not.toBeNull();
    expect(dialog.renderRoot.querySelector('code').textContent).toBe('newly-issued-key');
    expect(dialog.error).toContain('local preferences');
    expect(localStorage.getItem('az_planner:user_prefs:v1')).toBe('invalid-json');
    dialog.renderRoot.querySelector('#saved').click();
    await dialog.updateComplete;
    [...dialog.renderRoot.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Continue').click();
    await done;
  });

  it('does not enroll an already enrolled account by email alone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    dialog.renderRoot.querySelector('#email').value = 'user@example.com';
    dialog.renderRoot.querySelector('#name').value = 'Another Person';
    await dialog._submit({ preventDefault() {} });
    await dialog.updateComplete;
    expect(dialog.renderRoot.querySelector('[role="alert"]').textContent).toContain('current account key');
    expect(dialog.renderRoot.querySelector('#accountKey').required).toBe(true);
    expect(dialog.renderRoot.querySelector('#email').value).toBe('user@example.com');
  });
});