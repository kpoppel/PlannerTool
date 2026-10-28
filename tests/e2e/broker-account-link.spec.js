import { test, expect } from '@playwright/test';

async function mountAccount(page) {
  await page.goto('/js/modules.config.json');
  await page.setContent('<main></main>');
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    const { createInitialAppState } = await import('/js/application/createInitialAppState.js');
    const { createAuthClient, createBrokerHttpAdapter } = await import('/js/services/authClient.js');
    await import('/js/components/ConfigModal.lit.js');
    store.setState(createInitialAppState(), true);
    const state = { mode: 'broker', status: 'signed_in',
      account: { uuid: 'fresh-identity', name: 'New Entra User', email: '' },
      capabilities: { pat: false, enrollment: false, logout: true, deleteAccount: false,
        reauthenticate: false, linkAccount: true } };
    const authentication = createAuthClient({ initialState: state, instance: '/',
      adapter: createBrokerHttpAdapter({ apiUrl: '/api', fetchImpl: fetch,
        presentLogin: async () => false }) });
    const modal = document.createElement('config-modal');
    modal.authentication = authentication;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });
}

test('desktop Configuration links the existing account and reloads the account context', async ({ page }) => {
  const requests = [];
  await page.route('**/api/auth/links/claim', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { mode: 'broker', status: 'signed_in',
      account: { uuid: 'existing-owner', name: 'Existing Owner', email: 'owner@example.test' },
      permissions: ['admin'], capabilities: { pat: false, enrollment: false, logout: true,
        deleteAccount: false, reauthenticate: false, linkAccount: false } } });
  });
  await mountAccount(page);
  await expect(page.getByLabel('Existing account email')).toBeVisible();
  await page.getByLabel('Existing account email').fill('owner@example.test');
  await page.screenshot({ path: test.info().outputPath('legacy-account-link-desktop.png') });
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Link account', exact: true }).click();
  expect(requests).toEqual([]);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Link account', exact: true }).click();
  await expect(page.locator('config-modal')).toHaveCount(0);
  expect(requests).toEqual([{ email: 'owner@example.test' }]);
});

test('desktop Configuration preserves the account and email when linking is rejected', async ({ page }) => {
  await page.route('**/api/auth/links/claim', route => route.fulfill({
    status: 403, json: { error: 'access_denied' },
  }));
  await mountAccount(page);
  await page.getByLabel('Existing account email').fill('claimed@example.test');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Link account', exact: true }).click();
  await expect(page.locator('config-modal .status[role="status"]'))
    .toContainText('This account is not eligible for linking.');
  await expect(page.getByLabel('Existing account email')).toHaveValue('claimed@example.test');
  await expect(page.getByRole('button', { name: 'Link account', exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('legacy-account-link-rejected-desktop.png') });
});