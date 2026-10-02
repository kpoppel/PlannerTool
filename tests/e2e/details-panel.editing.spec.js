import { test as base, expect } from '@playwright/test';
import {
  activateScenario, clearOverlays, createScenario, deleteScenario,
  saveScenarioChanges, waitForFeatureCards,
} from './helpers.js';

const test = base.extend({
  editingScenario: async ({ page }, use) => {
    const tasksResponse = await page.request.get('/api/tasks');
    const teamsResponse = await page.request.get('/api/teams');
    expect(tasksResponse.ok()).toBe(true);
    expect(teamsResponse.ok()).toBe(true);
    const tasks = await tasksResponse.json();
    const teams = await teamsResponse.json();
    expect(teams.length).toBeGreaterThan(0);
    const team = teams[0];
    const parent = tasks.find((task) => task.type.toLowerCase() === 'epic' &&
      task.relations.some((relation) => relation.type === 'Child'));
    expect(parent, 'Expected a generated Epic with child relations').toBeDefined();
    const childIds = new Set(parent.relations.filter((relation) => relation.type === 'Child')
      .map((relation) => String(relation.id)));
    const children = tasks.filter((task) => childIds.has(String(task.id)));
    expect(children.length).toBe(childIds.size);
    const overrides = Object.fromEntries(children.map((child) => [child.id, {
      start: '2026-10-20', end: '2026-11-05', iterationPath: '',
    }]));
    overrides[parent.id] = {
      start: '2026-10-15', end: '2026-11-20', iterationPath: '',
      capacity: [{ team: team.id, capacity: 40 }],
    };
    const scenario = { ...await createScenario(page, overrides), parent, team };
    try {
      await activateScenario(page, scenario);
      await use(scenario);
    } finally {
      await deleteScenario(page, scenario);
    }
  },
});

async function openParent(page, scenario) {
  await page.locator(`feature-card-lit[data-feature-id="${scenario.parent.id}"]`).click();
  await expect(page.locator('details-panel .panel')).toBeVisible();
}

async function saveScenario(page, scenario) {
  await page.locator('details-panel .details-close').click();
  return saveScenarioChanges(page, scenario);
}

test.describe('Details Panel editing and scheduling', () => {
  test('capacity input changes persist in the editable scenario', async ({ page, editingScenario }) => {
    await openParent(page, editingScenario);
    const input = page.locator('details-panel .capacity-bar-input');
    await expect(input).toHaveValue('40');
    await input.fill('70');
    await input.press('Tab');
    await expect(input).toHaveValue('70');
    await expect(page.locator('details-panel .capacity-bar-label')).toHaveText('70%');
    const saved = await saveScenario(page, editingScenario);
    expect(saved.overrides[editingScenario.parent.id].capacity).toEqual([
      { team: editingScenario.team.id, capacity: 70 },
    ]);
  });

  test('deleting a capacity allocation persists its removal', async ({ page, editingScenario }) => {
    await openParent(page, editingScenario);
    const rows = page.locator('details-panel .capacity-bar-row');
    await expect(rows).toHaveCount(1);
    await rows.hover();
    await rows.locator('.capacity-bar-delete').click();
    await expect(rows).toHaveCount(0);
    const saved = await saveScenario(page, editingScenario);
    expect(saved.overrides[editingScenario.parent.id].capacity).toEqual([]);
  });

  test('adding a team does not mutate readonly Baseline', async ({ page }) => {
    await page.goto('/');
    await clearOverlays(page);
    await waitForFeatureCards(page);
    await expect(page.getByRole('button', { name: /^Scenario(?:\s|$)/ }))
      .toContainText('Baseline');
    const card = page.locator('feature-card-lit').first();
    await card.click();
    const rows = page.locator('details-panel .capacity-bar-row');
    const before = await rows.allTextContents();
    await page.locator('details-panel .add-team-btn').click();
    const form = page.locator('details-panel .add-team-form');
    await expect(form).toBeVisible();
    const select = form.locator('select');
    expect(await select.locator('option').count()).toBeGreaterThan(1);
    await select.selectOption({ index: 1 });
    await form.locator('input').fill('10');
    await form.getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('details-panel .details-close').click();
    await card.click();
    await expect(rows).toHaveCount(before.length);
    expect(await rows.allTextContents()).toEqual(before);
  });

  test('shrinkwrap persists the exact child date span', async ({ page, editingScenario }) => {
    await openParent(page, editingScenario);
    const dates = page.locator('details-panel input[type="date"]');
    await expect(dates.nth(0)).toHaveValue('2026-10-15');
    await expect(dates.nth(1)).toHaveValue('2026-11-20');
    await page.locator('details-panel').getByRole('button', {
      name: 'Shrink Epic to children', exact: true,
    }).click();
    await expect(dates.nth(0)).toHaveValue('2026-10-20');
    await expect(dates.nth(1)).toHaveValue('2026-11-05');
    const saved = await saveScenario(page, editingScenario);
    expect(saved.overrides[editingScenario.parent.id]).toMatchObject({
      start: '2026-10-20', end: '2026-11-05',
    });
  });
});