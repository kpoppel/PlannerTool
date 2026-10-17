import { chromium } from 'playwright';

async function bootstrapTestData(page, testDataDir) {
  const bootstrapSummary = await page.evaluate(async (dataDir) => {
    const adminEmail = 'user@example.com';
    const adminPat = 'playwright-mock-pat';

    const readJson = async (response) => {
      const text = await response.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    };

    const get = async (url) => {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(`GET ${url} failed (${response.status}): ${JSON.stringify(body)}`);
      }
      return body;
    };

    const post = async (url, payload) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(`POST ${url} failed (${response.status}): ${JSON.stringify(body)}`);
      }
      return body;
    };

    const setupStatus = await get('/admin/v1/setup-status');
    const renewal = await fetch('/api/session', { method: 'POST' });
    if (renewal.status === 401) {
      await post('/api/auth/enroll', { email: adminEmail, name: 'Playwright Admin' });
    } else if (!renewal.ok) {
      throw new Error(`Session renewal failed (${renewal.status})`);
    }
    await post('/api/config', { email: adminEmail, pat: adminPat });

    await post('/admin/v1/ado', {
      content: {
        organization_url: 'anonymous-org',
        feature_flags: {
          use_azure_mock_generator: true,
          data_dir: dataDir,
          generator_persist_enabled: true,
          generator_persist_dir: `${dataDir}/azure_mock_generated`,
          generator_config: {
            seed: 489723,
            n_plans: 1,
            default_items_per_area: 20,
            n_pis: 6,
            sprints_per_pi: 4,
            revisions_min: 2,
            revisions_max: 12,
          },
        },
      },
    });

    let workforce = (await get('/admin/v1/workforce')).content;
    const createDefinition = async (kind, fields, extra = {}) => {
      workforce = (await post(`/admin/v1/workforce/definitions/${kind}`, {
        revision: workforce.revision, fields, ...extra,
      })).content;
    };
    await createDefinition('team', { name: 'TeamA', short_name: 'TA', group_id: null });
    const team = workforce.teams.teams.find((entry) => entry.name === 'TeamA');
    await createDefinition('supplier', { name: 'Internal provider', external: false });
    const supplier = workforce.workforce.suppliers.find((entry) => entry.name === 'Internal provider');
    await createDefinition('profile', {
      name: 'Standard', monthly_project_hours: 160, hourly_rate: 50,
    }, { supplier_id: supplier.id });
    const profile = workforce.workforce.suppliers.find((entry) => entry.id === supplier.id)
      .profiles.find((entry) => entry.name === 'Standard');
    await createDefinition('staffing', {
      team_id: team.id, supplier_id: supplier.id, profile_id: profile.id, fte: 2,
    });

    const process = (await post('/admin/v1/ado-processes/resolve', {
      project: 'TestProject',
    })).content;
    const planTypes = ['Epic', 'Feature', 'User Story'];
    const importedTypes = process.types.filter((type) => planTypes.includes(type.name));

    const planId = crypto.randomUUID();
    await post('/admin/v1/projects', {
      process_imports: {
        [process.id]: importedTypes.map((type) => type.reference_name),
      },
      content: {
        schema_version: 4,
        container_types: ['project', 'team'],
        allocation_defaults: { project: [team.id], team: [team.id] },
        project_map: [
          {
            id: planId,
            name: 'Synthetic Team A',
            area_path: 'TestProject\\TestTeam',
            type: 'team',
            task_types: planTypes,
            closed_history_days: 0,
          },
        ],
      },
    });

    await post('/admin/v1/global-settings', {
      content: {
        schema_version: 2,
        process_order: [process.id],
        type_tiers: { [process.id]: planTypes.map((name) => [name]) },
      },
    });

    await post('/admin/v1/reload-config', {});
    await post('/api/session', {});
    const tasks = await get('/api/tasks');
    const projects = await get('/api/projects');
    if (!projects.some((project) => project.id === planId)) {
      throw new Error('E2E bootstrap did not expose the configured plan');
    }
    if (!tasks.some((task) => task.project === planId)) {
      throw new Error('E2E bootstrap did not load tasks owned by the configured plan');
    }
    const release = await get('/api/auth/release-notes');
    await post('/api/auth/release-notes', { releaseId: release.releaseId });

    return {
      needsSetup: Boolean(setupStatus.needs_setup),
      adminEmail,
      taskCount: tasks.length,
    };
  }, testDataDir);

  console.log('[global-setup] admin bootstrap complete', bootstrapSummary);
}

// function waitForServer(url, timeout = 15000) {
//   const start = Date.now();
//   return new Promise((resolve, reject) => {
//     (function ping() {
//       const req = http
//         .get(url, (res) => {
//           res.resume();
//           resolve();
//         })
//         .on('error', () => {
//           if (Date.now() - start > timeout) return reject(new Error('timeout'));
//           setTimeout(ping, 200);
//         });
//     })();
//   });
// }

export default async function globalSetup(config) {
  // Playwright's webServer starts an isolated server for this suite.
  const userEmail = 'user@example.com';
  const baseURL =
    (config.use && config.use.baseURL) ||
    (config.projects &&
      config.projects[0] &&
      config.projects[0].use &&
      config.projects[0].use.baseURL) ||
    'http://localhost:8000';
  console.log('[global-setup] baseURL=', baseURL);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const storageStatePath = config.metadata.storageStatePath;
  const page = await context.newPage();

  try {
    // Require the app and the config modal flow to succeed — fail fast if not available.
    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 20000 });
    await bootstrapTestData(page, config.metadata.testDataDir);
    // If an onboarding modal blocks interaction, remove it from DOM to allow clicks.
    await page.evaluate(() => {
      const selectors = [
        'onboarding-modal',
        '.onboarding-modal',
        '#onboardingModal',
        '[data-tour="onboarding"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) el.remove();
      }
      // also remove any modal overlays
      const overlays = document.querySelectorAll(
        '.modal-backdrop, .overlay, .onboarding-overlay'
      );
      overlays.forEach((o) => o.remove());
    });
    await page.evaluate((email) => {
      let prefs = {};
      try {
        const raw = localStorage.getItem('az_planner:user_prefs:v1');
        prefs = raw ? JSON.parse(raw) : {};
      } catch {
        prefs = {};
      }
      prefs['user.email'] = email;
      localStorage.setItem('az_planner:user_prefs:v1', JSON.stringify(prefs));
    }, userEmail);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // Mark onboarding/tour as seen so modals don't intercept clicks in later sessions
    await page.evaluate(() => {
      localStorage.setItem('az_planner:onboarding_seen', '1');
      localStorage.setItem('az_planner:tour_seen', '1');
    });
    await context.storageState({ path: storageStatePath });
    console.log('[global-setup] storage state saved to', storageStatePath);
    // Keep setup scenario-neutral: tests should not implicitly depend on a
    // non-baseline scenario being active unless they activate one explicitly.
    console.log('[global-setup] scenario seeding skipped (baseline-only setup)');
  } finally {
    await browser.close();
  }
}
