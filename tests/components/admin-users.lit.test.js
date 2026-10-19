import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/Users.lit.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('User management', () => {
  it('submits and clears the new account PAT only after saving', async () => {
    vi.spyOn(adminProvider, 'getUsers').mockResolvedValue({ ok: true, data: {
      accounts: [], currentId: 'admin-id', requiresPat: true,
    } });
    const save = vi.spyOn(adminProvider, 'createUser').mockResolvedValue({ ok: false,
      error: { code: 'pat_invalid', message: 'HTTP 400' } });
    const element = document.createElement('admin-users');
    document.body.append(element);
    await vi.waitFor(() => expect(element.loading).toBe(false));
    await element.updateComplete;
    element._openAdd();
    await element.updateComplete;
    const field = element.shadowRoot.querySelector('[data-pat="User"]');
    expect(field.type).toBe('password');
    element.newUser = 'new@example.com';
    field.value = 'target-user-fixture-pat';
    field.dispatchEvent(new Event('input'));
    await element.addUser();
    expect(save).toHaveBeenCalledWith('new@example.com', [],
      'target-user-fixture-pat');
    expect(element.newUser).toBe('new@example.com');
    expect(element.error).toContain('PAT');
    save.mockResolvedValue({ ok: true });
    await element.addUser();
    await element.updateComplete;
    expect(element.newUser).toBe('');
    expect(element.newUserPat).toBe('');
    expect(element.dialog).toBe('');
  });

  it('grants and revokes individual permissions without discarding other grants', async () => {
    const account = { id: 'delegate-id', email: 'delegate@example.com',
      permissions: ['manage_projects'], lastActive: null };
    vi.spyOn(adminProvider, 'getUsers').mockResolvedValue({ ok: true, data: {
      accounts: [account], currentId: 'admin-id',
    } });
    const save = vi.spyOn(adminProvider, 'setUserPermissions').mockResolvedValue({ ok: true });
    const element = document.createElement('admin-users');
    document.body.append(element);
    await vi.waitFor(() => expect(element.loading).toBe(false));
    await element.updateComplete;
    element._openEditor([account.id]);
    await element.updateComplete;
    const checkbox = element.shadowRoot.querySelector('[data-permission="manage_iterations"]');
    expect(checkbox).not.toBeNull();
    checkbox.click();
    expect(save).not.toHaveBeenCalled();
    element._reviewPermissions();
    await element._applyPermissions();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(
      'delegate-id', ['manage_projects', 'manage_iterations'],
    ));
    await vi.waitFor(() => expect(element.loading).toBe(false));
    await element.updateComplete;
    element._openEditor([account.id]);
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-permission="manage_projects"]').click();
    element._reviewPermissions();
    await element._applyPermissions();
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith(
      'delegate-id', ['manage_iterations'],
    ));
  });

  async function mount(accounts) {
    vi.spyOn(adminProvider, 'getUsers').mockResolvedValue({ ok: true, data: {
      accounts, currentId: 'self', requiresPat: false,
    } });
    const element = document.createElement('admin-users');
    document.body.append(element);
    await vi.waitFor(() => expect(element.loading).toBe(false));
    await element.updateComplete;
    return element;
  }

  const accounts = () => [
    { id: 'self', email: 'admin@example.com', permissions: ['admin'], lastActive: null },
    { id: 'delegate', email: 'delegate@example.com', permissions: ['manage_projects'], lastActive: null },
    { id: 'standard', email: 'standard@example.com', permissions: [], lastActive: null },
  ];

  it('renders each user once and filters effective access including administrators', async () => {
    const element = await mount(accounts());
    expect(element.shadowRoot.querySelectorAll('tbody tr')).toHaveLength(3);
    element.permissionFilter = 'manage_projects';
    element._filterChanged();
    expect(element.filteredUsers.map((user) => user.id)).toEqual(['self', 'delegate']);
    element.accessFilter = 'without';
    element._filterChanged();
    expect(element.filteredUsers.map((user) => user.id)).toEqual(['standard']);
    element.search = 'NO MATCH';
    element._filterChanged();
    await element.updateComplete;
    expect(element.shadowRoot.textContent).toContain('No users match');
  });

  it('selects across pages and clears hidden selection when filters change', async () => {
    const many = Array.from({ length: 27 }, (_, index) => ({
      id: `user-${index}`, email: `user${String(index).padStart(2, '0')}@example.com`,
      permissions: [], lastActive: null,
    }));
    const element = await mount(many);
    element._selectPage(true);
    expect(element.selected.size).toBe(12);
    element.pageIndex = 1;
    element._selectPage(true);
    expect(element.selected.size).toBe(24);
    element._selectMatches();
    expect(element.selected.size).toBe(27);
    element.search = 'user00';
    element._filterChanged();
    expect(element.selected.size).toBe(0);
    expect(element.pageIndex).toBe(0);
  });

  it('shows last active with explicit unknown history and sorts oldest activity first', async () => {
    const element = await mount(accounts().map((user, index) => ({
      ...user, lastActive: index === 2 ? null : 1800000000 - index * 86400,
    })));
    expect(element.shadowRoot.querySelectorAll('time')).toHaveLength(2);
    expect(element.shadowRoot.textContent).toContain('Not recorded');
    element.sortBy = 'lastActive';
    element.ascending = true;
    expect(element.filteredUsers.map((user) => user.id)).toEqual(['delegate', 'self', 'standard']);
    element.ascending = false;
    expect(element.filteredUsers.map((user) => user.id)).toEqual(['self', 'delegate', 'standard']);
  });

  it('bulk grants and revokes only specified permissions after review', async () => {
    const element = await mount(accounts());
    const save = vi.spyOn(adminProvider, 'setUserPermissions').mockResolvedValue({ ok: true });
    element._openEditor(['delegate', 'standard']);
    element.permissionDraft = { ...element.permissionDraft, manage_iterations: 'grant' };
    element._reviewPermissions();
    expect(save).not.toHaveBeenCalled();
    expect(element.proposed).toHaveLength(2);
    await element._applyPermissions();
    expect(save).toHaveBeenCalledWith('delegate', ['manage_projects', 'manage_iterations']);
    expect(save).toHaveBeenCalledWith('standard', ['manage_iterations']);
  });

  it('retains direct grants when administrator access is removed and blocks self-demotion', async () => {
    const element = await mount([...accounts(), {
      id: 'other-admin', email: 'other@example.com', permissions: ['admin', 'manage_projects'], lastActive: null,
    }]);
    element._openEditor(['other-admin']);
    element._setPermissionDraft('admin', false);
    element._reviewPermissions();
    expect(element.proposed[0].permissions).toEqual(['manage_projects']);
    element._openEditor(['self']);
    element._setPermissionDraft('admin', false);
    element._reviewPermissions();
    expect(element.reviewError).toContain('own administrator');
    const save = vi.spyOn(adminProvider, 'setUserPermissions');
    await element._applyPermissions();
    expect(save).not.toHaveBeenCalled();
  });

  it('reports partial bulk failures and retains only failed accounts for retry', async () => {
    const element = await mount(accounts());
    vi.spyOn(adminProvider, 'setUserPermissions')
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: { message: 'Permission update rejected' } });
    element._openEditor(['delegate', 'standard']);
    element.permissionDraft = { ...element.permissionDraft, manage_iterations: 'grant' };
    element._reviewPermissions();
    await element._applyPermissions();
    expect(element.statusMsg).toContain('1 of 2');
    expect(element.error).toContain('standard@example.com');
    expect([...element.selected]).toEqual(['standard']);
    expect(element.users.find((user) => user.id === 'delegate').permissions)
      .toEqual(['manage_projects', 'manage_iterations']);
    expect(element.users.find((user) => user.id === 'standard').permissions).toEqual([]);
  });

  it('builds mailing lists for selected, filtered, and all users with unique CSV recipients', async () => {
    const element = await mount(accounts());
    element.selected = new Set(['delegate']);
    element._openMail('selected');
    expect(element.mailRecipients).toEqual(['delegate@example.com']);
    element.permissionFilter = 'manage_projects';
    element.mailScope = 'filtered';
    expect(element.mailRecipients).toEqual(['admin@example.com', 'delegate@example.com']);
    element.mailScope = 'all';
    element.mailFormat = 'lines';
    expect(element.mailText.split('\n')).toHaveLength(3);
    expect(element.mailCsv).toBe('email\r\n"admin@example.com"\r\n"delegate@example.com"\r\n"standard@example.com"');
  });
});