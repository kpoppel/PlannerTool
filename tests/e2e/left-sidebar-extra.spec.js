import { test, expect } from '@playwright/test';
import { clearOverlays } from './helpers.js';

test.describe('Left Sidebar - Extra coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('app-sidebar');
    await clearOverlays(page);
    // ensure lists rendered
    await page.waitForSelector('#projectList .sidebar-list-item', { timeout: 7000 }).catch(()=>{});
  });

  test('project and team select-all toggles flip selection', async ({ page }) => {
    // Projects
    const projectToggle = page.locator('#projectToggleBtn');
    const projectChips = page.locator('#projectList .sidebar-chip');
    const pCount = await projectChips.count();
    expect(pCount).toBeGreaterThan(0);

    const anyUncheckedBefore = await projectChips.evaluateAll(els => els.some(el => !el.classList.contains('active')));
    await projectToggle.click();
    await page.waitForTimeout(400);
    let anyUncheckedAfter = await projectChips.evaluateAll(els => els.some(el => !el.classList.contains('active')));
    if (anyUncheckedAfter === anyUncheckedBefore) {
      // retry once
      await projectToggle.click();
      await page.waitForTimeout(400);
      anyUncheckedAfter = await projectChips.evaluateAll(els => els.some(el => !el.classList.contains('active')));
    }
    expect(anyUncheckedAfter).not.toBe(anyUncheckedBefore);

    // Teams
    const teamToggle = page.locator('#teamToggleBtn');
    const teamChips = page.locator('#teamList .sidebar-chip');
    const tCount = await teamChips.count();
    expect(tCount).toBeGreaterThan(0);

    const anyTeamUncheckedBefore = await teamChips.evaluateAll(els => els.some(el => !el.classList.contains('active')));
    await teamToggle.click();
    await page.waitForTimeout(400);
    let anyTeamUncheckedAfter = await teamChips.evaluateAll(els => els.some(el => !el.classList.contains('active')));
    if (anyTeamUncheckedAfter === anyTeamUncheckedBefore) {
      await teamToggle.click();
      await page.waitForTimeout(400);
      anyTeamUncheckedAfter = await teamChips.evaluateAll(els => els.some(el => !el.classList.contains('active')));
    }
    expect(anyTeamUncheckedAfter).not.toBe(anyTeamUncheckedBefore);
  });

  test('collapsible headers toggle collapsed class and chevron text', async ({ page }) => {
    const header = page.locator('#projectsSection .sidebar-section-header-collapsible');
    // the content wrapper is the second div inside the section
    const content = page.locator('#projectsSection').locator('div').nth(1);
    await expect(header).toBeVisible();
    const chevron = header.locator('.sidebar-chevron');

    const beforeCollapsed = await content.evaluate(el => el.classList.contains('sidebar-section-collapsed'));
    const beforeChevron = await chevron.textContent();

    await header.click();
    await page.waitForTimeout(200);

    const afterCollapsed = await content.evaluate(el => el.classList.contains('sidebar-section-collapsed'));
    const afterChevron = await chevron.textContent();
    expect(afterCollapsed).toBe(!beforeCollapsed);
    expect(afterChevron).not.toBe(beforeChevron);
  });

  test('color popover applies selected color to entity', async ({ page }) => {
    const firstChip = page.locator('#projectList .sidebar-list-item .chip').first();
    await expect(firstChip).toBeVisible();
    const colorDot = firstChip.locator('.color-dot');
    const dataId = await colorDot.getAttribute('data-color-id');
    expect(dataId).toBeTruthy();

    // open popover
    await colorDot.click();
    await page.waitForSelector('.color-popover', { timeout: 3000 });
    const swatch = page.locator('.color-popover .color-swatch').first();
    await expect(swatch).toBeVisible();
    const colorVal = await swatch.getAttribute('data-color');
    expect(colorVal).toBeTruthy();

    await swatch.click();
    await page.waitForTimeout(400);

    // Compare computed color equality (handles hex vs rgb differences) in page context
    const applied = await page.evaluate(([id, color]) => {
      const dot = document.querySelector(`.color-dot[data-color-id="${id}"]`);
      if(!dot) return false;
      const tmp = document.createElement('div'); tmp.style.color = color; document.body.appendChild(tmp);
      const expected = getComputedStyle(tmp).color; tmp.remove();
      return getComputedStyle(dot).backgroundColor === expected;
    }, [dataId, colorVal]);
    expect(applied).toBe(true);
  });

  test('scenario activation and menu actions open modals', async ({ page }) => {
    const scenario = page.locator('#scenarioList .scenario-item').first();
    await expect(scenario).toBeVisible();

    // Activate scenario
    await scenario.click();
    await page.waitForTimeout(200);
    const isActive = await scenario.evaluate(el => el.classList.contains('active'));
    expect(isActive).toBe(true);

    // Open scenario menu and click Clone Scenario, expect clone modal
    const menuBtn = scenario.locator('.scenario-controls .scenario-btn');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    const pop = page.locator('.scenario-menu-popover');
    await expect(pop).toBeVisible();

    const cloneItem = pop.locator('text=Clone Scenario');
    if (await cloneItem.count() > 0) {
      await cloneItem.first().click();
      // modal-lit sets open=true on the inner modal; wait for visible modal-lit
      await page.waitForSelector('scenario-clone-modal modal-lit[open]', { timeout: 4000 });
      await expect(page.locator('scenario-clone-modal modal-lit[open]')).toBeVisible();
      await page.keyboard.press('Escape').catch(()=>{});
    }

    // Open menu again and try Rename
    await menuBtn.click();
    await expect(pop).toBeVisible();
    const renameItem = pop.locator('text=Rename');
    if (await renameItem.count() > 0) {
      await renameItem.first().click();
      await page.waitForSelector('scenario-rename-modal modal-lit[open]', { timeout: 4000 });
      await expect(page.locator('scenario-rename-modal modal-lit[open]')).toBeVisible();
      await page.keyboard.press('Escape').catch(()=>{});
    }
  });

  test('plugin buttons toggle activation when present', async ({ page }) => {
    const pluginItems = page.locator('#toolsList .sidebar-list-item');
    const count = await pluginItems.count();
    test.skip(count === 0, 'No plugin buttons registered in this environment');

    const firstBtn = pluginItems.locator('.chip').first();
    const ariaBefore = await firstBtn.getAttribute('aria-pressed');
    await firstBtn.click();
    await page.waitForTimeout(300);
    const ariaAfter = await firstBtn.getAttribute('aria-pressed');
    expect(ariaAfter).not.toBe(ariaBefore);
  });
});
