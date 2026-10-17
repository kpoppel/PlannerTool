import { test, expect } from '@playwright/test';

test('unread release is first, stays open on Escape and is acknowledged across browsers', async ({ page, browser }) => {
  const enrollment = await page.request.post('/api/auth/enroll', { data: {
    email: 'release-reader@example.test', name: 'Release Reader',
  } });
  expect(enrollment.ok()).toBe(true);
  const accountKey = (await enrollment.json()).accountKey;
  await page.goto('/');
  const reader = page.locator('release-notes');
  await expect(reader.getByRole('dialog')).toBeVisible();
  await expect(page.locator('app-sidebar aside.sidebar')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(reader.getByRole('dialog')).toBeVisible();
  await expect(reader.frameLocator('iframe').getByRole('heading', {
    name: 'PlannerTool v5.0.0', exact: true,
  })).toBeVisible();
  await reader.getByRole('button', { name: 'Continue to Planner' }).click();
  await expect(reader).toHaveCount(0);
  const otherBrowser = await browser.newContext();
  try {
    const response = await otherBrowser.request.post(new URL('/api/auth/enroll', page.url()).href, {
      data: { email: 'release-reader@example.test', accountKey },
    });
    expect(response.ok()).toBe(true);
    const status = await otherBrowser.request.get(new URL('/api/auth/release-notes', page.url()).href);
    expect((await status.json()).acknowledged).toBe(true);
    const secondPage = await otherBrowser.newPage();
    await secondPage.goto(page.url());
    await expect(secondPage.getByRole('navigation', { name: 'Top menu' })).toBeVisible();
    await expect(secondPage.locator('app-sidebar aside.sidebar')).toBeVisible();
    await expect(secondPage.locator('release-notes')).toHaveCount(0);
  } finally {
    await otherBrowser.close();
  }
});

test('capture release illustrations from isolated application components', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const teamsResponse = await page.request.get('/api/teams');
  expect(teamsResponse.ok()).toBe(true);
  const teams = await teamsResponse.json();
  const team = teams.find((entry) => entry.kind === 'team');
  expect(team).toBeDefined();
  const titles = ['Connected delivery', 'Customer onboarding', 'Release automation',
    'Operational readiness', 'Platform integration', 'Acceptance testing'];
  await page.route('**/api/tasks', async (route) => {
    const response = await route.fetch();
    const tasks = await response.json();
    await route.fulfill({ json: tasks.map((task, index) => ({ ...task,
      title: titles[index % titles.length], start: '2026-09-01', end: '2026-12-18',
      capacity: [{ team: team.id, capacity: 20 + (index % 3) * 10 }],
    })) });
  });
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('az_planner:onboarding_seen', '1');
    localStorage.setItem('az_planner:tour_seen', '1');
  });
  await page.reload();
  await expect(page.locator('app-sidebar aside.sidebar')).toBeVisible();
  await expect(page.locator('feature-card-lit').first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: testInfo.outputPath('planning-board.png') });
  await page.locator('feature-card-lit').first().click();
  await expect(page.locator('details-panel .panel:not(.closed)')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Configuration', exact: true }).click();
  await page.locator('config-modal #allocationUnit').selectOption('man-days');
  await page.locator('config-modal #saveConfigBtn').click();
  await expect(page.locator('config-modal #configStatus')).toContainText('Configuration saved');
  await page.locator('config-modal #closeConfigBtn').click();
  await page.screenshot({ path: testInfo.outputPath('allocation-editor.png') });

  await page.goto('/admin/#workforce');
  await expect(page.getByRole('heading', { name: 'Workforce', exact: true })).toBeVisible();
  await page.locator('admin-workforce [aria-expanded="false"]').first().click();
  await expect(page.getByRole('table', { name: 'TeamA staffing', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('workforce.png') });
  await page.route('**/api/azure/projects*', (route) => route.fulfill({ json: {
    projects: ['TestProject'],
  } }));
  await page.route('**/api/azure/area-paths*', (route) => route.fulfill({ json: {
    area_paths: ['TestProject', 'TestProject\\Product', 'TestProject\\Platform'],
  } }));
  await page.goto('/admin/#projects');
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  await expect(page.locator('plan-drawer').getByRole('dialog')).toBeVisible();
  await page.locator('plan-drawer').getByLabel('Azure DevOps project', { exact: true }).selectOption('TestProject');
  await expect(page.locator('plan-area-path-picker').getByRole('button', { name: 'Platform', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('plans-setup.png') });

  await page.goto('/static/docs/account-access/index.html');
  await page.evaluate(async () => {
    const { showAuthDialog } = await import('/static/js/components/AuthDialog.lit.js');
    showAuthDialog('/api');
    const dialog = document.querySelector('auth-dialog');
    dialog.requiresPat = true;
    await dialog.updateComplete;
  });
  await page.locator('auth-dialog section').screenshot({ path: testInfo.outputPath('enrollment.png') });
});

test('release and enrollment guides are public and all illustrations load', async ({ browser, baseURL }, testInfo) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await anonymous.newPage();
    for (const width of [1366, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/static/docs/releases/v5.0.0/index.html', '/static/docs/account-access/index.html']) {
        const response = await page.goto(`${baseURL}${path}`);
        expect(response.status()).toBe(200);
        await expect(page.locator('h1')).toBeVisible();
        await expect.poll(() => page.locator('img').evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const name = path.includes('/releases/') ? 'release-page' : 'enrollment-guide';
        await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) });
      }
    }
    await page.goto(`${baseURL}/`);
    const help = page.locator('auth-dialog').getByRole('link', { name: 'Enrollment help' });
    await expect(help).toBeVisible();
    const popupPromise = page.waitForEvent('popup');
    await help.click();
    const popup = await popupPromise;
    await expect(popup.getByRole('heading', { name: 'Enrollment & Account Access', exact: true })).toBeVisible();
  } finally {
    await anonymous.close();
  }
});