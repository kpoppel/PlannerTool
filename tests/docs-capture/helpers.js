import { expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOCS_IMG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'www', 'docs', 'img');
mkdirSync(DOCS_IMG_DIR, { recursive: true });

// Fixed "today" keeps the timeline position and relative labels stable between runs.
export const DOCS_TODAY = new Date('2026-07-15T09:00:00');

// Titles combine a subject with a work phrase so every generated task gets a unique, readable name.
const TITLE_PARTS = {
  Epic: [['Payments', 'Identity', 'Mobile', 'Observability', 'Partner API', 'Data residency', 'Insights',
    'Onboarding'], ['modernisation', 'programme', 'platform', 'rollout']],
  Feature: [['Checkout', 'Single sign-on', 'Notifications', 'Audit log', 'Analytics', 'Invoicing', 'Search',
    'Profile', 'Billing', 'Offline sync', 'Webhooks', 'Localisation'], ['API', 'dashboard', 'export', 'redesign',
    'alerts', 'service', 'settings', 'migration']],
  'User Story': [['Validate', 'Paginate', 'Cache', 'Translate', 'Sort', 'Filter', 'Export', 'Log', 'Retry',
    'Preview'], ['sign-up email', 'invoice list', 'profile image', 'settings page', 'audit entries',
    'search results', 'sync status', 'webhook payloads']],
};

const PLAN_TEAMS = {
  'Apollo Platform': ['Atlas', 'Borealis'],
  'Hermes Mobile': ['Comet', 'Delta'],
  'Atlas Backlog': ['Atlas', 'Borealis'],
  'Comet Backlog': ['Comet', 'Delta'],
};

const hash = (value) => [...String(value)].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);

/**
 * Give synthetic generator tasks readable titles and team allocations for screenshots.
 * The generator's own data has neither; everything else is passed through unchanged.
 */
export async function prepareDocsPage(page) {
  await page.clock.setFixedTime(DOCS_TODAY);
  const teams = await (await page.request.get('/api/teams')).json();
  const projects = await (await page.request.get('/api/projects')).json();
  const teamId = (name) => teams.find((entry) => entry.name === name).id;
  const planName = (id) => projects.find((entry) => entry.id === id).name;
  await page.route(/\/api\/tasks($|\?)/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const tasks = await response.json();
    const counters = {};
    await route.fulfill({ response, json: tasks.map((task) => {
      const [subjects, phrases] = TITLE_PARTS[task.type];
      counters[task.type] = (task.type in counters ? counters[task.type] : 0) + 1;
      const index = counters[task.type] - 1;
      const title = `${subjects[index % subjects.length]} ${phrases[Math.floor(index / subjects.length) % phrases.length]}`;
      const h = hash(task.id);
      const candidates = PLAN_TEAMS[planName(task.project)];
      let capacity = [];
      if (task.type === 'Feature' && h % 7 !== 0) {
        capacity = [{ team: teamId(candidates[h % 2]), capacity: 20 + (h % 5) * 10 }];
        if (h % 3 === 0) capacity.push({ team: teamId(candidates[(h + 1) % 2]), capacity: 10 + (h % 3) * 10 });
      } else if (task.type === 'Epic' && h % 2 === 0) {
        capacity = [{ team: teamId(candidates[h % 2]), capacity: 10 + (h % 3) * 10 }];
      }
      return { ...task, title, capacity };
    }) });
  });
}

export async function openPlanner(page) {
  await prepareDocsPage(page);
  await page.goto('/');
  await expect(page.locator('app-sidebar aside.sidebar')).toBeVisible();
  await expect(page.locator('feature-card-lit').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
}

export async function shot(target, name, options = {}) {
  await target.screenshot({ path: resolve(DOCS_IMG_DIR, `${name}.png`), animations: 'disabled', ...options });
}

/** Screenshot a page region spanning the given locators plus padding. */
export async function shotAround(page, locators, name, padding = 8) {
  const boxes = [];
  for (const locator of locators) boxes.push(await locator.boundingBox());
  const viewport = page.viewportSize();
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - padding);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - padding);
  const right = Math.min(viewport.width, Math.max(...boxes.map((b) => b.x + b.width)) + padding);
  const bottom = Math.min(viewport.height, Math.max(...boxes.map((b) => b.y + b.height)) + padding);
  await shot(page, name, { clip: { x, y, width: right - x, height: bottom - y } });
}
