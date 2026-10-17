import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/Users.lit.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Delegated user permissions', () => {
  it.each(['User', 'Admin'])('submits and clears the new %s account PAT only after saving', async (kind) => {
    vi.spyOn(adminProvider, 'getUsers').mockResolvedValue({ ok: true, data: {
      accounts: [], currentId: 'admin-id', requiresPat: true,
    } });
    const save = vi.spyOn(adminProvider, 'createUser').mockResolvedValue({ ok: false,
      error: { code: 'pat_invalid', message: 'HTTP 400' } });
    const element = document.createElement('admin-users');
    document.body.append(element);
    await vi.waitFor(() => expect(element.loading).toBe(false));
    await element.updateComplete;
    const field = element.shadowRoot.querySelector(`[data-pat="${kind}"]`);
    expect(field.type).toBe('password');
    element[`new${kind}`] = 'new@example.com';
    field.value = 'target-user-fixture-pat';
    field.dispatchEvent(new Event('input'));
    await element[`add${kind}`]();
    expect(save).toHaveBeenCalledWith('new@example.com', kind === 'Admin' ? ['admin'] : [],
      'target-user-fixture-pat');
    expect(element[`new${kind}`]).toBe('new@example.com');
    expect(element.error).toContain('PAT');
    save.mockResolvedValue({ ok: true });
    await element[`add${kind}`]();
    await element.updateComplete;
    expect(element[`new${kind}`]).toBe('');
    expect(element[`new${kind}Pat`]).toBe('');
    expect(element.shadowRoot.querySelector(`[data-pat="${kind}"]`).value).toBe('');
  });

  it('grants and revokes individual permissions without discarding other grants', async () => {
    const account = { id: 'delegate-id', email: 'delegate@example.com',
      permissions: ['manage_projects'] };
    vi.spyOn(adminProvider, 'getUsers').mockResolvedValue({ ok: true, data: {
      accounts: [account], currentId: 'admin-id',
    } });
    const save = vi.spyOn(adminProvider, 'setUserPermissions').mockResolvedValue({ ok: true });
    const element = document.createElement('admin-users');
    document.body.append(element);
    await vi.waitFor(() => expect(element.loading).toBe(false));
    await element.updateComplete;
    const checkbox = element.shadowRoot.querySelector('[data-permission="manage_iterations"]');
    expect(checkbox).not.toBeNull();
    checkbox.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(
      'delegate-id', ['manage_projects', 'manage_iterations'],
    ));
    await vi.waitFor(() => expect(element.loading).toBe(false));
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-permission="manage_projects"]').click();
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith('delegate-id', []));
  });
});