import { test, expect } from '@playwright/test';

async function accountKeyAppearance(page) {
  return page.locator('auth-dialog').evaluate(dialog =>
    [...dialog.shadowRoot.querySelectorAll('section, h2, p, code, label, button')].map(element => {
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        font: style.font,
        color: style.color,
        background: style.backgroundColor,
        padding: style.padding,
        borderRadius: style.borderRadius,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      };
    })
  );
}

test('desktop Enrollment, rotating keys, deletion, and selective restore', async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.context().setExtraHTTPHeaders({ 'Accept-Encoding': 'br' });
  await page.goto('/');
  await expect(page.getByLabel('Account key', { exact: true })).toHaveCount(0);
  await page.getByLabel('Email address', { exact: true }).fill('auth-e2e@example.com');
  await page.getByLabel('Real name (first enrollment)', { exact: true }).fill('Authentication Test');
  const enrollmentResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/auth/enroll') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Enroll', exact: true }).click();
  const enrollmentHeaders = await (await enrollmentResponse).headersArray();
  expect(enrollmentHeaders.filter(header => header.name.toLowerCase() === 'set-cookie')).toHaveLength(2);
  await expect(page.getByRole('heading', { name: 'Save your account key' })).toBeVisible();
  const firstKey = await page.locator('auth-dialog code').textContent();
  const clientKeyAppearance = await accountKeyAppearance(page);
  await page.screenshot({ path: 'test-results/auth-desktop-client-key.png' });
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Save your account key' })).toBeVisible();
  await page.getByLabel('I have saved this key. It will not be shown again.').check();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await page.getByLabel('I have saved this key. It will not be shown again.').uncheck();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.getByLabel('I have saved this key. It will not be shown again.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL('**/admin/');
  await expect(page.getByRole('button', { name: 'Users', exact: true })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find(cookie => cookie.name === 'plannerDevice').httpOnly).toBe(true);
  expect(cookies.find(cookie => cookie.name === 'sessionId').httpOnly).toBe(true);
  expect(cookies.find(cookie => cookie.name === 'plannerDevice').sameSite).toBe('Lax');
  await page.screenshot({ path: 'test-results/auth-desktop-admin.png' });

  const secondContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const second = await secondContext.newPage();
  await second.goto('http://127.0.0.1:8017/');
  await expect(second.getByRole('heading', { name: 'Enrollment', exact: true })).toBeVisible();
  await second.screenshot({ path: 'test-results/auth-desktop-enrollment.png' });
  await expect(second.getByRole('button', { name: 'Pair', exact: true })).toHaveCount(0);
  await expect(second.getByRole('button', { name: 'Recover', exact: true })).toHaveCount(0);
  await second.getByLabel('Email address', { exact: true }).fill('auth-e2e@example.com');
  await second.getByLabel('Email address', { exact: true }).press('Tab');
  await expect(second.getByLabel('Account key', { exact: true })).toBeVisible();
  await expect(second.getByLabel('Real name (first enrollment)', { exact: true })).toHaveCount(0);
  await second.screenshot({ path: 'test-results/auth-desktop-existing-account.png' });
  await second.getByLabel('Account key', { exact: true }).fill(firstKey);
  await second.getByRole('button', { name: 'Enroll', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Save your account key' })).toBeVisible();
  const secondKey = await second.locator('auth-dialog code').textContent();
  expect(secondKey).not.toBe(firstKey);
  await second.getByLabel('I have saved this key. It will not be shown again.').check();
  await second.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(second.locator('auth-dialog')).toHaveCount(0);
  expect((await secondContext.request.post('http://127.0.0.1:8017/api/session')).status()).toBe(200);
  expect((await secondContext.request.post('http://127.0.0.1:8017/api/auth/enroll', {
    data: { email: 'auth-e2e@example.com', accountKey: firstKey },
  })).status()).toBe(401);

  const thirdContext = await browser.newContext();
  const enrolled = await thirdContext.request.post('http://127.0.0.1:8017/api/auth/enroll', {
    data: { email: 'auth-e2e@example.com', accountKey: secondKey },
  });
  expect(enrolled.status()).toBe(200);
  expect((await enrolled.json()).accountKey).not.toBe(secondKey);
  expect((await thirdContext.request.post('http://127.0.0.1:8017/api/auth/enroll', {
    data: { email: 'auth-e2e@example.com', accountKey: secondKey },
  })).status()).toBe(401);
  const me = await (await secondContext.request.get('http://127.0.0.1:8017/api/auth/me')).json();
  expect((await page.request.delete(`/api/auth/devices/${me.currentDeviceId}`)).status()).toBe(200);
  expect((await secondContext.request.post('http://127.0.0.1:8017/api/session')).status()).toBe(401);
  await secondContext.close();
  await thirdContext.close();

  await page.getByRole('button', { name: 'Users', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save your account key' })).toBeVisible();
  const replacementKey = await page.locator('auth-dialog code').textContent();
  expect(replacementKey).not.toBe(firstKey);
  await expect(page.locator('auth-dialog')).toContainText('auth-e2e@example.com');
  expect(await accountKeyAppearance(page)).toEqual(clientKeyAppearance);
  await page.screenshot({ path: 'test-results/auth-desktop-reset-key.png' });
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Save your account key' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/admin/');
  await page.getByLabel('I have saved this key. It will not be shown again.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:8017/');
  await expect(page.getByRole('heading', { name: 'Enrollment', exact: true })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill('auth-e2e@example.com');
  await page.getByLabel('Email address', { exact: true }).press('Tab');
  await page.getByLabel('Account key', { exact: true }).fill(replacementKey);
  await page.getByRole('button', { name: 'Enroll', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save your account key' })).toBeVisible();
  const keyAfterReset = await page.locator('auth-dialog code').textContent();
  await page.getByLabel('I have saved this key. It will not be shown again.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('auth-dialog')).toHaveCount(0);
  expect((await page.request.get('/admin/v1/users')).status()).toBe(200);
  await page.locator('onboarding-modal').getByRole('button', { name: "Don't show again", exact: true }).click();
  await page.locator('#openConfigBtn').click();
  await expect(page.locator('config-modal output#configEmail')).toHaveText('auth-e2e@example.com');
  await expect(page.locator('config-modal input#configEmail')).toHaveCount(0);
  await expect(page.locator('config-modal #configPat')).toBeFocused();
  await expect(page.locator('config-modal #pairBrowserBtn')).toHaveCount(0);
  await expect(page.locator('config-modal #deleteAccountBtn')).toBeVisible();
  await page.screenshot({ path: 'test-results/auth-desktop-configuration.png' });
  await page.locator('config-modal #closeConfigBtn').click();
  await expect(page.locator('config-modal')).toHaveCount(0);
  await page.goto('/admin/');
  await expect(page.getByRole('button', { name: 'Users', exact: true })).toBeVisible();

  const retainedContext = await browser.newContext();
  try {
    const retainedEnrollment = await retainedContext.request.post('http://127.0.0.1:8017/api/auth/enroll', {
      data: { email: 'auth-e2e@example.com', accountKey: keyAfterReset },
    });
    expect(retainedEnrollment.status()).toBe(200);
    const keyAfterRetained = (await retainedEnrollment.json()).accountKey;
    await page.goto('/');
    await page.locator('#openConfigBtn').click();
    await page.evaluate(() => {
      for (const storage of [localStorage, sessionStorage]) {
        storage.setItem('az_planner:search:lastQuery', 'private search');
        storage.setItem('plannerTool_localPluginData_logout-test', 'private draft');
        storage.setItem('config', 'private config');
        storage.setItem('unrelated:preferences', 'keep');
      }
    });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('config-modal #signOutBtn').click();
    await expect(page.getByRole('heading', { name: 'Enrollment', exact: true })).toBeVisible();
    await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('');
    const signedOutCookies = await page.context().cookies();
    expect(signedOutCookies.filter(cookie =>
      cookie.name === 'sessionId' || cookie.name === 'plannerDevice'
    )).toHaveLength(0);
    expect(await page.evaluate(() => [localStorage, sessionStorage].map(storage => ({
      search: storage.getItem('az_planner:search:lastQuery'),
      draft: storage.getItem('plannerTool_localPluginData_logout-test'),
      config: storage.getItem('config'),
      unrelated: storage.getItem('unrelated:preferences'),
    })))).toEqual([
      { search: null, draft: null, config: null, unrelated: 'keep' },
      { search: null, draft: null, config: null, unrelated: 'keep' },
    ]);
    expect((await page.request.get('/admin/v1/users')).status()).toBe(401);
    expect((await retainedContext.request.post('http://127.0.0.1:8017/api/session')).status()).toBe(200);
    expect((await retainedContext.request.get('http://127.0.0.1:8017/admin/v1/users')).status()).toBe(200);
    await page.screenshot({ path: 'test-results/auth-desktop-signed-out.png' });
    await page.getByLabel('Email address', { exact: true }).fill('auth-e2e@example.com');
    await page.getByLabel('Email address', { exact: true }).press('Tab');
    await page.getByLabel('Account key', { exact: true }).fill(keyAfterRetained);
    await page.getByRole('button', { name: 'Enroll', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Save your account key' })).toBeVisible();
    await page.getByLabel('I have saved this key. It will not be shown again.').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('auth-dialog')).toHaveCount(0);

    const userContext = await browser.newContext();
    const otherUserContext = await browser.newContext();
    try {
      const userEnrollment = await userContext.request.post('http://127.0.0.1:8017/api/auth/enroll', {
        data: { email: 'delete-e2e@example.com', name: 'Deletion Test' },
      });
      expect(userEnrollment.status()).toBe(200);
      const otherEnrollment = await otherUserContext.request.post('http://127.0.0.1:8017/api/auth/enroll', {
        data: { email: 'delete-e2e@example.com', accountKey: (await userEnrollment.json()).accountKey },
      });
      expect(otherEnrollment.status()).toBe(200);
      const deletionKey = (await otherEnrollment.json()).accountKey;
      const savedView = await userContext.request.post('http://127.0.0.1:8017/api/view', {
        data: { op: 'save', data: { name: 'Owned view' } },
      });
      expect(savedView.status()).toBe(200);
      const ownerId = (await savedView.json()).user;
      await userContext.clearCookies();
      const userPage = await userContext.newPage();
      await userPage.goto('http://127.0.0.1:8017/');
      await userPage.getByRole('button', { name: 'Delete account', exact: true }).click();
      await userPage.getByLabel('Email address', { exact: true }).fill('delete-e2e@example.com');
      await userPage.getByLabel('Account key', { exact: true }).fill(deletionKey);
      await userPage.screenshot({ path: 'test-results/auth-desktop-delete-account.png' });
      userPage.once('dialog', dialog => dialog.accept());
      await userPage.locator('auth-dialog button[type="submit"]').click();
      await expect(userPage.getByRole('heading', { name: 'Enrollment', exact: true })).toBeVisible();
      expect((await otherUserContext.request.post('http://127.0.0.1:8017/api/session')).status()).toBe(401);
      const postDeletionBackup = await (await page.request.get('/admin/v1/backup')).json();
      expect(Object.hasOwn(postDeletionBackup.accounts.users, 'delete-e2e@example.com')).toBe(false);
      expect(Object.hasOwn(postDeletionBackup.authentication.account_auth, ownerId)).toBe(false);
      expect(Object.keys(postDeletionBackup.views).some(key => key.startsWith(ownerId + '_'))).toBe(false);
    } finally {
      await userContext.close();
      await otherUserContext.close();
    }

    await page.goto('/admin/');
    const snapshot = await (await page.request.get('/admin/v1/backup')).json();
    await page.getByRole('button', { name: 'Utilities', exact: true }).click();
    await page.locator('admin-utilities input[type="file"]').setInputFiles({
      name: 'account-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(snapshot)),
    });
    await page.locator('#restore-accounts').uncheck();
    await expect(page.locator('#accountRestoreWarning')).toHaveCount(0);
    await expect(page.locator('#restore-authentication')).toHaveCount(0);
    const selectiveResponse = page.waitForResponse(response => response.url().endsWith('/admin/v1/restore'));
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Restore Selected', exact: true }).click();
    const selective = await selectiveResponse;
    expect(selective.status()).toBe(200);
    const selectivePayload = selective.request().postDataJSON();
    expect(Object.hasOwn(selectivePayload, 'accounts')).toBe(false);
    expect(Object.hasOwn(selectivePayload, 'authentication')).toBe(false);
    expect((await page.request.post('/api/session')).status()).toBe(200);
    const unchanged = await (await page.request.get('/admin/v1/backup')).json();
    const adminId = snapshot.accounts.users['auth-e2e@example.com'].account_id;
    expect(unchanged.authentication.account_auth[adminId].account_key_hash)
      .toBe(snapshot.authentication.account_auth[adminId].account_key_hash);

    await page.locator('#restore-accounts').check();
    await expect(page.locator('#accountRestoreWarning')).toContainText('older');
    await expect(page.locator('#accountRestoreWarning')).toContainText('Reset access');
    await page.screenshot({ path: 'test-results/auth-desktop-restore-warning.png' });
    const fullResponse = page.waitForResponse(response => response.url().endsWith('/admin/v1/restore'));
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('delete their account');
      expect(dialog.message()).toContain('Reset access');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Restore Selected', exact: true }).click();
    const full = await fullResponse;
    expect(full.status()).toBe(200);
    expect(Object.hasOwn(full.request().postDataJSON(), 'authentication')).toBe(true);
    await expect(page.locator('admin-utilities')).toContainText('User accounts restored');
    expect((await page.request.post('/api/session')).status()).toBe(200);
  } finally {
    await retainedContext.close();
  }
});