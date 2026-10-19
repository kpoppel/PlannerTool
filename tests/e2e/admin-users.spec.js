import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fulfillAccountApi } from './helpers.js';

async function openUsers(page, options = {}) {
  const accounts = [
    { id: 'self', email: 'admin@example.com', permissions: ['admin'], lastActive: 1792368000 },
    { id: 'delegate', email: 'delegate@example.com', permissions: ['manage_projects'], lastActive: 1767225600 },
    { id: 'standard', email: 'standard@example.com', permissions: [], lastActive: null },
    ...Array.from({ length: 24 }, (_, index) => ({ id: `user-${index}`,
      email: `user${String(index).padStart(2, '0')}@example.com`, permissions: [], lastActive: null })),
  ];
  const saves = [];
  const creates = [];
  const errors = [];
  const state = { rejectStandard: false, rejectCreate: false, holdSave: null };
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => {
    if (route.request().url().includes('/auth/admin-reset/')) {
      return route.fulfill({ json: { accountKey: 'fixture-replacement-key' } });
    }
    return fulfillAccountApi(route, { email: 'admin@example.com', permissions: ['admin'] });
  });
  await page.route('**/admin/check', (route) => route.fulfill({ json: {
    ok: true, permissions: ['admin'],
  } }));
  await page.route('**/admin/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/permissions')) {
      const id = path.split('/').at(-2);
      const payload = request.postDataJSON();
      saves.push({ id, ...payload });
      if (state.holdSave !== null) await state.holdSave;
      if (state.rejectStandard && id === 'standard') {
        return route.fulfill({ status: 400, json: { detail: 'Permission update rejected' } });
      }
      accounts.find((user) => user.id === id).permissions = payload.permissions;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/users')) {
      if (request.method() === 'POST') {
        const payload = request.postDataJSON();
        creates.push(payload);
        if (state.rejectCreate) {
          return route.fulfill({ status: 400, json: { detail: 'Account creation rejected' } });
        }
        accounts.push({ id: 'new-user', email: payload.email, permissions: payload.permissions,
          lastActive: null });
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { accounts, currentId: 'self', requiresPat: options.requiresPat === true } });
    }
    if (request.method() === 'DELETE') {
      accounts.splice(accounts.findIndex((user) => user.id === path.split('/').at(-1)), 1);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { content: {
      server_name: 'Users fixture', feature_flags: { manage_backup_snapshots: false },
    } } });
  });
  await page.goto('/admin/#users');
  const editor = page.locator('admin-users');
  await expect(editor.locator('tbody tr')).toHaveCount(12);
  return { editor, accounts, saves, creates, state, errors };
}

test('Users table filters effective access, sorts last activity, and exports recipient scopes', async ({ page }, testInfo) => {
  const { editor, errors } = await openUsers(page);
  await expect(editor.locator('tbody tr').first()).toContainText('admin@example.com');
  await expect(editor.locator('time')).toHaveCount(2);
  await expect(editor.getByText('Not recorded', { exact: true }).first()).toBeVisible();
  await editor.getByRole('button', { name: 'Last active', exact: true }).click();
  await expect(editor.locator('tbody tr').first()).toContainText('delegate@example.com');
  await editor.getByRole('button', { name: 'Last active', exact: true }).click();
  await expect(editor.locator('tbody tr').first()).toContainText('admin@example.com');
  await editor.locator('#permission').selectOption('manage_projects');
  await expect(editor.locator('tbody tr')).toHaveCount(2);
  await expect(editor.locator('tbody .access.inherited')).toHaveCount(4);
  await editor.getByRole('button', { name: 'Mailing list', exact: true }).click();
  const modal = editor.getByRole('dialog');
  await expect(modal.locator('#mail-scope')).toHaveValue('filtered');
  await expect(modal.locator('#emails')).toHaveValue('admin@example.com; delegate@example.com');
  await modal.locator('#mail-scope').selectOption('all');
  await expect(modal.getByText('27 unique recipients', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Download CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('planner-user-emails.csv');
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv.split('\r\n')).toHaveLength(28);
  expect(csv).toContain('"delegate@example.com"');
  await modal.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await editor.getByRole('button', { name: 'Clear filters' }).click();
  await editor.getByRole('checkbox', { name: 'Select this page', exact: true }).check();
  await editor.getByRole('button', { name: 'Next page', exact: true }).click();
  await editor.getByRole('checkbox', { name: 'Select this page', exact: true }).check();
  await expect(editor.getByText('24 selected', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Copy emails', exact: true }).click();
  await expect(modal.locator('#mail-scope')).toHaveValue('selected');
  await expect(modal.getByText('24 unique recipients', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await editor.getByRole('searchbox', { name: 'Search email' }).fill('ADMIN@');
  await expect(editor.getByText('0 selected', { exact: true })).toBeVisible();
  await expect(editor.locator('tbody tr')).toHaveCount(1);
  await editor.getByRole('button', { name: 'Clear filters' }).click();
  for (const width of [1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('users-desktop.png') });
});

test('Bulk permission review locks pending edits and retains failed users for retry', async ({ page }, testInfo) => {
  const { editor, saves, state, errors } = await openUsers(page);
  await editor.getByRole('checkbox', { name: 'Select delegate@example.com', exact: true }).check();
  await editor.getByRole('checkbox', { name: 'Select standard@example.com', exact: true }).check();
  await editor.getByRole('button', { name: 'Edit permissions', exact: true }).click();
  const modal = editor.getByRole('dialog');
  await expect(modal.getByRole('combobox', { name: 'Projects', exact: true })).toHaveValue('keep');
  await modal.getByRole('combobox', { name: 'Iteration mappings', exact: true }).selectOption('grant');
  await modal.getByRole('button', { name: 'Review changes' }).click();
  expect(saves).toEqual([]);
  await expect(modal).toContainText('2 of 2 selected accounts will change.');
  let releaseSave;
  state.holdSave = new Promise((resolve) => { releaseSave = resolve; });
  state.rejectStandard = true;
  await modal.getByRole('button', { name: 'Apply changes' }).click();
  await expect(modal.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  releaseSave();
  await expect(modal).toHaveCount(0);
  await expect(editor.getByRole('status')).toContainText('Updated 1 of 2');
  await expect(editor.getByRole('alert')).toContainText('standard@example.com');
  await expect(editor.getByRole('checkbox', { name: 'Select standard@example.com', exact: true })).toBeChecked();
  expect(saves).toEqual([
    { id: 'delegate', permissions: ['manage_projects', 'manage_iterations'] },
    { id: 'standard', permissions: ['manage_iterations'] },
  ]);
  await editor.getByRole('button', { name: 'Edit permissions', exact: true }).click();
  await modal.getByRole('checkbox', { name: 'Iteration mappings', exact: true }).check();
  await modal.getByRole('button', { name: 'Review changes' }).click();
  state.rejectStandard = false;
  await modal.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor.getByRole('status')).toContainText('Updated 1 of 1');
  await editor.getByRole('button', { name: 'admin@example.com', exact: true }).click();
  await expect(modal.getByRole('checkbox', { name: 'Projects', exact: true })).toBeDisabled();
  await modal.getByRole('checkbox', { name: 'Administrator', exact: true }).uncheck();
  await modal.getByRole('button', { name: 'Review changes' }).click();
  await expect(modal.getByRole('alert')).toContainText('own administrator');
  await expect(modal.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('users-permission-review-desktop.png') });
});

test('Account creation retains PAT on failure and reset uses the saved-key dialog', async ({ page }) => {
  const { editor, creates, state, errors } = await openUsers(page, { requiresPat: true });
  await editor.getByRole('button', { name: 'Add user', exact: true }).click();
  const modal = editor.getByRole('dialog');
  await modal.getByRole('textbox', { name: 'Email', exact: true }).fill('new@example.com');
  await modal.locator('[data-pat="User"]').fill('synthetic-pat');
  state.rejectCreate = true;
  await modal.getByRole('button', { name: 'Add user', exact: true }).click();
  await expect(modal.getByRole('alert')).toBeVisible();
  await expect(modal.locator('[data-pat="User"]')).toHaveValue('synthetic-pat');
  state.rejectCreate = false;
  await modal.getByRole('button', { name: 'Add user', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(creates[1]).toEqual({ email: 'new@example.com', permissions: [], pat: 'synthetic-pat' });
  await expect(editor.locator('tbody tr')).toHaveCount(1);
  await editor.getByRole('button', { name: 'Actions for new@example.com', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await modal.getByRole('button', { name: 'Reset access', exact: true }).click();
  const keyDialog = page.locator('auth-dialog');
  await expect(keyDialog.locator('code')).toHaveText('fixture-replacement-key');
  await keyDialog.locator('#saved').check();
  await keyDialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(keyDialog).toHaveCount(0);
  await editor.getByRole('button', { name: 'Actions for new@example.com', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await modal.getByRole('button', { name: 'Remove user', exact: true }).click();
  await expect(editor.locator('tbody tr')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Clear filters' }).click();
  await editor.getByRole('button', { name: 'Actions for admin@example.com', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Remove user', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});