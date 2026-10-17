import { test, expect } from '@playwright/test';

test('Global display settings reorder processes and tiers with explicit saving', async ({ page }, testInfo) => {
  const states = [{ name: 'New', category: 'Proposed', order: 1 },
    { name: 'Done', category: 'Completed', order: 2 },
    { name: 'Removed', category: 'Removed', order: 3 }];
  const catalogue = { schema_version: 1, processes: [
    { id: 'first', name: 'First process', types: ['Epic', 'Feature', 'Story', 'Bug'].map((name) =>
      ({ name, imported: true, states })) },
    { id: 'second', name: 'Second process', types: [{ name: 'Feature', imported: true,
      states: [{ name: 'Working', category: 'InProgress', order: 1 }] }] },
  ] };
  let settings = { schema_version: 2, process_order: ['first', 'second'],
    type_tiers: { first: [['Epic'], ['Feature'], ['Story', 'Bug']], second: [['Feature']] } };
  const errors = [];
  const saves = [];
  let rejectSave = true;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.fulfill({ json: {
    email: 'delegate@example.test', permissions: ['manage_projects'],
  } }));
  await page.route('**/admin/check', (route) => route.fulfill({ json: {
    ok: true, permissions: ['manage_projects'],
  } }));
  await page.route('**/admin/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/ado-processes')) return route.fulfill({ json: { content: catalogue } });
    if (path.endsWith('/global-settings')) {
      if (request.method() === 'POST') {
        saves.push(request.postDataJSON().content);
        if (rejectSave) return route.fulfill({ status: 400,
          json: { detail: { error: 'display_validation', message: 'Save denied' } } });
        settings = request.postDataJSON().content;
      }
      return route.fulfill({ json: { content: settings } });
    }
    return route.fulfill({ json: { content: {
      server_name: 'Fixture', feature_flags: { manage_backup_snapshots: false },
    } } });
  });
  await page.goto('/admin/#global-project-settings');
  const editor = page.locator('admin-global-settings');
  await expect(editor.locator('.process-title')).toHaveText(['First process', 'Second process']);
  await expect(editor.locator('.state-column h4')).toHaveText(['Epic, Feature, Story, Bug', 'Feature']);
  await expect(editor.locator('[data-category="Removed"]')).toHaveCount(0);
  await editor.getByTitle('Move First process down', { exact: true }).click();
  await expect(editor.locator('.process-title')).toHaveText(['Second process', 'First process']);
  await editor.getByTitle('Move Story up a tier', { exact: true }).click();
  await expect(editor.locator('[data-process-id="first"] .tier').nth(1)).toContainText('Feature');
  await expect(editor.locator('[data-process-id="first"] .tier').nth(1)).toContainText('Story');
  expect(saves).toEqual([]);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('HTTP 400');
  await expect(editor.locator('.process-title')).toHaveText(['Second process', 'First process']);
  rejectSave = false;
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Saved.');
  expect(saves[1]).toEqual({ schema_version: 2, process_order: ['second', 'first'],
    type_tiers: { first: [['Epic'], ['Feature', 'Story'], ['Bug']], second: [['Feature']] } });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('global-display-desktop.png') });
});

test('Empty process catalogue points to plan setup without a bulk refresh', async ({ page }, testInfo) => {
  const refreshes = [];
  await page.route('**/api/**', route => route.fulfill({ json: { projects: [] } }));
  await page.route('**/admin/check', route => route.fulfill({ json: {
    ok: true, permissions: ['manage_projects'],
  } }));
  await page.route('**/admin/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/ado-processes/refresh')) refreshes.push(path);
    const content = path.endsWith('/ado-processes')
      ? { schema_version: 1, processes: [] } : { project_map: [] };
    return route.fulfill({ json: { content } });
  });
  await page.goto('/admin/#ado-processes');
  await expect(page.getByRole('link', { name: 'Add a plan', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a plan', exact: true }))
    .toHaveAttribute('href', 'http://127.0.0.1:5175/admin/#projects');
  await expect(page.getByRole('button', { name: 'Reload from Azure DevOps' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save import selections' })).toBeDisabled();
  expect(refreshes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('catalogue-empty-desktop.png') });
});

test('Delegated process catalogue imports types and keeps validation errors visible', async ({ page }) => {
  const type = (name, imported, level = 'portfolio', missing = false) => ({
    reference_name: name, name, imported, missing, backlog_level: level, backlog: name,
    states: [{ name: 'New', category: 'Proposed', order: 1 },
      { name: 'Active', category: 'InProgress', order: 2 },
      { name: 'Closed', category: 'Completed', order: 3 }],
  });
  let catalogue = { schema_version: 1, processes: [{
    id: 'process-agile', name: 'Planner Agile', parent_name: 'Agile',
    projects: ['Platform'], loaded_at: '2026-10-17T10:00:00Z',
    types: [type('Epic', true), type('Feature', true), type('Task', false, 'task'),
      type('Retired Portfolio', true, 'portfolio', true)],
  }] };
  const plans = { project_map: [{ name: 'Platform roadmap', area_path: 'Platform\\Team',
    task_types: ['feature'] }] };
  const errors = [];
  const saves = [];
  let rejectSave = true;
  let reloads = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ json: {
    email: 'delegate@example.test', permissions: ['manage_projects'],
  } }));
  await page.route('**/admin/check', route => route.fulfill({ json: {
    ok: true, permissions: ['manage_projects'],
  } }));
  await page.route('**/admin/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/projects')) {
      return route.fulfill({ json: { content: plans } });
    }
    if (path.endsWith('/ado-processes/refresh')) {
      reloads += 1;
      return route.fulfill({ json: { ok: true, content: catalogue } });
    }
    if (path.endsWith('/ado-processes')) {
      if (request.method() === 'POST') {
        const payload = request.postDataJSON();
        saves.push(payload);
        if (rejectSave) {
          return route.fulfill({ status: 400, json: { detail: {
            error: 'type_in_use', message: 'Import selection is required by plans: Platform roadmap',
          } } });
        }
        catalogue = payload.content;
        return route.fulfill({ json: { ok: true, content: catalogue } });
      }
      return route.fulfill({ json: { content: catalogue } });
    }
    return route.fulfill({ json: { content: {
      server_name: 'Fixture', feature_flags: { manage_backup_snapshots: false },
    } } });
  });
  await page.goto('/admin/#ado-processes');
  await expect(page.getByRole('heading', { name: 'Azure DevOps Processes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Data Sources', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Global Project Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Import Task from Planner Agile' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Import Feature from Planner Agile' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Import Feature from Planner Agile' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Import Epic from Planner Agile' })).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Import Epic from Planner Agile' }).uncheck();
  await page.getByRole('checkbox', { name: 'Import Retired Portfolio from Planner Agile' }).uncheck();
  await page.getByRole('button', { name: 'Save import selections' }).click();
  await expect(page.getByRole('status')).toContainText('Platform roadmap');
  await expect(page.getByRole('checkbox', { name: 'Import Feature from Planner Agile' })).toBeChecked();
  rejectSave = false;
  await page.getByRole('button', { name: 'Save import selections' }).click();
  await expect(page.getByRole('status')).toHaveText('Import selections saved');
  expect(saves).toHaveLength(2);
  expect(saves[1].content.processes[0].types[0].imported).toBe(false);
  expect(saves[1].content.processes[0].types[1].imported).toBe(true);
  await page.getByRole('button', { name: 'Reload from Azure DevOps' }).click();
  await expect(page.getByRole('status')).toHaveText('Process definitions reloaded');
  expect(reloads).toBe(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ado-processes-desktop.png', fullPage: true });
});

test('Utilities transfers workforce through a fresh explicit import review', async ({ page }, testInfo) => {
  const current = { id: 'team-one', allocation_token: 'ONE', name: 'Engineering',
    short_name: 'ENG', archived: false, group_id: null };
  const incoming = { ...current, name: 'Engineering imported' };
  const added = { ...current, id: 'team-two', allocation_token: 'TWO', name: 'New team' };
  const document = { format: 'plannertool-workforce', version: 1,
    teams: { schema_version: 3, teams: [incoming, added], groups: [] },
    workforce: { schema_version: 2, suppliers: [], staffing: [] } };
  const source = JSON.stringify(document, null, 2);
  const previews = [];
  const commits = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/admin/', route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><html><head><title>Utilities fixture</title>
      <style>body { margin: 32px; font: 14px 'Segoe UI', sans-serif; background: #fff; }
      main { max-width: 1160px; margin: 0 auto; }</style></head><body>
      <main><admin-utilities></admin-utilities></main>
      <script type="module" src="/admin/js/components/admin/Utilities.lit.js"></script>
      </body></html>`,
  }));
  await page.route('**/admin/v1/workforce/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/export')) {
      await route.fulfill({ json: { content: { filename: 'planner-workforce.yaml', source } } });
      return;
    }
    const payload = route.request().postDataJSON();
    if (path.endsWith('/import/preview')) {
      previews.push(payload);
      const ready = Object.hasOwn(payload.decisions, 'team-one');
      await route.fulfill({ json: { content: {
        revision: 'destination-revision', review_revision: `review-${previews.length}`, ready,
        records: [
          { id: current.id, kind: 'team', name: incoming.name, current, incoming,
            status: 'conflict', structural: false,
            decision: ready ? payload.decisions['team-one'] : null },
          { id: added.id, kind: 'team', name: added.name, current: null, incoming: added,
            status: 'new', structural: false, decision: null },
        ],
        errors: ready ? [] : ['Choose a skip or overwrite decision for every conflicting record'],
        coverage: { historically_complete: false, retained_tasks: 4, scenarios: 1, views: 2 },
      } } });
      return;
    }
    expect(path).toBe('/admin/v1/workforce/import');
    commits.push(payload);
    await route.fulfill({ json: { ok: true, content: { revision: 'imported' } } });
  });
  await page.route('**/admin/v1/restore/validate', async route => {
    const backup = route.request().postDataJSON();
    if (backup.schema_revision !== 38) {
      await route.fulfill({ status: 400, json: {
        error: 'restore_rejected', message: 'Incompatible backup schema; server requires revision 38',
      } });
    } else {
      await route.fulfill({ json: { ok: true, schema_revision: 38 } });
    }
  });
  await page.goto('/admin/');
  const system = page.getByRole('region', { name: 'System', exact: true });
  const workforce = page.getByRole('region', { name: 'Workforce', exact: true });
  await expect(system.getByRole('button', { name: 'Backup', exact: true })).toBeVisible();
  await expect(workforce.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('backup-restore-rows-desktop.png'), fullPage: true });
  let chooserPromise = page.waitForEvent('filechooser');
  await system.getByRole('button', { name: 'Restore', exact: true }).click();
  await (await chooserPromise).setFiles({ name: 'future-system.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema_revision: 99, config: {} })) });
  await expect(system.locator('.status')).toContainText('Incompatible backup schema');
  await expect(system.getByRole('button', { name: 'Restore Selected', exact: true })).toHaveCount(0);
  chooserPromise = page.waitForEvent('filechooser');
  await system.getByRole('button', { name: 'Restore', exact: true }).click();
  await (await chooserPromise).setFiles({ name: 'system.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema_revision: 38, config: {} })) });
  await expect(system.locator('.status')).toContainText('Backup compatible with server schema 38');
  await expect(system.getByRole('button', { name: 'Restore Selected', exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await workforce.getByRole('button', { name: 'Backup', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('planner-workforce.yaml');
  const file = { name: 'workforce.yaml', mimeType: 'application/yaml', buffer: Buffer.from(source) };
  chooserPromise = page.waitForEvent('filechooser');
  await workforce.getByRole('button', { name: 'Restore', exact: true }).click();
  await (await chooserPromise).setFiles(file);
  const importButton = page.getByRole('button', { name: 'Import Workforce', exact: true });
  await expect(importButton).toBeDisabled();
  const decision = page.getByRole('combobox', { name: 'Decision for Engineering imported (team-one)' });
  await expect(decision).toHaveValue('');
  await decision.selectOption('overwrite');
  await page.getByRole('combobox', { name: 'Decision for New team (team-two)' }).selectOption('skip');
  await expect(importButton).toBeDisabled();
  await page.getByRole('button', { name: 'Review Choices', exact: true }).click();
  await expect(importButton).toBeEnabled();
  await expect(decision).toHaveValue('overwrite');
  await page.getByText('Incoming values', { exact: true }).first().click();
  await expect(page.getByRole('table', { name: 'Workforce import records' })).toContainText('Engineering imported');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('workforce-transfer-preview-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(importButton).toHaveCount(0);
  expect(commits).toHaveLength(0);
  chooserPromise = page.waitForEvent('filechooser');
  await workforce.getByRole('button', { name: 'Restore', exact: true }).click();
  await (await chooserPromise).setFiles(file);
  await expect(decision).toHaveValue('');
  await decision.selectOption('overwrite');
  await page.getByRole('button', { name: 'Review Choices', exact: true }).click();
  await expect(importButton).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss());
  await importButton.click();
  expect(commits).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await importButton.click();
  await expect(page.getByRole('status')).toHaveText('Workforce imported successfully.');
  expect(commits).toEqual([{ source, decisions: { 'team-one': 'overwrite' },
    revision: 'destination-revision', review_revision: `review-${previews.length}` }]);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workforce-transfer-success-desktop.png'), fullPage: true });
});

test('Admin entrypoint mounts canonical Workforce without legacy requests', async ({ page }, testInfo) => {
  const snapshot = {
    revision: 'fixture-revision',
    teams: { schema_version: 3, teams: [{ id: 'team-engineering', allocation_token: 'ENG',
      name: 'Engineering', short_name: 'ENG', archived: false, group_id: null }], groups: [] },
    workforce: { schema_version: 2, suppliers: [], staffing: [] },
  };
  const legacyRequests = [];
  page.on('request', (request) => {
    if (/\/admin\/v1\/(people|teams|cost)(\/|$)/.test(new URL(request.url()).pathname)) {
      legacyRequests.push(request.url());
    }
  });
  await page.route('**/api/**', (route) => route.fulfill({ json: {
    email: 'workforce-fixture@example.test',
  } }));
  await page.route('**/admin/check', (route) => route.fulfill({ json: {
    ok: true, permissions: ['admin'],
  } }));
  await page.route('**/admin/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/workforce')) {
      await route.fulfill({ json: { content: snapshot } });
    } else if (path.endsWith('/system')) {
      await route.fulfill({ json: { content: {
        server_name: 'Fixture', feature_flags: { manage_backup_snapshots: false },
      } } });
    } else {
      await route.fulfill({ json: { type: 'object', properties: {} } });
    }
  });
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Workforce', exact: true }).click();
  const engineering = page.locator('[data-team="team-engineering"]');
  await expect(engineering).toBeVisible();
  await expect(page.getByRole('button', { name: 'People', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cost', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Teams', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Suppliers & Profiles', exact: true })).toBeVisible();
  await expect(engineering).toContainText('ENG');
  expect(legacyRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workforce-live-entrypoint-desktop.png') });
});

test('Denied administration startup redirects without mounting configuration controls', async ({ page }) => {
  const configRequests = [];
  await page.route('**/api/**', route => route.fulfill({ json: { email: 'member@example.com' } }));
  await page.route('**/admin/check', route => route.fulfill({ status: 403, json: { detail: 'Forbidden' } }));
  await page.route('**/admin/v1/**', route => {
    configRequests.push(route.request().url());
    return route.fulfill({ status: 403, json: { detail: 'Forbidden' } });
  });
  await page.route('**/admin/login', route => route.fulfill({
    contentType: 'text/html', body: '<h1>Administration sign-in</h1>',
  }));
  await page.goto('/admin/');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.locator('admin-app')).toHaveCount(0);
  expect(configRequests).toEqual([]);
});

for (const [permission, sections] of [
  ['manage_projects', ['Plans', 'Azure DevOps Processes', 'Global Project Settings']],
  ['manage_iterations', ['Iterations']],
  ['manage_workforce_teams', ['Workforce']],
  ['manage_workforce_costs', ['Workforce']],
]) {
  test(`Delegated ${permission} opens only its permitted administration sections`, async ({ page }, testInfo) => {
    const requests = [];
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const snapshot = {
      revision: 'delegated',
      teams: { schema_version: 3, teams: [{ id: 'team-one', allocation_token: 'ONE',
        name: 'Engineering', short_name: 'ENG', archived: false, group_id: null }], groups: [] },
      workforce: { schema_version: 2, staffing: [], suppliers: [{ id: 'supplier-one',
        name: 'Internal provider', external: false, archived: false, profiles: [{
          id: 'standard', name: 'Standard', monthly_project_hours: 160, hourly_rate: 50,
          archived: false,
        }] }] },
    };
    await page.route('**/api/**', route => route.fulfill({ json: { projects: [] } }));
    await page.route('**/admin/check', route => route.fulfill({ json: {
      ok: true, permissions: [permission],
    } }));
    await page.route('**/admin/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      const content = {
        '/admin/v1/projects': { content: { schema_version: 4, container_types: ['project'],
          project_map: [], allocation_defaults: { project: [] } } },
        '/admin/v1/iterations': { content: { iteration_sets: [] } },
        '/admin/v1/ado-processes': { content: { schema_version: 1, processes: [] } },
        '/admin/v1/browse-config': { content: { organization_url: 'ExampleOrg' } },
        '/admin/v1/schema/projects': { type: 'object', properties: {} },
        '/admin/v1/workforce': { content: snapshot },
      };
      if (!Object.hasOwn(content, path)) {
        return route.fulfill({ status: 403, json: { detail: 'Forbidden' } });
      }
      return route.fulfill({ json: content[path] });
    });
    await page.goto('/admin/');
    await expect(page.locator('admin-app .admin-sidebar .chip')).toHaveText(sections);
    await expect(page.locator('admin-app main h2')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open planner', exact: true })).toHaveAttribute('href', '/');
    await expect(page.locator('admin-app .admin-sidebar')).toHaveJSProperty('offsetTop', 40);
    if (permission === 'manage_workforce_teams') {
      await expect(page.locator('[data-edit-team="team-one"]')).toBeEnabled();
      await page.getByRole('tab', { name: 'Suppliers & Profiles' }).click();
      await expect(page.locator('[data-edit-supplier="supplier-one"]')).toBeDisabled();
    } else if (permission === 'manage_workforce_costs') {
      await expect(page.locator('[data-edit-supplier="supplier-one"]')).toBeEnabled();
      await page.getByRole('tab', { name: 'Teams & Composition' }).click();
      await expect(page.locator('[data-edit-team="team-one"]')).toBeDisabled();
    }
    expect(requests).not.toContain('/admin/v1/system');
    expect(requests).not.toContain('/admin/v1/ado');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${permission}-desktop.png`) });
  });
}

test('Shared header switches applications and opens Configuration under a proxy prefix', async ({ page }, testInfo) => {
  let permissions = ['admin'];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/tenant/api/**', route => route.fulfill({ json: {
    email: 'header@example.test', permissions,
  } }));
  await page.route('**/tenant/admin/check', route => route.fulfill({ json: { ok: true, permissions } }));
  await page.route('**/tenant/admin/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/schema/projects')) {
      return route.fulfill({ json: { type: 'object', properties: {} } });
    }
    const content = {
      '/tenant/admin/v1/projects': { schema_version: 4, container_types: ['project'],
        project_map: [], allocation_defaults: { project: [] } },
      '/tenant/admin/v1/iterations': { iteration_sets: [] },
      '/tenant/admin/v1/ado-processes': { schema_version: 1, processes: [] },
      '/tenant/admin/v1/browse-config': { organization_url: 'ExampleOrg' },
      '/tenant/admin/v1/workforce': { revision: 'header',
        teams: { schema_version: 3, teams: [], groups: [] },
        workforce: { schema_version: 2, suppliers: [], staffing: [] } },
      '/tenant/admin/v1/system': { feature_flags: {} },
    };
    return route.fulfill({ json: { content: content[path] } });
  });
  await page.route('**/tenant/', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html><head><style>
      body { margin: 0; font: 14px 'Segoe UI', sans-serif; --color-sidebar-bg: #23344d; }
    </style></head><body><top-menu-bar></top-menu-bar>
      <script>window.APP_BASE_URL = '/tenant';</script><script type="module">
        import '/js/components/TopMenu.lit.js';
        const menu = document.querySelector('top-menu-bar');
        menu.baseUrl = '/tenant';
        await menu.loadPermissions();
      </script></body></html>`,
  }));
  await page.route('**/tenant/admin/', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html><head><style>body { margin: 0; }</style></head><body>
      <div id="admin-root"></div><script>window.APP_BASE_URL = '/tenant';</script>
      <script type="module" src="/admin/js/admin.js"></script></body></html>`,
  }));
  await page.goto('/tenant/');
  await expect(page.getByRole('link', { name: 'Open administration', exact: true })).toHaveCount(0);
  await expect(page.locator('top-menu-bar .settings-chevron')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Configuration', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Server', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Configuration', exact: true }).click();
  await expect(page.locator('config-modal #configPat')).toBeVisible();
  await expect(page.locator('config-modal #configPat')).toBeFocused();
  await page.locator('config-modal #closeConfigBtn').click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('gear-administration-menu-desktop.png') });
  await page.getByRole('menuitem', { name: 'Plans', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/admin\/#projects$/);
  await expect(page.getByRole('navigation', { name: 'Top menu' })).toBeVisible();
  await expect(page.locator('admin-app .admin-content')).toHaveJSProperty('offsetTop', 40);
  await expect(page.locator('admin-app .chip.active')).toHaveText('Plans');
  await expect(page.locator('admin-projects')).toBeAttached();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Iterations', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/admin\/#iterations$/);
  await expect(page.locator('admin-app .chip.active')).toHaveText('Iterations');
  await expect(page.getByRole('menu', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('shared-admin-header-desktop.png') });
  await page.getByRole('link', { name: 'Open planner', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/$/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Plans', exact: true })).toBeVisible();
  permissions = [];
  await page.evaluate(() => document.querySelector('top-menu-bar').loadPermissions());
  await expect(page.getByRole('group', { name: 'Administration', exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('Administrator grants independent permissions from User Management', async ({ page }, testInfo) => {
  const accounts = [{ id: 'admin-id', email: 'admin@example.com', permissions: ['admin'] },
    { id: 'delegate-id', email: 'delegate@example.com', permissions: ['manage_projects'] }];
  const writes = [];
  await page.route('**/api/**', route => route.fulfill({ json: { email: 'admin@example.com' } }));
  await page.route('**/admin/check', route => route.fulfill({ json: {
    ok: true, permissions: ['admin'],
  } }));
  await page.route('**/admin/v1/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/users/delegate-id/permissions')) {
      const payload = request.postDataJSON();
      writes.push(payload);
      accounts[1].permissions = payload.permissions;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/users')) {
      return route.fulfill({ json: { accounts, currentId: 'admin-id' } });
    }
    return route.fulfill({ json: { content: { feature_flags: {} } } });
  });
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  const delegate = page.locator('.user-item').filter({ hasText: 'delegate@example.com' });
  await expect(delegate.getByRole('checkbox', { name: 'Projects', exact: true })).toBeChecked();
  await delegate.getByRole('checkbox', { name: 'Iteration mappings', exact: true }).check();
  await expect(delegate.getByRole('checkbox', { name: 'Iteration mappings', exact: true })).toBeEnabled();
  await expect(delegate.getByRole('checkbox', { name: 'Iteration mappings', exact: true })).toBeChecked();
  expect(writes).toEqual([{ permissions: ['manage_projects', 'manage_iterations'] }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('user-delegation-desktop.png') });
});

test('Canonical Workforce edits grouped composition using committed server revisions', async ({ page }, testInfo) => {
  const lastUpdated = '2026-10-12T13:45:00Z';
  let snapshot = {
    revision: 'first',
    teams: { schema_version: 3, teams: [{
      id: 'team-one', allocation_token: 'ONE', name: 'Engineering', short_name: 'ENG',
      archived: false, group_id: 'group-one', last_updated: lastUpdated,
    }], groups: [{ id: 'group-one', allocation_token: 'GROUP', name: 'Delivery',
      short_name: 'Delivery', archived: false, last_updated: lastUpdated }] },
    workforce: { schema_version: 2, suppliers: [{
      id: 'supplier-one', name: 'Internal provider', external: false, archived: false,
      last_updated: lastUpdated,
      profiles: [{ id: 'standard', name: 'Standard', monthly_project_hours: 160,
        hourly_rate: 50, archived: false, last_updated: lastUpdated }],
    }], staffing: [{ id: 'row-one', team_id: 'team-one', supplier_id: 'supplier-one',
      profile_id: 'standard', fte: 0.5, last_updated: lastUpdated }] },
  };
  const writes = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/admin/', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><title>Workforce fixture</title>
      <style>body { margin: 36px; font: 14px 'Segoe UI', sans-serif; background: #fff; }
      main { max-width: 1160px; margin: 0 auto; }</style></head><body>
      <main><admin-workforce></admin-workforce></main>
      <script type="module">
        import '/admin/js/components/admin/Workforce.lit.js';
        document.querySelector('admin-workforce').permissions = ['admin'];
      </script>
      </body></html>`,
  }));
  await page.route('**/admin/v1/workforce**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET') {
      if (path.endsWith('/deletion')) {
        const team = snapshot.teams.teams.find((entry) => entry.id === 'team-one');
        await route.fulfill({ json: { content: {
          revision: snapshot.revision, review_revision: `review-${snapshot.revision}`, team,
          group: snapshot.teams.groups.find((entry) => entry.id === team.group_id),
          staffing: snapshot.workforce.staffing.filter((row) => row.team_id === team.id),
          availability: [{ namespace: 'config', key: 'projects', path: ['allocation_defaults', 'project'] }],
          retained_allocations: [{ namespace: 'scenarios', key: 'scenario', record_id: 'task-one',
            path: ['overrides', 'task-one', 'capacity', 0, 'team'] }],
          saved_selections: [{ namespace: 'views', key: 'view', path: ['teams'] }],
          coverage: { historically_complete: false, retained_task_snapshots: 1 },
        } } });
        return;
      }
      await route.fulfill({ json: { content: snapshot } });
      return;
    }
    const payload = route.request().postDataJSON();
    expect(payload.revision).toBe(snapshot.revision);
    writes.push(structuredClone(payload));
    if (path.endsWith('/deletion')) {
      expect(payload.confirmation).toEqual({ acknowledged: true, review_revision: `review-${snapshot.revision}` });
      snapshot.teams.teams = snapshot.teams.teams.filter((team) => team.id !== 'team-one');
      snapshot.workforce.staffing = snapshot.workforce.staffing.filter((row) => row.team_id !== 'team-one');
    } else if (path.endsWith('/definitions/group')) {
      snapshot.teams.groups.push({ id: 'server-group', allocation_token: 'server-group',
        archived: false, last_updated: '2026-10-14T12:00:00Z', ...payload.fields });
    } else if (path.endsWith('/definitions/team')) {
      snapshot.teams.teams.push({ id: 'server-team', allocation_token: 'server-team',
        archived: false, last_updated: '2026-10-14T12:00:00Z', ...payload.fields });
    } else if (path.endsWith('/definitions/supplier')) {
      snapshot.workforce.suppliers.push({ id: 'server-supplier', archived: false, profiles: [],
        last_updated: '2026-10-14T12:00:00Z', ...payload.fields });
    } else if (path.endsWith('/definitions/profile')) {
      snapshot.workforce.suppliers.find((supplier) => supplier.id === payload.supplier_id)
        .profiles.push({ id: 'server-profile', archived: false,
          last_updated: '2026-10-14T12:00:00Z', ...payload.fields });
    } else {
      expect(path).toBe('/admin/v1/workforce');
      snapshot = structuredClone(payload);
    }
    snapshot.revision = `committed-${writes.length}`;
    await route.fulfill({ json: { ok: true, content: snapshot, warnings: [{
      error: 'cost_cache_invalidation_failed', message: 'Saved; fixture cost refresh failed',
    }] } });
  });
  await page.goto('/admin/');
  await expect(page.locator('[data-group="group-one"]')).toContainText('Engineering');
  await expect(page.locator('[data-team="team-one"] time')).toHaveAttribute('datetime', lastUpdated);
  await expect(page.locator('[data-group="group-one"] .group-row time')).toContainText('UTC');
  await page.getByRole('button', { name: 'New Group', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Specialists');
  await dialog.getByLabel('Short Name', { exact: true }).fill('Specialists');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'New Team', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('New team');
  await dialog.getByLabel('Short Name', { exact: true }).fill('New');
  await dialog.getByRole('combobox', { name: 'Group', exact: true }).selectOption('server-group');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-group="server-group"]')).toContainText('New team');
  expect(writes[1].fields).toEqual({ name: 'New team', short_name: 'New', group_id: 'server-group' });
  await page.locator('[data-edit-team="team-one"]').click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ADO Token: ONE');
  await expect(dialog.locator('time')).toHaveAttribute('datetime', lastUpdated);
  await expect(dialog).not.toContainText('Last Archived');
  await expect(dialog.getByRole('combobox', { name: 'Group', exact: true })).toHaveValue('group-one');
  await dialog.getByLabel('Name', { exact: true }).fill('Renamed team');
  await page.screenshot({ path: testInfo.outputPath('canonical-workforce-edit-desktop.png') });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[2].teams.teams[0].allocation_token).toBe('ONE');
  expect(writes[2].teams.teams[0].last_updated).toBe(lastUpdated);
  await page.locator('[data-expand="team-one"]').click();
  await page.locator('[data-edit-staffing="row-one"]').click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('FTE', { exact: true }).fill('0.75');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-composition="team-one"]')).toContainText('120');
  await expect(page.locator('[data-composition="team-one"] time')).toHaveAttribute('datetime', lastUpdated);
  await expect(page.getByRole('status')).toContainText('Saved; fixture cost refresh failed');
  expect(writes).toHaveLength(4);
  expect(snapshot.workforce.staffing[0].fte).toBe(0.75);
  await page.locator('[data-edit-staffing="row-one"]').click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('FTE', { exact: true }).fill('0.875');
  await dialog.getByRole('button', { name: 'Edit Selected Profile', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Edit Profile' })).toBeVisible();
  await expect(dialog.locator('[data-affected-staffing="row-one"]')).toContainText('Renamed team');
  await dialog.getByLabel('Hourly Rate', { exact: true }).fill('75');
  await page.screenshot({ path: testInfo.outputPath('canonical-workforce-profile-desktop.png') });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit Staffing' })).toBeVisible();
  await expect(dialog.getByLabel('FTE', { exact: true })).toHaveValue('0.875');
  await expect(dialog.getByRole('status')).toContainText('Saved; fixture cost refresh failed');
  expect(snapshot.workforce.staffing[0].fte).toBe(0.75);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[5].revision).toBe('committed-5');
  await expect(page.locator('[data-composition="team-one"]')).toContainText('10,500');
  await page.screenshot({ path: testInfo.outputPath('canonical-workforce-composition-desktop.png') });
  await page.getByRole('tab', { name: 'Suppliers & Profiles', exact: true }).click();
  await expect(page.locator('[data-supplier="supplier-one"]')).toContainText('Internal provider');
  await expect(page.getByRole('cell', { name: 'Standard', exact: true })).toBeVisible();
  await expect(page.locator('[data-supplier="supplier-one"] time')).toHaveAttribute('datetime', lastUpdated);
  await expect(page.locator('[data-profile="standard"] time')).toHaveAttribute('datetime', lastUpdated);
  await page.getByRole('button', { name: 'New Supplier', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Delivery partner');
  await dialog.getByRole('checkbox', { name: 'External supplier', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-supplier="server-supplier"]')).toContainText('External');
  await page.locator('[data-new-profile="server-supplier"]').click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Specialist');
  await dialog.getByLabel('Monthly Project Hours', { exact: true }).fill('120');
  await dialog.getByLabel('Hourly Rate', { exact: true }).fill('90');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-profile="server-profile"] time'))
    .toHaveAttribute('datetime', '2026-10-14T12:00:00Z');
  expect(writes).toHaveLength(8);
  expect(writes[7]).toEqual({ revision: 'committed-7', supplier_id: 'server-supplier',
    fields: { name: 'Specialist', monthly_project_hours: 120, hourly_rate: 90 } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('canonical-workforce-suppliers-desktop.png') });
  await page.getByRole('tab', { name: 'Teams & Composition', exact: true }).click();
  await page.locator('[data-delete-team="team-one"]').click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('past ADO tasks unusable');
  await expect(dialog).toContainText('Task task-one');
  await expect(dialog.getByRole('button', { name: 'Permanently Delete', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('canonical-workforce-deletion-desktop.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(8);
  await page.locator('[data-delete-team="team-one"]').click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Permanently Delete', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-team="team-one"]')).toHaveCount(0);
  await expect(page.locator('[data-team="server-team"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeFocused();
  expect(writes).toHaveLength(9);
  expect(snapshot.workforce.suppliers).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath('canonical-workforce-after-deletion-desktop.png') });
  snapshot.teams.teams[0].archived = true;
  snapshot.teams.teams[0].migration_incomplete = true;
  snapshot.revision = 'migration-review';
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.locator('[data-team="server-team"]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Show archived', exact: true }).check();
  await expect(page.locator('[data-team="server-team"]')).toContainText('Needs review');
  await page.locator('[data-edit-team="server-team"]').click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: 'Archived', exact: true })).toBeDisabled();
  await dialog.getByLabel('Name', { exact: true }).fill('Reviewed migrated team');
  await page.screenshot({ path: testInfo.outputPath('canonical-workforce-migration-review-desktop.png') });
  await dialog.getByRole('checkbox', { name: 'Migration information incomplete', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Archived', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-team="server-team"]')).toContainText('Reviewed migrated team');
  await expect(page.locator('[data-team="server-team"]')).not.toContainText('Needs review');
  expect(writes).toHaveLength(10);
  expect(snapshot.teams.teams[0].migration_incomplete).toBe(false);
  expect(snapshot.teams.teams[0].allocation_token).toBe('server-team');
  expect(pageErrors).toEqual([]);
});