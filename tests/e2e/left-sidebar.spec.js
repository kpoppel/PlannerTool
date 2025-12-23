import { test, expect } from '@playwright/test';

test.describe('Left Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'http://localhost:8000');
    // ensure app finished loading and storage state is applied
    await page.waitForSelector('app-sidebar');
  });

  test('renders sidebar and server status', async ({ page }) => {
    const sidebar = await page.locator('app-sidebar');
    await expect(sidebar).toBeVisible();

    const status = await page.locator('#serverStatusLabel');
    await expect(status).toBeVisible();
    const text = await status.textContent();
    expect(text).toBeTruthy();
  });

  test('project and team collapsible toggles work', async ({ page }) => {
    const projectToggle = page.locator('#projectToggleBtn');
    const teamToggle = page.locator('#teamToggleBtn');

    await expect(projectToggle).toBeVisible();
    await expect(teamToggle).toBeVisible();

    // Click project toggle and expect the button text to change between 'All' and 'None'
    const beforeText = (await projectToggle.textContent()).trim();
    await projectToggle.click();
    const afterText = (await projectToggle.textContent()).trim();
    expect(afterText).not.toBe(beforeText);

    // Click team toggle similarly (text flips between 'All' and 'None')
    const teamBeforeText = (await teamToggle.textContent()).trim();
    await teamToggle.click();
    const teamAfterText = (await teamToggle.textContent()).trim();
    expect(teamAfterText).not.toBe(teamBeforeText);
  });

  test('project chips toggle selection', async ({ page }) => {
    const projectList = page.locator('#projectList');
    await expect(projectList).toBeVisible();

    const firstChip = projectList.locator('.chip').first();
    const firstInput = projectList.locator('input[data-project]').first();
    await expect(firstChip).toBeVisible();
    const wasChecked = await firstInput.isChecked();
    await firstChip.click();
    const nowChecked = await firstInput.isChecked();
    expect(nowChecked).not.toBe(wasChecked);
  });

  test('scenario menu opens and config/help buttons open modals', async ({ page }) => {
    const scenarioList = page.locator('#scenarioList');
    await expect(scenarioList).toBeVisible();

    const firstScenario = scenarioList.locator('.scenario-item').first();
    await expect(firstScenario).toBeVisible();

    const menuBtn = firstScenario.locator('.scenario-controls .scenario-btn');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();

    // menu should append to body or appear nearby
    const menu = page.locator('.scenario-menu-popover').first();
    await expect(menu).toBeVisible();

    // config/help buttons
    const openConfig = page.locator('#openConfigBtn');
    const openHelp = page.locator('#openHelpBtn');
    await expect(openConfig).toBeVisible();
    await expect(openHelp).toBeVisible();

    await openConfig.click();
    // config modal exposes an input with id #configEmail in the UI
    await page.waitForSelector('#configEmail', { timeout: 3000 });
    const cfgEmail = page.locator('#configEmail').first();
    await expect(cfgEmail).toBeVisible();
    // close it with Escape
    await page.keyboard.press('Escape').catch(() => {});

    await openHelp.click();
    // help modal renders .help-content
    await page.waitForSelector('.help-content', { timeout: 3000 });
    const helpModal = page.locator('.help-content').first();
    await expect(helpModal).toBeVisible();
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('color dot opens color popover', async ({ page }) => {
    const colorDot = page.locator('.color-dot').first();
    await expect(colorDot).toBeVisible();
    await colorDot.click();

    // Color popover may be appended to body; look for ColorPopoverLit or palette container
    const popInner = page.locator('color-popover .color-popover, .color-popover').first();
    await expect(popInner).not.toHaveCSS('display', 'none', { timeout: 3000 });
  });
});
