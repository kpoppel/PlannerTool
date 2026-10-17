import { test, expect } from '@playwright/test';

async function mountShortcuts(page) {
  await page.goto('/js/modules.config.json');
  await page.setContent('<main id="board" tabindex="0">Planning board</main>');
  await page.evaluate(async () => {
    const { store } = await import('/js/application/store.js');
    const { createInitialAppState } = await import('/js/application/createInitialAppState.js');
    const { dataService } = await import('/js/services/dataService.js');
    const { initKeyboardShortcuts } = await import('/js/services/KeyboardShortcuts.js');
    await import('/js/components/ConfigModal.lit.js');
    await import('/js/components/ViewMenu.lit.js');
    const state = createInitialAppState();
    state.view.options.timelineScale = 'months';
    store.setState(state, true);
    await dataService.setLocalPref('user.email', 'shortcuts@example.test');
    window.shortcutManager = await initKeyboardShortcuts();
    window.zoomCalls = [];
    const board = document.createElement('timeline-board');
    board.adjustBoardZoom = (direction) => window.zoomCalls.push(direction);
    board.resetBoardZoom = () => window.zoomCalls.push(0);
    document.body.appendChild(board);
  });
  await page.locator('#board').focus();
}

async function displayState(page) {
  return page.evaluate(async () => {
    const { sel } = await import('/js/application/imports.js');
    return {
      timeline: sel.view.getTimelineScale(),
      cards: sel.view.getDisplayMode(),
      sort: sel.view.getFeatureSortMode(),
      view: sel.view.getTaskViewMode(),
      highlight: sel.view.getHighlightFeatureRelationMode(),
    };
  });
}

test.describe('Board letter shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { ok: true } }));
    await mountShortcuts(page);
  });

  test('uses mnemonic actions but preserves letters typed into Search', async ({ page }) => {
    for (const key of ['t', 'c', 's', 'v', 'h']) await page.keyboard.press(key);
    const expected = { timeline: 'quarters', cards: 'compact', sort: 'date',
      view: 'team', highlight: false };
    expect(await displayState(page)).toEqual(expected);

    await page.keyboard.press('f');
    const input = page.locator('search-tool .search-input');
    await expect(input).toBeFocused();
    await input.pressSequentially('fcsgtvhpair+-');
    await expect(input).toHaveValue('fcsgtvhpair+-');
    expect(await displayState(page)).toEqual(expected);
    await input.press('Escape');
    await expect(page.locator('search-tool')).toHaveCount(0);
  });

  test('cycles filters without changing disabled sidebar options', async ({ page }) => {
    await page.evaluate(async () => {
      await import('/js/components/Sidebar.lit.js');
      document.body.appendChild(document.createElement('app-sidebar'));
    });
    await expect(page.locator('app-sidebar .filter-dimension-title kbd'))
      .toHaveText(['P', 'A', 'I', 'R']);
    const filters = () => page.evaluate(async () => {
      const { sel } = await import('/js/application/imports.js');
      return sel.filter.getTaskFilters();
    });
    for (const [key, dimension, first, second] of [
      ['p', 'schedule', 'planned', 'unplanned'],
      ['a', 'allocation', 'allocated', 'unallocated'],
      ['i', 'hierarchy', 'hasParent', 'noParent'],
      ['r', 'relations', 'hasLinks', 'noLinks'],
    ]) {
      for (const [firstOn, secondOn] of [[true, false], [false, true], [true, true]]) {
        await page.keyboard.press(key);
        expect((await filters())[dimension]).toEqual({ [first]: firstOn, [second]: secondOn });
      }
    }

    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      cmd.filter.setSidebarDisabledElements({ taskFilters: { allocation: ['allocated'] } });
    });
    const allocation = page.locator('app-sidebar .filter-dimension').filter({ hasText: 'Allocation' });
    await expect(allocation.locator('.filter-option').first()).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('a');
    expect((await filters()).allocation).toEqual({ allocated: true, unallocated: false });
    await page.keyboard.press('a');
    expect((await filters()).allocation).toEqual({ allocated: true, unallocated: true });

    await page.evaluate(async () => {
      const { cmd } = await import('/js/application/imports.js');
      cmd.view.setDisplayMode('packed');
    });
    const schedule = page.locator('app-sidebar .filter-dimension').filter({ hasText: 'Schedule' });
    await expect(schedule.locator('.filter-option').last()).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('p');
    expect((await filters()).schedule).toEqual({ planned: true, unplanned: false });
  });

  test('folds and expands one level with minus and plus without changing Ctrl zoom', async ({ page }) => {
    await page.evaluate(async () => {
      const { bus } = await import('/js/core/EventBus.js');
      const { BoardEvents } = await import('/js/core/EventRegistry.js');
      const { buildFoldModel, applyFoldAction } = await import('/js/components/hierarchyFold.js');
      const features = [{ id: 'root', type: 'Epic', process_id: 'process', parentId: null },
        { id: 'child', type: 'Feature', process_id: 'process', parentId: 'root' },
        { id: 'leaf', type: 'Story', process_id: 'process', parentId: 'child' }];
      const display = [{ process_id: 'process', process_name: 'Process',
        tiers: ['Epic', 'Feature', 'Story'].map((name) => [{ name, states: [] }]) }];
      const sections = new Map(features.map((feature) => [feature.id, 'board']));
      let folded = new Set();
      let model = buildFoldModel(features, sections, folded, display);
      const output = document.createElement('output');
      output.id = 'visibleTasks';
      output.textContent = model.visible.map((feature) => feature.id).join(',');
      document.body.appendChild(output);
      bus.on(BoardEvents.FOLD_ACTION, ({ action }) => {
        folded = applyFoldAction(model, folded, action);
        model = buildFoldModel(features, sections, folded, display);
        output.textContent = model.visible.map((feature) => feature.id).join(',');
      });
    });
    const output = page.locator('#visibleTasks');
    await page.keyboard.press('-');
    await expect(output).toHaveText('root,child');
    await page.keyboard.press('-');
    await expect(output).toHaveText('root');
    await page.keyboard.press('-');
    await expect(output).toHaveText('root');
    await page.keyboard.press('Shift+Equal');
    await expect(output).toHaveText('root,child');
    await page.keyboard.press('+');
    await expect(output).toHaveText('root,child,leaf');
    await page.keyboard.press('+');
    await expect(output).toHaveText('root,child,leaf');
    await page.keyboard.press('Control+-');
    expect(await page.evaluate(() => window.zoomCalls)).toEqual([-1]);
    await expect(output).toHaveText('root,child,leaf');
  });

  test('matches sidebar shortcut pills to View menu styling', async ({ page }, testInfo) => {
    await page.addStyleTag({ url: '/css/main.css' });
    await page.evaluate(async () => {
      await import('/js/components/Sidebar.lit.js');
      const { bus } = await import('/js/core/EventBus.js');
      const { BoardEvents } = await import('/js/core/EventRegistry.js');
      const { sel } = await import('/js/application/imports.js');
      const taskTypes = ['Epic', 'Initiative', 'Feature', 'User Story', 'Task'];
      const keys = taskTypes.map((type) => JSON.stringify(['process', type.toLowerCase()]));
      sel.feature.getAvailableTaskTypesOrdered = () => keys;
      sel.feature.getTypeDisplayName = (key) => taskTypes[keys.indexOf(key)];
      sel.feature.getCountsForTeam = () => new Map(keys.map((key) => [key, 1]));
      const sidebar = document.createElement('app-sidebar');
      sidebar._getTeamDrilldownTeams = () => [{ id: 'team-a', name: 'Team A', selected: true }];
      document.body.appendChild(sidebar);
      bus.emit(BoardEvents.FOLD_STATE, {
        active: true, foldedCount: 1, foldableCount: 2, canCollapse: true,
      });
      const menu = document.createElement('view-menu');
      menu.style.cssText = 'position:absolute;left:360px;top:24px;';
      document.body.appendChild(menu);
    });
    const hints = page.locator('app-sidebar .shortcut-pill');
    await expect(hints).toHaveText(['V', '-', '+', 'P', 'A', 'I', 'R']);
    const toggleAlignment = await page.locator('app-sidebar .list-toggle-btn').evaluate((button) => {
      const root = button.getRootNode();
      return {
        button: button.getBoundingClientRect().left,
        team: root.querySelector('.team-drilldown-row').getBoundingClientRect().left,
        heading: root.querySelector('#task-view-label').getBoundingClientRect().left,
      };
    });
    expect(toggleAlignment.button).toBeCloseTo(toggleAlignment.team, 1);
    expect(toggleAlignment.button).toBeCloseTo(toggleAlignment.heading, 1);
    for (const expanded of [false, true]) {
      if (expanded) await page.locator('app-sidebar .team-counts-toggle').click();
      await expect(page.locator('app-sidebar .team-drilldown-header .type-icon'))
        .toHaveCount(expanded ? 5 : 2);
      const headerLayout = await page.locator('app-sidebar').evaluate((sidebar) => {
        const root = sidebar.shadowRoot;
        const button = root.querySelector('.list-toggle-btn').getBoundingClientRect();
        const controls = root.querySelector('.team-counts-toggle').getBoundingClientRect();
        const icons = [...root.querySelectorAll('.team-drilldown-header .type-icon')];
        const badges = [...root.querySelector('.team-drilldown-row').querySelectorAll('.chip-badge')];
        return {
          buttonCenter: button.top + button.height / 2,
          iconCenter: icons[0].getBoundingClientRect().top + icons[0].getBoundingClientRect().height / 2,
          controlsRight: controls.right,
          iconsLeft: icons[0].getBoundingClientRect().left,
          columns: icons.map((icon, index) => {
            const heading = icon.getBoundingClientRect();
            const count = badges[index].getBoundingClientRect();
            return { heading: heading.left + heading.width / 2, count: count.left + count.width / 2 };
          }),
        };
      });
      expect(headerLayout.buttonCenter).toBeCloseTo(headerLayout.iconCenter, 1);
      expect(headerLayout.controlsRight).toBeLessThanOrEqual(headerLayout.iconsLeft);
      for (const column of headerLayout.columns) {
        expect(Math.abs(column.heading - column.count)).toBeLessThanOrEqual(1);
      }
    }
    await page.locator('app-sidebar .team-counts-toggle').click();
    const properties = ['backgroundColor', 'borderColor', 'borderRadius', 'color',
      'fontFamily', 'fontWeight', 'padding', 'textTransform', 'whiteSpace'];
    const expected = await page.locator('view-menu .shortcut-pill').first().evaluate(
      (element, properties) => {
        const style = getComputedStyle(element);
        return Object.fromEntries(properties.map((property) => [property, style[property]]));
      }, properties);
    const actual = await hints.evaluateAll((elements, properties) => elements.map((element) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(properties.map((property) => [property, style[property]]));
    }), properties);
    for (const style of actual) expect(style).toEqual(expected);
    const sizes = await page.locator('.shortcut-pill').evaluateAll((elements) => elements.map((element) => {
      const heading = element.closest('.shortcut-heading, .hierarchy-fold-heading, .display-title');
      const label = heading.classList.contains('hierarchy-fold-heading')
        ? heading.querySelector('.group-label') : heading;
      const text = document.createRange();
      const textNode = [...label.childNodes].find((node) =>
        node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
      text.selectNodeContents(textNode);
      return {
        font: parseFloat(getComputedStyle(element).fontSize),
        headerFont: parseFloat(getComputedStyle(label).fontSize),
        height: element.getBoundingClientRect().height,
        textHeight: text.getBoundingClientRect().height,
      };
    }));
    for (const size of sizes) {
      expect(size.font).toBeCloseTo(size.headerFont * 0.8, 1);
      expect(size.height).toBeLessThanOrEqual(size.textHeight + 1);
    }
    await page.screenshot({ path: testInfo.outputPath('consistent-shortcut-hints.png') });
  });

  test('saves the opt-out across reloads while retaining board zoom', async ({ page }, testInfo) => {
    await page.evaluate(() => document.body.appendChild(document.createElement('config-modal')));
    const checkbox = page.getByRole('checkbox', { name: 'Letter shortcuts' });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await page.locator('config-modal #saveConfigBtn').click();
    await expect(page.locator('config-modal #configStatus')).toContainText('Configuration saved');
    expect(await page.evaluate(() => window.shortcutManager.characterShortcutsEnabled)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('letter-shortcuts-setting.png') });
    await page.locator('config-modal #closeConfigBtn').click();

    await mountShortcuts(page);
    expect(await page.evaluate(() => window.shortcutManager.characterShortcutsEnabled)).toBe(false);
    await page.keyboard.press('f');
    await expect(page.locator('search-tool')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+=');
    expect(await page.evaluate(() => window.zoomCalls)).toEqual([1]);

    await page.evaluate(() => document.body.appendChild(document.createElement('config-modal')));
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await page.locator('config-modal #saveConfigBtn').click();
    await expect(page.locator('config-modal #configStatus')).toContainText('Configuration saved');
    await page.locator('config-modal #closeConfigBtn').click();
    await page.locator('#board').focus();
    await page.keyboard.press('f');
    await expect(page.locator('search-tool .search-input')).toBeFocused();
  });

  test('shows letter hints and leaves menus and modal controls alone', async ({ page }) => {
    await page.evaluate(() => {
      const topMenu = document.createElement('top-menu-bar');
      const menu = document.createElement('view-menu');
      topMenu.attachShadow({ mode: 'open' }).appendChild(menu);
      document.body.appendChild(topMenu);
    });
    await expect(page.locator('view-menu kbd')).toHaveText(['T', 'C', 'S', 'G']);
    const before = await displayState(page);
    await page.locator('view-menu button').first().focus();
    await page.keyboard.press('c');
    expect(await displayState(page)).toEqual(before);

    await page.evaluate(() => document.body.appendChild(document.createElement('config-modal')));
    await page.locator('config-modal #closeConfigBtn').focus();
    await page.keyboard.press('f');
    await expect(page.locator('search-tool')).toHaveCount(0);
  });
});