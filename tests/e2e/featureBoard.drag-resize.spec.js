import { expect } from '@playwright/test';
import { test, saveScenarioChanges } from './helpers.js';

test.describe('FeatureBoard drag & resize (e2e)', () => {
  test('moving a card persists scenario dates without changing Baseline', async ({ page, activeScenario }) => {
    const card = page.locator(`feature-card-lit[data-feature-id="${activeScenario.feature.id}"]`);
    await card.scrollIntoViewIfNeeded();
    const initialLeft = await card.evaluate((element) => parseFloat(element.style.left));
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => card.evaluate((element) => parseFloat(element.style.left)))
      .toBeGreaterThan(initialLeft);
    const saved = await saveScenarioChanges(page, activeScenario);
    const dates = saved.overrides[activeScenario.feature.id];
    expect(Date.parse(dates.start)).toBeGreaterThan(Date.parse(activeScenario.start));
    expect(Date.parse(dates.end) - Date.parse(dates.start)).toBe(
      Date.parse(activeScenario.end) - Date.parse(activeScenario.start));
    const response = await page.request.get('/api/tasks');
    expect(response.ok()).toBe(true);
    const tasks = await response.json();
    expect(tasks.find((task) => task.id === activeScenario.feature.id))
      .toMatchObject({ start: activeScenario.feature.start, end: activeScenario.feature.end });
  });
});
