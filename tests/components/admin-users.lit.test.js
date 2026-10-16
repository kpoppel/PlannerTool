import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/Users.lit.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Delegated user permissions', () => {
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