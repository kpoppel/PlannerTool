import { expect } from '@playwright/test';
import { test, saveScenarioChanges, activateScenario } from './helpers.js';

test.describe('DragManager resize (e2e)', () => {
  for (const policy of ['keep-allocation', 'keep-effort']) {
    test(`${policy} resizing persists its end date without changing Baseline`, async ({ page, activeScenario }) => {
      const card = page.locator(`feature-card-lit[data-feature-id="${activeScenario.feature.id}"]`);
      await card.scrollIntoViewIfNeeded();
      const initialWidth = await card.evaluate((element) => parseFloat(element.style.width));
      const box = await card.locator(`[data-resize-policy="${policy}"]`).boundingBox();
      expect(box).not.toBeNull();
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 80, startY, { steps: 12 });
      await page.mouse.up();
      await expect.poll(() => card.evaluate((element) => parseFloat(element.style.width)))
        .toBeGreaterThan(initialWidth);
      const saved = await saveScenarioChanges(page, activeScenario);
      const dates = saved.overrides[activeScenario.feature.id];
      expect(dates.start).toBe(activeScenario.start);
      expect(Date.parse(dates.end)).toBeGreaterThan(Date.parse(activeScenario.end));
      await activateScenario(page, activeScenario);
      await expect(card).toBeVisible();
      const reloaded = await card.evaluate((element) => {
        const feature = element.feature;
        return { start: feature.start, end: feature.end, capacity: feature.capacity };
      });
      expect(reloaded.start).toBe(dates.start);
      expect(reloaded.end).toBe(dates.end);
      if (dates.capacity !== undefined) expect(reloaded.capacity).toEqual(dates.capacity);
      const response = await page.request.get('/api/tasks');
      expect(response.ok()).toBe(true);
      const tasks = await response.json();
      expect(tasks.find((task) => task.id === activeScenario.feature.id))
        .toMatchObject({ start: activeScenario.feature.start, end: activeScenario.feature.end });
    });
  }
});
