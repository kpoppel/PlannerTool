import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

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

async function signIn(page, instance, identity, origin = ORIGIN) {
  await page.goto(`${origin}/${instance}/api/auth/sandbox`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sandbox sign-in' })).toBeVisible();
  await page.getByRole('button', { name: identity, exact: true }).click();
  await expect(page).toHaveURL(`${origin}/${instance}/api/auth/sandbox`);
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

test('deployment mode is read-only and delegated wiki events use the acting session', async ({ page }) => {
  await signIn(page, 'alpha', 'Alex Sandbox');
  const settings = await (await page.request.get(`${ORIGIN}/alpha/api/auth/settings`)).json();
  expect(settings.active).toBe('entra');
  expect(settings.deployment_controlled).toBe(true);
  expect(settings.readiness).toBe('sandbox_only');
  expect(settings.live_activation).toBe(false);
  const override = await page.request.post(`${ORIGIN}/alpha/api/auth/settings`, {
    data: { selected: 'enrollment' },
  });
  expect(override.status()).toBe(409);
  expect(await override.json()).toEqual({ error: 'deployment_policy_required' });
  const wiki = await page.request.post(`${ORIGIN}/alpha/api/auth/sandbox/wiki`);
  expect(wiki.status()).toBe(200);
  const profile = await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
  expect(await wiki.json()).toEqual({
    account_id: profile.account.uuid, transport: 'fixture', status: 'completed',
  });
  await page.goto(`${ORIGIN}/alpha/admin/`);
  await page.getByRole('button', { name: 'Data Sources', exact: true }).click();
  await expect(page.locator('admin-data-sources')).toBeVisible();
  const selector = page.locator('admin-data-sources').locator('.backend-select').first();
  await selector.selectOption('ado_live');
  await expect(page.locator('#ado-authentication-mode')).toBeDisabled();
  await expect(page.locator('#ado-authentication-mode')).toHaveValue('entra');
  await expect(page.locator('#ado-authentication-status')).toContainText('Deployment controlled');
  await expect(page.locator('#ado-authentication-status')).toContainText('Live activation blocked');
  await page.screenshot({ path: test.info().outputPath('deployment-policy-desktop.png') });
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
      const operation = await page.request.post(`${ORIGIN}/beta/api/auth/sandbox/operation`);
      expect(operation.status()).toBe(409);
      expect(await operation.json()).toEqual({ error: 'interaction_required' });
    });
    await page.context().clearCookies();
  }
  await withBrokerScenario('beta', 'access_denied', async () => {
    await signIn(page, 'beta', 'Alex Sandbox');
    const operation = await page.request.post(`${ORIGIN}/beta/api/auth/sandbox/operation`);
    expect(operation.status()).toBe(403);
    expect(await operation.json()).toEqual({ error: 'access_denied' });
    expect((await (await page.request.get(`${ORIGIN}/beta/api/auth/me`)).json()).status).toBe('signed_in');
  });
  await page.context().clearCookies();
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

test('expired delegated authority keeps local drafts and repairs only remote access', async ({ page }) => {
  await signIn(page, 'alpha', 'Alex Sandbox');
  const before = await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
  const cookies = await page.context().cookies();
  const session = cookies.find(cookie => cookie.name === 'sessionId' && cookie.path === '/alpha/');
  const sessionHash = createHash('sha256').update(session.value).digest('hex');
  compose('exec', '-T', 'planner-alpha', 'python', '-c', [
    'import os, sys, time',
    'from planner_lib.migrations.coordinator import Database',
    "assert os.environ['PLANNER_AUTH_ISOLATED_SANDBOX'] == '1'",
    "assert os.environ['PLANNER_AUTH_UPSTREAM_MODE'] == 'mock'",
    "database = Database('/app/data').prepare()",
    'storage = database.storage',
    "record = storage.load('auth_sessions', sys.argv[1])",
    "grant = storage.load('auth_grants', record['binding'])",
    "storage.save('auth_grants', record['binding'], {**grant, 'expires_at': time.time() - 1})",
    'storage.close()',
  ].join('\n'), sessionHash);

  const expired = await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
  expect(expired.account.uuid).toBe(before.account.uuid);
  expect(expired.status).toBe('interaction_required');
  expect((await page.request.get(`${ORIGIN}/alpha/admin/check`)).status()).toBe(200);
  expect((await page.request.get(`${ORIGIN}/alpha/api/tasks`)).status()).toBe(200);
  for (const operation of ['operation', 'wiki']) {
    const denied = await page.request.post(`${ORIGIN}/alpha/api/auth/sandbox/${operation}`);
    expect(denied.status()).toBe(409);
    expect(await denied.json()).toEqual({ error: 'interaction_required' });
  }
  await openSettings(page, 'alpha');
  await expect(page.locator('config-modal auth-status')).toContainText('Azure DevOps requires reauthentication');
  const draft = page.locator('config-modal #autosaveInterval');
  await draft.fill('19');
  await page.screenshot({ path: test.info().outputPath('expired-grant-local-draft-desktop.png') });
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Reauthenticate', exact: true }).click();
  const popup = await opened;
  await popup.getByRole('button', { name: 'Alex Sandbox', exact: true }).click();
  await expect(page.locator('config-modal auth-status')).toContainText('Connected');
  await expect(draft).toHaveValue('19');
  const after = await (await page.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
  expect(after.account.uuid).toBe(before.account.uuid);
  for (const operation of ['operation', 'wiki']) {
    expect((await page.request.post(`${ORIGIN}/alpha/api/auth/sandbox/${operation}`)).status()).toBe(200);
  }
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
  const sameAccount = await browser.newContext();
  try {
    const alex = await first.newPage();
    const sam = await second.newPage();
    await signIn(alex, 'alpha', 'Alex Sandbox');
    await signIn(sam, 'beta', 'Sam Sandbox');
    await signIn(await sameAccount.newPage(), 'alpha', 'Alex Sandbox');
    const alpha = await first.request.get(`${ORIGIN}/alpha/api/auth/me`);
    const beta = await second.request.get(`${ORIGIN}/beta/api/auth/me`);
    expect((await alpha.json()).account.email).toBe('alex@example.test');
    expect((await beta.json()).account.email).toBe('sam@example.test');
    const alphaOperation = await first.request.post(`${ORIGIN}/alpha/api/auth/sandbox/operation`);
    const betaOperation = await second.request.post(`${ORIGIN}/beta/api/auth/sandbox/operation`);
    expect(alphaOperation.status()).toBe(200);
    expect(betaOperation.status()).toBe(200);
    const alphaResult = await alphaOperation.json();
    const betaResult = await betaOperation.json();
    expect(alphaResult.transport).toBe('fixture');
    expect(betaResult.transport).toBe('fixture');
    expect(alphaResult.account_id).not.toBe(betaResult.account_id);
    expect(Object.keys(alphaResult).sort()).toEqual(['account_id', 'status', 'transport']);
    expect((await (await first.request.get(`${ORIGIN}/beta/api/auth/me`)).json()).account).toBeNull();
    await alex.screenshot({ path: test.info().outputPath('alpha-desktop.png') });
    await sam.screenshot({ path: test.info().outputPath('beta-desktop.png') });
    await alex.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(alex.getByText('Signed out', { exact: true })).toBeVisible();
    expect((await sameAccount.request.post(`${ORIGIN}/alpha/api/auth/sandbox/operation`)).status()).toBe(200);
    expect((await (await second.request.get(`${ORIGIN}/beta/api/auth/me`)).json()).account.email)
      .toBe('sam@example.test');
  } finally {
    await first.close();
    await second.close();
    await sameAccount.close();
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
    const tasksBefore = await context.request.get(`${ORIGIN}/alpha/api/tasks`);
    expect(tasksBefore.status()).toBe(200);
    const cachedTasks = await tasksBefore.json();
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
      const tasksDuring = await context.request.get(`${ORIGIN}/alpha/api/tasks`);
      expect(tasksDuring.status()).toBe(200);
      expect(await tasksDuring.json()).toEqual(cachedTasks);
      const views = await context.request.get(`${ORIGIN}/alpha/api/view`);
      expect(views.status()).toBe(200);
      const remote = await context.request.post(`${ORIGIN}/alpha/api/auth/sandbox/operation`);
      expect(remote.status()).toBe(503);
      expect(await remote.json()).toEqual({ error: 'auth_unavailable' });
      const outageProfile = await (await context.request.get(`${ORIGIN}/alpha/api/auth/me`)).json();
      expect(outageProfile.account.uuid).toBe(before.account.uuid);
      await page.goto(`${ORIGIN}/alpha/`);
      await expect(page.getByRole('complementary')).toBeVisible();
      await expect.poll(() => page.locator('#appSpinner').evaluate(element => element.open)).toBe(false);
      await page.screenshot({ path: test.info().outputPath('cached-work-during-outage-desktop.png') });
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

test('disposable fleet activates only after browser admin proof and offline deployment commit', async ({ browser }) => {
  test.setTimeout(240000);
  const transitionId = randomUUID();
  const projectName = `planner-f-${transitionId.slice(0, 8)}`;
  const root = resolve(`.test-runs/${projectName}`);
  const output = `${root}/generated`;
  const origin = 'http://localhost:18881';
  const python = (...argumentsList) => execFileSync(resolve('.venv/bin/python'), argumentsList, {
    stdio: 'pipe', timeout: 60000,
  });
  const generatedCompose = (...argumentsList) => execFileSync('docker', [
    'compose', '--project-name', projectName, '--project-directory', output,
    '--env-file', `${output}/.env`, ...argumentsList,
  ], { stdio: 'pipe', timeout: 90000 });
  const generate = () => python('scripts/deploy.py', '--config', `${root}/manifest.yml`,
    '--output-dir', output, '--apply');
  python('scripts/auth_sandbox.py', '--directory', root, '--port', '18881',
    '--ado-authentication', 'pat');
  generate();
  copyFileSync(`${root}/.env`, `${output}/.env`);
  const contexts = [];
  try {
    generatedCompose('up', '-d', '--wait');
    const accounts = {};
    for (const name of ['alpha', 'beta']) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      const enrolled = await context.request.post(`${origin}/${name}/api/auth/enroll`, {
        data: { email: 'alex@example.test', name: 'Alex Sandbox' },
      });
      expect(enrolled.status()).toBe(200);
      const users = await (await context.request.get(`${origin}/${name}/admin/v1/users`)).json();
      accounts[name] = users.currentId;
      const begun = await context.request.post(`${origin}/${name}/api/auth/links/begin`, {
        data: { account_id: accounts[name] }, headers: { Origin: origin },
      });
      expect(begun.status()).toBe(200);
      await page.goto((await begun.json()).authorization_url);
      await page.getByRole('button', { name: 'Alex Sandbox', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/${name}/admin/`);
      const staged = await (await context.request.get(`${origin}/${name}/api/auth/settings`)).json();
      expect(staged.active).toBe('enrollment');
      expect(staged.readiness).toBe('sandbox_only');
    }
    generatedCompose('stop', 'planner-alpha', 'planner-beta');
    const fleet = { version: 1, instances: {} };
    for (const name of ['alpha', 'beta']) {
      fleet.instances[name] = {
        data_dir: name === 'alpha' ? '/app/data' : '/fleet/beta',
        broker: { instance: name, url: 'http://auth-sandbox:8000/auth/',
          public_url: `${origin}/auth/`, environment: 'sandbox', generation: 'sandbox-1',
          upstream_mode: 'mock', isolated_sandbox: true,
          secret_file: name === 'alpha' ? '/run/secrets/auth-client' : '/run/secrets/client-beta' },
      };
    }
    writeFileSync(`${root}/fleet.json`, JSON.stringify(fleet), { mode: 0o600 });
    const maintenance = (...argumentsList) => generatedCompose('run', '--rm', '--no-deps', '-T',
      '--volume', `${projectName}_data-beta:/fleet/beta`,
      '--volume', `${root}/fleet.json:/app/fleet.json:ro`,
      '--volume', `${root}/client-beta:/run/secrets/client-beta:ro`,
      'planner-alpha', 'python', 'planner.py', 'authentication-transition', ...argumentsList,
      '--fleet', '/app/fleet.json', '--id', transitionId);
    maintenance('commit', '--confirm-purge-sandbox-authority');
    const status = maintenance('status').toString();
    expect(status.match(/"state": "released"/g)).toHaveLength(2);
    python('-c', 'from pathlib import Path; import sys,yaml; path=Path(sys.argv[1]); '
      + 'config=yaml.safe_load(path.read_text()); config["ado_authentication"]="entra"; '
      + '[instance.update(authentication_provider="entra") for instance in config["instances"] '
      + 'if instance["backend"]=="ado"]; path.write_text(yaml.safe_dump(config,sort_keys=False))',
    `${root}/manifest.yml`);
    generate();
    generatedCompose('up', '-d', '--force-recreate', '--no-deps', '--wait', 'planner-alpha', 'planner-beta');
    for (const [index, name] of ['alpha', 'beta'].entries()) {
      const context = contexts[index];
      await expect.poll(async () => (await context.request.get(`${origin}/${name}/api/auth/me`)).status(), {
        timeout: 15000,
      }).toBe(200);
      expect((await (await context.request.get(`${origin}/${name}/api/auth/me`)).json()).account).toBeNull();
      const page = context.pages()[0];
      await signIn(page, name, 'Alex Sandbox', origin);
      const profile = await (await context.request.get(`${origin}/${name}/api/auth/me`)).json();
      expect(profile.account.uuid).toBe(accounts[name]);
      expect((await context.request.get(`${origin}/${name}/admin/check`)).status()).toBe(200);
      const settings = await (await context.request.get(`${origin}/${name}/api/auth/settings`)).json();
      expect(settings.epoch).toBe(2);
      expect(settings.transition).toBe('released');
      for (const operation of ['operation', 'wiki']) {
        expect((await context.request.post(`${origin}/${name}/api/auth/sandbox/${operation}`)).status()).toBe(200);
      }
      expect((await context.request.post(`${origin}/${name}/api/auth/logout`)).status()).toBe(200);
      await page.screenshot({ path: test.info().outputPath(`${name}-fleet-transition-desktop.png`) });
    }
    expect((await (await contexts[0].request.get(`${origin}/local/api/auth/config`)).json()).capabilities.enrollment).toBe(true);
  } finally {
    for (const context of contexts) await context.close();
    generatedCompose('down', '--volumes');
  }
});