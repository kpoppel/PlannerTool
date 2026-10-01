import { afterEach, describe, expect, it, vi } from 'vitest';
import { showAuthDialog, showAccountKeyDialog } from '../../www/js/components/AuthDialog.lit.js';
import '../../www/admin/js/components/admin/Users.lit.js';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';

afterEach(() => {
  document.querySelectorAll('auth-dialog').forEach((dialog) => dialog.remove());
  document.querySelectorAll('admin-users').forEach((component) => component.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('account enrollment dialog', () => {
  it('shows only one Enroll button in enrollment mode', async () => {
    showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    await dialog.updateComplete;
    const enrollButtons = [...dialog.renderRoot.querySelectorAll('button')]
      .filter(button => button.textContent.trim() === 'Enroll');
    expect(enrollButtons).toHaveLength(1);
    expect(enrollButtons[0].type).toBe('submit');
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
    const continueButton = dialog.renderRoot.querySelector('button');
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
    const account = { id: 'account-id', email: 'user@example.com', permissions: [] };
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
    dialog.renderRoot.querySelector('button').click();
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
    expect(dialog.renderRoot.querySelector('button').disabled).toBe(true);
    dialog.renderRoot.querySelector('button').click();
    expect(document.querySelector('auth-dialog')).toBe(dialog);
    expect(dialog.error).toBe('');
    dialog.renderRoot.querySelector('#saved').click();
    await dialog.updateComplete;
    dialog.renderRoot.querySelector('button').click();
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
    dialog.renderRoot.querySelector('button').click();
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