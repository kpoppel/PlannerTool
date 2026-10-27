import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showAuthDialog, showAccountKeyDialog } from '../../www/js/components/AuthDialog.lit.js';
import '../../www/admin/js/components/admin/Users.lit.js';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import { store } from '../../www/js/application/store.js';
import { createUiCommands, NotificationActionIds } from '../../www/js/application/commands/uiCommands.js';
import { bus } from '../../www/js/core/EventBus.js';

const uiCommands = createUiCommands(store, bus);

afterEach(() => {
  document.querySelectorAll('auth-dialog').forEach((dialog) => dialog.remove());
  document.querySelectorAll('set-pat').forEach((dialog) => dialog.remove());
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

  it('saves a masked PAT through the shared repair screen', async () => {
    const { showSetPat } = await import('../../www/js/components/SetPat.lit.js');
    uiCommands.addNotification({
      source: 'Authentication', code: 'pat_required', severity: 'warning',
      message: 'A PAT is required.', actionId: NotificationActionIds.SET_PAT,
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'owner@example.com' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetch);
    const complete = showSetPat('/dev/api', 'pat_required');
    expect(showSetPat('/dev/api', 'pat_required')).toBe(complete);
    const screen = document.querySelector('set-pat');
    await screen.ready;
    await screen.updateComplete;
    const input = screen.renderRoot.querySelector('input');
    expect(input.type).toBe('password');
    input.value = 'fixture-pat';
    await screen._onSave(new Event('submit'));
    await expect(complete).resolves.toBe(true);
    expect(fetch.mock.calls[1][0]).toBe('/dev/api/config');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      email: 'owner@example.com', pat: 'fixture-pat',
    });
    expect(input.value).toBe('');
    expect(store.getState().notifications.some(
      (entry) => entry.actionId === NotificationActionIds.SET_PAT,
    )).toBe(false);
    expect(document.querySelector('set-pat')).toBeNull();
  });

  it('lets the user cancel PAT repair without saving', async () => {
    const { showSetPat } = await import('../../www/js/components/SetPat.lit.js');
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'owner@example.com' })));
    vi.stubGlobal('fetch', fetchImpl);
    const complete = showSetPat('/api', 'pat_required');
    const screen = document.querySelector('set-pat');
    await screen.ready;
    await screen.updateComplete;

    screen.renderRoot.querySelector('button[type="button"]').click();

    await expect(complete).resolves.toBe(false);
    expect(document.querySelector('set-pat')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the PAT screen open when ADO rejects the supplied token', async () => {
    const { showSetPat } = await import('../../www/js/components/SetPat.lit.js');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'owner@example.com' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'pat_invalid' }), { status: 400 })));
    showSetPat('/api', 'pat_invalid');
    const screen = document.querySelector('set-pat');
    await screen.ready;
    await screen.updateComplete;
    screen.renderRoot.querySelector('input').value = 'revoked-fixture-pat';
    await screen._onSave(new Event('submit'));
    await screen.updateComplete;
    expect(screen.renderRoot.textContent).toContain('invalid or expired');
    expect(document.querySelector('set-pat')).toBe(screen);
    expect(screen.busy).toBe(false);
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

  it('requests a masked PAT for live ADO enrollment and sends it only to enrollment', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ requiresKey: false, requiresPat: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountKey: 'next-key' })));
    vi.stubGlobal('fetch', fetch);
    showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    dialog.renderRoot.querySelector('#email').value = 'owner@example.com';
    await dialog._checkEnrollment();
    await dialog.updateComplete;
    const input = dialog.renderRoot.querySelector('#pat');
    expect(input.type).toBe('password');
    expect(input.required).toBe(true);
    input.value = 'fixture-pat';
    dialog.renderRoot.querySelector('#name').value = 'Owner';
    await dialog._submit(new Event('submit'));
    expect(JSON.parse(fetch.mock.calls[1][1].body).pat).toBe('fixture-pat');
    expect(localStorage.getItem('az_planner:user_prefs:v1')).not.toContain('fixture-pat');
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
      ok: true, json: async () => ({ requiresKey: true, requiresPat: true }),
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
    expect(dialog.renderRoot.querySelector('#pat')).toBeNull();
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