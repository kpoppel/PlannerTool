import { chromium } from 'playwright';

// Seeds an isolated server with a deterministic synthetic organisation for documentation
// screenshots: two plan levels, four plans, grouped teams and internal/external staffing.
async function seedDocsData(page, dataDir) {
  return page.evaluate(async (dir) => {
    const request = async (method, url, payload) => {
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${method} ${url} failed (${response.status}): ${text}`);
      return text ? JSON.parse(text) : {};
    };
    const get = (url) => request('GET', url);
    const post = (url, payload) => request('POST', url, payload);

    const renewal = await fetch('/api/session', { method: 'POST' });
    if (renewal.status === 401) {
      await post('/api/auth/enroll', { email: 'alex.morgan@example.com', name: 'Alex Morgan' });
    }
    await post('/api/config', { email: 'alex.morgan@example.com', pat: 'docs-synthetic-pat' });

    const projectTypes = ['Epic', 'Feature'];
    const teamTypes = ['Feature', 'User Story'];
    const planSpecs = [
      { name: 'Apollo Platform', area: 'Contoso\\Apollo', type: 'project', types: projectTypes },
      { name: 'Hermes Mobile', area: 'Contoso\\Hermes', type: 'project', types: projectTypes },
      { name: 'Atlas Backlog', area: 'Contoso\\Teams\\Atlas', type: 'team', types: teamTypes },
      { name: 'Comet Backlog', area: 'Contoso\\Teams\\Comet', type: 'team', types: teamTypes },
    ];
    const plans = planSpecs.map((spec) => ({
      id: crypto.randomUUID(), name: spec.name, area_path: spec.area, type: spec.type,
      task_types: spec.types, closed_history_days: 0,
    }));

    let workforce = (await get('/admin/v1/workforce')).content;
    const define = async (kind, fields, extra = {}) => {
      workforce = (await post(`/admin/v1/workforce/definitions/${kind}`, {
        revision: workforce.revision, fields, ...extra,
      })).content;
    };
    await define('group', { name: 'Platform', short_name: 'PLT' });
    await define('group', { name: 'Mobile', short_name: 'MOB' });
    const groupId = (name) => workforce.teams.groups.find((entry) => entry.name === name).id;
    const teamSpecs = [
      ['Atlas', 'ATL', 'Platform'], ['Borealis', 'BOR', 'Platform'],
      ['Comet', 'COM', 'Mobile'], ['Delta', 'DLT', 'Mobile'],
    ];
    for (const [name, short, group] of teamSpecs) {
      await define('team', { name, short_name: short, group_id: groupId(group) });
    }
    await define('supplier', { name: 'Contoso Engineering', external: false });
    await define('supplier', { name: 'Nordic Consulting', external: true });
    const supplier = (name) => workforce.workforce.suppliers.find((entry) => entry.name === name);
    await define('profile', { name: 'Developer', monthly_project_hours: 130, hourly_rate: 65 },
      { supplier_id: supplier('Contoso Engineering').id });
    await define('profile', { name: 'Senior Developer', monthly_project_hours: 125, hourly_rate: 85 },
      { supplier_id: supplier('Contoso Engineering').id });
    await define('profile', { name: 'Consultant', monthly_project_hours: 150, hourly_rate: 110 },
      { supplier_id: supplier('Nordic Consulting').id });
    const profile = (supplierName, name) => supplier(supplierName).profiles
      .find((entry) => entry.name === name);
    const team = (name) => workforce.teams.teams.find((entry) => entry.name === name);
    const staffing = [
      ['Atlas', 'Contoso Engineering', 'Developer', 4], ['Atlas', 'Contoso Engineering', 'Senior Developer', 1],
      ['Borealis', 'Contoso Engineering', 'Developer', 3], ['Borealis', 'Nordic Consulting', 'Consultant', 2],
      ['Comet', 'Contoso Engineering', 'Developer', 5], ['Comet', 'Contoso Engineering', 'Senior Developer', 1],
      ['Delta', 'Nordic Consulting', 'Consultant', 3],
    ];
    for (const [teamName, supplierName, profileName, fte] of staffing) {
      await define('staffing', {
        team_id: team(teamName).id, supplier_id: supplier(supplierName).id,
        profile_id: profile(supplierName, profileName).id, fte,
      });
    }
    const teamIds = teamSpecs.map(([name]) => team(name).id);
    const projectsConfig = {
      schema_version: 4,
      container_types: ['project', 'team'],
      allocation_defaults: { project: teamIds, team: teamIds },
      project_map: plans,
    };

    // The generator builds one area per stored plan on first connect, but plan saves require an
    // imported process for that area's project. Restore seeds the plans before the process exists.
    const { schema_revision: schemaRevision } = await get('/admin/v1/backup');
    await post('/admin/v1/restore', {
      schema_revision: schemaRevision, config: { projects: projectsConfig },
    });
    await post('/api/session', {});
    await post('/admin/v1/ado', {
      content: {
        organization_url: 'contoso',
        feature_flags: {
          use_azure_mock_generator: true,
          data_dir: dir,
          generator_persist_enabled: false,
          generator_config: {
            seed: 20261017, n_plans: plans.length, default_items_per_area: 18, n_pis: 6,
            sprints_per_pi: 4, revisions_min: 3, revisions_max: 10,
          },
        },
      },
    });
    const process = (await post('/admin/v1/ado-processes/resolve', { project: 'Contoso' })).content;
    const imported = ['Epic', 'Feature', 'User Story'];
    const importRefs = process.types.filter((type) => imported.includes(type.name))
      .map((type) => type.reference_name);
    await post('/admin/v1/projects', {
      content: projectsConfig, process_imports: { [process.id]: importRefs },
    });
    await post('/admin/v1/global-settings', {
      content: {
        schema_version: 2,
        process_order: [process.id],
        type_tiers: { [process.id]: imported.map((name) => [name]) },
      },
    });
    await post('/admin/v1/reload-config', {});
    await post('/api/session', {});
    const tasks = await get('/api/tasks');
    for (const plan of plans) {
      if (!tasks.some((task) => task.project === plan.id)) {
        throw new Error(`Docs bootstrap loaded no tasks for ${plan.name}`);
      }
    }
    const release = await get('/api/auth/release-notes');
    await post('/api/auth/release-notes', { releaseId: release.releaseId });
    return { taskCount: tasks.length };
  }, dataDir);
}

export default async function globalSetup(config) {
  const baseURL = config.projects[0].use.baseURL;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 20000 });
    const summary = await seedDocsData(page, config.metadata.testDataDir);
    console.log('[docs-setup] synthetic organisation ready', summary);
    await page.evaluate(() => {
      localStorage.setItem('az_planner:onboarding_seen', '1');
      localStorage.setItem('az_planner:tour_seen', '1');
    });
    await context.storageState({ path: config.metadata.storageStatePath });
  } finally {
    await browser.close();
  }
}
