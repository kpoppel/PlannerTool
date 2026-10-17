import { test, expect } from '@playwright/test';
import { openPlanner, shot, shotAround } from './helpers.js';

// Screenshots for the planner user documentation. Tests run serially against one isolated
// server; scenario-mutating captures come last.
test.describe.configure({ mode: 'serial' });

const BOARD_CLIP = { x: 320, y: 40, width: 1120, height: 860 };

async function openMenu(page, trigger, element) {
  const popover = page.locator(`${element} .menu-popover`);
  if (!(await popover.isVisible())) await page.locator(trigger).click();
  await expect(popover).toBeVisible();
  return popover;
}

const MENU_TRIGGERS = {
  'view-menu': '#viewMenuBtn', 'scenario-menu': '#scenarioMenuBtn', 'plan-menu': '#planMenuBtn',
  'scope-menu': '#scopeMenuBtn', 'tools-menu': '#toolsMenuBtn',
};

async function closeMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  for (const [element, trigger] of Object.entries(MENU_TRIGGERS)) {
    if (await page.locator(element).count() > 0) await page.locator(trigger).click();
  }
  await page.waitForTimeout(150);
}

async function selectOnlyPlan(page, planName) {
  const popover = await openMenu(page, '#planMenuBtn', 'plan-menu');
  const toggle = popover.locator('.list-toggle-btn').first();
  if ((await toggle.innerText()).trim() === 'None') await toggle.click();
  await popover.locator('.sidebar-chip', { hasText: planName }).click();
  await closeMenus(page);
  await page.waitForTimeout(600);
}

/** Return viewport coordinates of an empty board spot (no card or group under the pointer). */
async function findEmptyBoardPoint(page) {
  const board = await page.locator('feature-board').boundingBox();
  return page.evaluate(({ x, y, width, height }) => {
    const deepest = (px, py) => {
      let element = document.elementFromPoint(px, py);
      while (element && element.shadowRoot) {
        const inner = element.shadowRoot.elementFromPoint(px, py);
        if (inner === null || inner === element) break;
        element = inner;
      }
      return element;
    };
    for (let py = y + 60; py < Math.min(y + height, innerHeight) - 20; py += 23) {
      for (let px = x + 40; px < Math.min(x + width, innerWidth) - 40; px += 37) {
        const path = [];
        let node = deepest(px, py);
        while (node) {
          path.push(node.tagName);
          node = node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentElement;
        }
        if (!path.includes('FEATURE-CARD-LIT') && !path.includes('FEATURE-GROUP')
          && path.includes('FEATURE-BOARD')) return { x: px, y: py };
      }
    }
    throw new Error('No empty board point found');
  }, board);
}

test('overview, top menu and popovers', async ({ page }) => {
  await openPlanner(page);
  await shot(page, 'app_overview');
  await shot(page.getByRole('navigation', { name: 'Top menu' }), 'topmenu');

  for (const [trigger, element, name] of [
    ['#viewMenuBtn', 'view-menu', 'menu_view'],
    ['#scenarioMenuBtn', 'scenario-menu', 'menu_scenario'],
    ['#planMenuBtn', 'plan-menu', 'menu_plan'],
    ['#scopeMenuBtn', 'scope-menu', 'menu_scope'],
    ['#toolsMenuBtn', 'tools-menu', 'menu_tools'],
  ]) {
    const popover = await openMenu(page, trigger, element);
    await shotAround(page, [page.locator(trigger), popover], name);
    await closeMenus(page);
  }

  const planMenu = await openMenu(page, '#planMenuBtn', 'plan-menu');
  await planMenu.getByRole('combobox', { name: 'Connected to' }).click();
  await expect(planMenu.getByRole('listbox')).toBeVisible();
  await shotAround(page, [page.locator('#planMenuBtn'), planMenu], 'menu_plan_connected');
  await closeMenus(page);
  await closeMenus(page);

  await page.locator('#boardInfoBtn').click();
  const info = page.getByRole('dialog', { name: 'Board information' });
  await expect(info).toBeVisible();
  await shotAround(page, [page.locator('#boardInfoBtn'), info], 'board_information');
  await closeMenus(page);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('menu', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await shotAround(page, [page.locator('#openConfigBtn'), settings], 'settings_menu');
  await page.getByRole('menuitem', { name: 'Configuration', exact: true }).click();
  const config = page.locator('config-modal modal-lit .modal');
  await expect(config).toBeVisible();
  await page.waitForTimeout(300);
  await shot(config, 'config_modal');
  await page.locator('config-modal #closeConfigBtn').click();

  await page.locator('#openHelpBtn').click();
  const help = page.locator('help-modal modal-lit .modal');
  await expect(help).toBeVisible();
  await page.waitForTimeout(800);
  await shot(help, 'help_modal');
});

test('sidebar, graph and card display modes', async ({ page }) => {
  await openPlanner(page);
  await shot(page.locator('app-sidebar aside.sidebar'), 'sidebar');
  await shot(page.locator('maingraph-lit'), 'graph_team');

  const view = await openMenu(page, '#viewMenuBtn', 'view-menu');
  await view.locator('.segment-btn', { hasText: /^project$/ }).click();
  await closeMenus(page);
  await page.waitForTimeout(500);
  await shot(page.locator('maingraph-lit'), 'graph_project');

  await shot(page, 'board_normal', { clip: BOARD_CLIP });
  for (const mode of ['Compact', 'Packed']) {
    const menu = await openMenu(page, '#viewMenuBtn', 'view-menu');
    await menu.locator('.segment-btn', { hasText: new RegExp(`^${mode}$`) }).click();
    await closeMenus(page);
    await page.waitForTimeout(600);
    await shot(page, `board_${mode.toLowerCase()}`, { clip: BOARD_CLIP });
  }
});

test('cards, details panel and search', async ({ page }) => {
  await openPlanner(page);
  const cards = page.locator('feature-card-lit');
  const count = await cards.count();
  let anatomy = null;
  for (let index = 0; index < count && anatomy === null; index += 1) {
    const card = cards.nth(index);
    if (await card.locator('.team-load-box').count() < 3 || !(await card.isVisible())) continue;
    const box = await card.locator('.feature-card').boundingBox();
    if (box.width > 320) anatomy = card;
  }
  expect(anatomy).not.toBeNull();
  await anatomy.scrollIntoViewIfNeeded();
  await shotAround(page, [anatomy.locator('.feature-card')], 'card_anatomy', 14);

  await anatomy.locator('.feature-card').click();
  const panel = page.locator('details-panel .panel:not(.closed)');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'details_baseline');

  await page.locator('details-panel .details-close').click();
  await page.keyboard.press('f');
  const search = page.locator('search-tool .panel');
  await expect(search).toBeVisible();
  await search.locator('input').fill('sync');
  await page.waitForTimeout(300);
  await shot(search, 'search_tool');
  await page.keyboard.press('Escape');
});

test('reconciliation review', async ({ page }) => {
  await openPlanner(page);
  const trigger = page.locator('[data-plugin-id="plugin-reconciliation"]');
  await shot(trigger, 'reconciliation_trigger');
  await trigger.click();
  const review = page.locator('reconciliation-review');
  await expect(review).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'reconciliation_overview');
  await review.locator('details.issue-class summary').first().click();
  await review.locator('details.issue-class .item').first().click();
  await page.waitForTimeout(600);
  await shot(page, 'reconciliation_issue');
});

test('scenario workflow, groups and publishing', async ({ page }) => {
  await openPlanner(page);
  await openMenu(page, '#scenarioMenuBtn', 'scenario-menu');
  await page.locator('scenario-menu .copy-scenario-btn').click();
  const cloneModal = page.locator('scenario-clone-modal modal-lit .modal');
  await expect(cloneModal).toBeVisible();
  await page.locator('scenario-clone-modal #cloneInput').fill('Q3 rebalancing');
  await shot(cloneModal, 'scenario_clone_modal');
  await page.locator('scenario-clone-modal #cloneBtn').click();
  await expect(page.locator('#scenarioMenuBtn')).toContainText('Q3 rebalancing');
  await page.waitForTimeout(800);

  await selectOnlyPlan(page, 'Apollo Platform');
  const card = page.locator('feature-card-lit').filter({ has: page.locator('.team-load-box') }).nth(2);
  await card.locator('.feature-card').click();
  const panel = page.locator('details-panel .panel:not(.closed)');
  await expect(panel).toBeVisible();
  const capacity = panel.locator('.capacity-bar-input').first();
  await capacity.fill('50');
  await capacity.dispatchEvent('change');
  const start = panel.locator('input[type="date"]').first();
  const end = panel.locator('input[type="date"]').nth(1);
  await end.fill('2026-12-18');
  await end.dispatchEvent('change');
  await start.fill('2026-08-03');
  await start.dispatchEvent('change');
  await page.waitForTimeout(600);
  await shot(page, 'details_scenario');
  await shot(panel, 'details_panel');

  await page.locator('details-panel .details-close').click();
  const empty = await findEmptyBoardPoint(page);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  const groupMenu = page.locator('group-context-menu .menu');
  await expect(groupMenu).toBeVisible();
  await shot(groupMenu, 'group_board_menu');
  await groupMenu.locator('.menu-item').first().click();
  await groupMenu.locator('input').fill('Q3 candidates');
  await shot(groupMenu, 'group_create_form');
  await groupMenu.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForTimeout(500);

  const datedCards = page.locator('feature-card-lit').filter({ hasText: /\d{4}-\d{2}-\d{2}/ });
  const memberIds = [await datedCards.nth(0).locator('.feature-card').getAttribute('data-id')];
  for (const [index, id] of memberIds.entries()) {
    await page.locator(`.feature-card[data-id="${id}"]`).click({ button: 'right' });
    const featureMenu = page.locator('group-context-menu .menu');
    await expect(featureMenu).toBeVisible();
    if (index === 0) await shot(featureMenu, 'group_card_menu');
    await featureMenu.locator('button.menu-item', { hasText: 'Q3 candidates' }).click();
    await page.waitForTimeout(400);
  }
  const group = page.locator('feature-group').first();
  await expect(group).toBeVisible();
  await shot(page, 'group_on_board', { clip: BOARD_CLIP });

  const scenarioMenu = await openMenu(page, '#scenarioMenuBtn', 'scenario-menu');
  await shotAround(page, [page.locator('#scenarioMenuBtn'), scenarioMenu], 'menu_scenario_changes');
  await scenarioMenu.getByTitle('Publish scenario').click();
  const publish = page.locator('publish-scenario-modal modal-lit .modal');
  await expect(publish).toBeVisible();
  await page.locator('publish-scenario-modal').getByRole('button', { name: 'Toggle All/None' }).click();
  await page.waitForTimeout(500);
  await shot(publish, 'publish_modal');
  await page.locator('publish-scenario-modal').getByRole('button', { name: 'Cancel', exact: true }).click();
});
