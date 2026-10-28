import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ORIGIN = 'http://localhost:18880';

const compose = (...argumentsList) => execFileSync('docker', [
  'compose', '--project-name', 'planner-phase-d',
  '--project-directory', 'deployment/phase-d-sandbox', ...argumentsList,
], { stdio: 'pipe', timeout: 60000 });

async function withBrokerScenario(instance, scenario, action) {
  const path = 'deployment/phase-d-sandbox/instances.json';
  const original = readFileSync(path, 'utf8');
  const registry = JSON.parse(original);
  registry.instances[instance].scenario = scenario;
  try {
    writeFileSync(path, JSON.stringify(registry));
    compose('up', '-d', '--force-recreate', '--no-deps', '--wait', 'auth-sandbox');
    await action();
  } finally {
    writeFileSync(path, original);
    compose('up', '-d', '--force-recreate', '--no-deps', '--wait', 'auth-sandbox');
  }
}

async function openSettings(page, instance) {
  await page.request.post(`${ORIGIN}/${instance}/api/auth/release-notes`, {
    data: { releaseId: 'v5.0.0' },
  });
  await page.goto(`${ORIGIN}/${instance}/`);
  await expect.poll(() => page.locator('#appSpinner').evaluate(element => element.open)).toBe(false);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Configuration', exact: true }).click();
  await expect(page.locator('config-modal auth-status')).toBeVisible();
}

async function signIn(page, instance, identity) {
  await page.goto(`${ORIGIN}/${instance}/api/auth/sandbox`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sandbox sign-in' })).toBeVisible();
  await page.getByRole('button', { name: identity, exact: true }).click();
  await expect(page).toHaveURL(`${ORIGIN}/${instance}/api/auth/sandbox`);
  await expect(page.getByText(identity, { exact: true })).toBeVisible();
}

test('normal planner and admin use discovered Entra popup login without enrollment', async ({ page }) => {
  const errors = [];
  const enrollment = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/\/api\/(session$|auth\/(enroll|enrollment-status))/.test(request.url())) {
      enrollment.push(request.url());
    }
  });
  await page.goto(`${ORIGIN}/alpha/`);
  const button = page.getByRole('button', { name: 'Sign in with Entra ID', exact: true });
  await expect(button).toBeVisible();
  const popupOpened = page.waitForEvent('popup');
  await button.click();
  const popup = await popupOpened;
  await popup.getByRole('button', { name: 'Alex Sandbox', exact: true }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`${ORIGIN}/alpha/api/auth/me`);
    return (await response.json()).status;
  }).toBe('signed_in');
  await page.waitForLoadState('domcontentloaded');
  const profile = await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
  await page.request.post(`${ORIGIN}/alpha/api/auth/release-notes`, {
    data: { releaseId: 'v5.0.0' },
  });
  await page.goto(`${ORIGIN}/alpha/`);
  await expect(page.getByRole('complementary')).toBeVisible();
  await expect.poll(() => page.locator('#appSpinner').evaluate(element => element.open)).toBe(false);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Set or update Azure DevOps PAT' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Configuration', exact: true }).click();
  await expect(page.locator('config-modal auth-status')).toContainText('alex@example.test');
  await expect(page.locator('config-modal input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh device list' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('normal-settings-desktop.png') });
  await page.goto(`${ORIGIN}/alpha/admin/`);
  await expect(page.locator('admin-app')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  expect(profile.account.email).toBe('alex@example.test');
  expect(enrollment).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('normal-admin-desktop.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Configuration', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Entra ID', exact: true })).toBeVisible();
  expect((await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json()).account).toBeNull();
});

test('normal admin login supports cancellation and denies an unprivileged identity', async ({ page }) => {
  await page.goto(`${ORIGIN}/beta/admin/`);
  const signIn = page.getByRole('button', { name: 'Sign in with Entra ID', exact: true });
  await expect(signIn).toBeVisible();
  let opened = page.waitForEvent('popup');
  await signIn.click();
  let popup = await opened;
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('auth-status')).toContainText('Sign-in cancelled.');
  expect((await (await page.request.get(`${ORIGIN}/beta/api/auth/me`)).json()).account).toBeNull();
  opened = page.waitForEvent('popup');
  await signIn.click();
  popup = await opened;
  await popup.getByRole('button', { name: 'Sam Sandbox', exact: true }).click();
  await expect(page.getByText('This account has no administration permissions.', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`${ORIGIN}/beta/api/auth/me`)).json()).account.email)
    .toBe('sam@example.test');
  expect((await page.request.get(`${ORIGIN}/beta/admin/check`)).status()).toBe(403);
});

test('real same-account repair preserves drafts and a changed identity resets old work', async ({ page }) => {
  await signIn(page, 'alpha', 'Alex Sandbox');
  await openSettings(page, 'alpha');
  const draft = page.locator('config-modal #autosaveInterval');
  await draft.fill('17');
  await page.evaluate(() => { window.unsavedAuthDraft = 'same-document'; });
  const before = await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
  let opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Reauthenticate', exact: true }).click();
  let popup = await opened;
  await popup.getByRole('button', { name: 'Alex Sandbox', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reauthenticate', exact: true })).toBeEnabled();
  await expect(draft).toHaveValue('17');
  expect(await page.evaluate(() => window.unsavedAuthDraft)).toBe('same-document');
  opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Reauthenticate', exact: true }).click();
  popup = await opened;
  await popup.getByRole('button', { name: 'Sam Sandbox', exact: true }).click();
  await expect.poll(async () => {
    const profile = await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
    return profile.account.uuid;
  }).not.toBe(before.account.uuid);
  await expect(page.locator('config-modal')).toHaveCount(0);
  expect(await page.evaluate(() => window.unsavedAuthDraft)).toBeUndefined();
});

test('real fixture interaction and revocation preserve local UI; expired handoffs report session errors', async ({ page }) => {
  test.setTimeout(120000);
  for (const scenario of ['interaction_required', 'revoked']) {
    await withBrokerScenario('beta', scenario, async () => {
      await signIn(page, 'beta', 'Alex Sandbox');
      await openSettings(page, 'beta');
      await expect(page.locator('config-modal auth-status')).toContainText('Azure DevOps requires reauthentication');
      expect((await page.request.get(`${ORIGIN}/beta/admin/check`)).status()).toBe(200);
      const profile = await (await page.request.get(`${ORIGIN}/beta/api/auth/me`)).json();
      expect(profile.status).toBe('interaction_required');
      expect(profile.account.email).toBe('alex@example.test');
    });
    await page.context().clearCookies();
  }
  await withBrokerScenario('beta', 'expired', async () => {
    await page.goto(`${ORIGIN}/beta/`);
    const opened = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Sign in with Entra ID', exact: true }).click();
    const popup = await opened;
    await popup.getByRole('button', { name: 'Alex Sandbox', exact: true }).click();
    await expect(page.locator('auth-dialog auth-status')).toContainText('Your PlannerTool session has expired.');
    expect((await (await page.request.get(`${ORIGIN}/beta/api/auth/me`)).json()).account).toBeNull();
  });
});

test('an invalid local session cannot read cached data or bypass normal sign-in', async ({ page }) => {
  await signIn(page, 'alpha', 'Alex Sandbox');
  await openSettings(page, 'alpha');
  await page.context().addCookies([{
    name: 'sessionId', value: 'expired-synthetic-session', domain: 'localhost',
    path: '/alpha/', httpOnly: true, sameSite: 'Lax',
  }]);
  expect((await page.request.get(`${ORIGIN}/alpha/api/tasks`)).status()).toBe(401);
  await page.goto(`${ORIGIN}/alpha/`);
  await expect(page.getByRole('button', { name: 'Sign in with Entra ID', exact: true })).toBeVisible();
  expect((await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json()).account).toBeNull();
});

test('outage logout revokes locally and discloses pending service cleanup once', async ({ page }) => {
  test.setTimeout(90000);
  await signIn(page, 'alpha', 'Alex Sandbox');
  await openSettings(page, 'alpha');
  compose('stop', 'auth-sandbox');
  try {
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('auth-dialog auth-status')).toContainText('Authentication service cleanup is pending');
    expect((await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json()).account).toBeNull();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in with Entra ID', exact: true })).toBeVisible();
    await expect(page.locator('auth-dialog auth-status')).not.toContainText('Authentication service cleanup is pending');
  } finally {
    compose('up', '-d', '--force-recreate', '--no-deps', '--wait', 'auth-sandbox');
  }
});

test('real subpath redirects isolate two identities and two registered instances', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const alex = await first.newPage();
    const sam = await second.newPage();
    await signIn(alex, 'alpha', 'Alex Sandbox');
    await signIn(sam, 'beta', 'Sam Sandbox');
    const alpha = await first.request.get(`${ORIGIN}/alpha/api/auth/me`);
    const beta = await second.request.get(`${ORIGIN}/beta/api/auth/me`);
    expect((await alpha.json()).account.email).toBe('alex@example.test');
    expect((await beta.json()).account.email).toBe('sam@example.test');
    expect((await (await first.request.get(`${ORIGIN}/beta/api/auth/me`)).json()).account).toBeNull();
    await alex.screenshot({ path: test.info().outputPath('alpha-desktop.png') });
    await sam.screenshot({ path: test.info().outputPath('beta-desktop.png') });
    await alex.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(alex.getByText('Signed out', { exact: true })).toBeVisible();
    expect((await (await second.request.get(`${ORIGIN}/beta/api/auth/me`)).json()).account.email)
      .toBe('sam@example.test');
  } finally {
    await first.close();
    await second.close();
  }
});

test('cancellation and browser-mismatched completion do not authenticate', async ({ browser }) => {
  const context = await browser.newContext();
  const outsider = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/alpha/api/auth/sandbox`);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Signed out', { exact: true })).toBeVisible();
    const begun = await context.request.post(`${ORIGIN}/alpha/api/auth/login/begin`, {
      headers: { Origin: ORIGIN },
    });
    const transaction = await begun.json();
    const mismatch = await outsider.request.post(`${ORIGIN}/alpha/api/auth/login/complete`, {
      data: { state: transaction.state, code: 'not-a-handoff' },
    });
    expect(mismatch.status()).toBe(401);
    const logout = await context.request.post(`${ORIGIN}/alpha/api/auth/logout`);
    expect(logout.ok()).toBe(true);
    const stale = await context.request.post(`${ORIGIN}/alpha/api/auth/login/complete`, {
      data: { state: transaction.state, code: 'not-a-handoff' },
    });
    expect(stale.status()).toBe(401);
  } finally {
    await context.close();
    await outsider.close();
  }
});

test('enrollment-only instance retains enrollment without broker configuration', async ({ request }) => {
  const response = await request.get(`${ORIGIN}/local/api/auth/config`);
  expect(response.ok()).toBe(true);
  expect((await response.json()).capabilities.enrollment).toBe(true);
  const denied = await request.post(`${ORIGIN}/alpha/api/auth/enroll`, {
    data: { email: 'not-allowed@example.test' },
  });
  expect(denied.status()).toBe(403);
});

test('broker outage preserves admin and encrypted state survives container recreation', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, 'alpha', 'Alex Sandbox');
    const before = await (await context.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
    const begun = await context.request.post(`${ORIGIN}/alpha/api/auth/login/begin`, {
      headers: { Origin: ORIGIN },
    });
    const transaction = await begun.json();
    compose('stop', 'auth-sandbox');
    try {
      const unavailable = await context.request.get(`${ORIGIN}/alpha/api/auth/config`);
      expect(unavailable.status()).toBe(200);
      expect((await unavailable.json()).mode).toBe('entra');
      expect((await (await context.request.get(`${ORIGIN}/alpha/api/auth/me`)).json()).status).toBe('unavailable');
      expect((await context.request.get(`${ORIGIN}/alpha/admin/check`)).status()).toBe(200);
      await page.goto(`${ORIGIN}/alpha/admin/`);
      await expect(page.locator('admin-app')).toBeVisible();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Configuration', exact: true }).click();
      await expect(page.locator('config-modal auth-status')).toContainText('Authentication service unavailable');
    } finally {
      compose('up', '-d', '--force-recreate', '--no-deps', '--wait', 'auth-sandbox');
    }
    compose('up', '-d', '--force-recreate', '--no-deps', '--wait', 'planner-alpha');
    await expect.poll(async () => {
      const profile = await context.request.get(`${ORIGIN}/alpha/api/auth/me`);
      return profile.status();
    }).toBe(200);
    const after = await (await context.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
    expect(after.account.uuid).toBe(before.account.uuid);
    await page.goto(transaction.authorization_url);
    await page.getByRole('button', { name: 'Alex Sandbox', exact: true }).click();
    await expect(page).toHaveURL(`${ORIGIN}/alpha/api/auth/sandbox`);
    await expect(page.getByText('alex@example.test', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('container logs contain no service secrets or callback query access records', async () => {
  const logs = execFileSync('docker', [
    'compose', '--project-name', 'planner-phase-d',
    '--project-directory', 'deployment/phase-d-sandbox', 'logs', '--no-log-prefix',
  ], { encoding: 'utf8' });
  for (const name of ['client-alpha', 'client-beta', 'broker-key', 'entra-secret']) {
    const secret = readFileSync(`deployment/phase-d-sandbox/${name}`, 'utf8').trim();
    expect(logs.includes(secret)).toBe(false);
  }
  expect(/(?:GET|POST) .*auth\/login\/callback\?.*(?:code|state)=/.test(logs)).toBe(false);
});