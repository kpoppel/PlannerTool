import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const storageStatePath = resolve(__dirname, 'storageState.json');

async function bootstrapTestData(page) {
  const bootstrapSummary = await page.evaluate(async () => {
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
    if (setupStatus.needs_setup) {
      await post('/admin/v1/setup', { email: adminEmail, pat: adminPat });
    } else {
      try {
        await post('/api/session', { email: adminEmail });
      } catch {
        // Existing data may not contain this account; create it then create session.
        await post('/api/config', {
          email: adminEmail,
          pat: adminPat,
          permissions: ['admin'],
        });
        await post('/api/session', { email: adminEmail });
      }
    }

    await post('/admin/v1/ado', {
      content: {
        organization_url: 'anonymous-org',
        feature_flags: {
          use_azure_mock_generator: true,
          data_dir: 'tests/e2e/.tmp-data',
          generator_persist_enabled: true,
          generator_persist_dir: 'tests/e2e/.tmp-data/azure_mock_generated',
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

    await post('/admin/v1/projects', {
      content: {
        schema_version: 3,
        project_map: [
          {
            name: 'Synthetic Team A',
            area_path: 'SyntheticProject\\TeamA',
            type: 'team',
            task_types: ['Epic', 'Feature', 'User Story', 'Task'],
            include_states: ['New', 'Defined', 'Active', 'Resolved', 'Closed'],
            display_states: ['New', 'Defined', 'Active', 'Resolved', 'Closed'],
          },
        ],
      },
    });

    await post('/admin/v1/global-settings', {
      content: {
        task_type_hierarchy: [
          { level: 1, types: ['Epic'] },
          { level: 2, types: ['Feature'] },
          { level: 3, types: ['User Story'] },
          { level: 4, types: ['Task'] },
        ],
        state_display_sequence: [
          { types: ['New'] },
          { types: ['Defined'] },
          { types: ['Active'] },
          { types: ['Resolved'] },
          { types: ['Closed'] },
        ],
      },
    });

    await post('/admin/v1/teams', {
      content: {
        schema_version: 2,
        teams: [{ name: 'TeamA', short_name: 'TA' }],
      },
    });

    await post('/admin/v1/people', {
      content: {
        schema_version: 1,
        database_file: 'config/database.yaml',
        database: {
          people: [
            { name: 'Alex TeamA', team: 'TeamA' },
            { name: 'Jamie TeamA', team: 'TeamA' },
          ],
        },
      },
    });

    await post('/admin/v1/reload-config', {});
    await post('/api/session', { email: adminEmail });

    return {
      needsSetup: Boolean(setupStatus.needs_setup),
      adminEmail,
    };
  });

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
  const page = await context.newPage();

  try {
    // Require the app and the config modal flow to succeed — fail fast if not available.
    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 20000 });
    await bootstrapTestData(page);
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
