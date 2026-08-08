import { test, expect } from '@playwright/test';
import { clearOverlays } from './helpers.js';

async function waitForSidebar(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector('app-sidebar');
    return !!(host && host.shadowRoot && host.shadowRoot.querySelector('aside.sidebar'));
  });
}

test.describe('Left Sidebar - Extra coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSidebar(page);
    await clearOverlays(page);
  });

  test('data funnel renders numeric counters', async ({ page }) => {
    const texts = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      return Array.from(root?.querySelectorAll('.dataset-status .status-number') || []).map(
        (el) => (el.textContent || '').trim()
      );
    });
    expect(texts.length).toBe(3);
    for (const t of texts) {
      expect(/^[+\-]?\d+$/.test(String(t).trim())).toBe(true);
    }
  });

  test('display mode changes affect packed-mode sort disabling', async ({ page }) => {
    const clickedPacked = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const packed = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Packed'
      );
      if (!packed) return false;
      packed.click();
      return true;
    });
    expect(clickedPacked).toBe(true);

    await page.waitForFunction(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const rank = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Rank'
      );
      return !!rank && rank.hasAttribute('disabled');
    });

    const clickedNormal = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const normal = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Normal'
      );
      if (!normal) return false;
      normal.click();
      return true;
    });
    expect(clickedNormal).toBe(true);

    await page.waitForFunction(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const rank = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Rank'
      );
      return !!rank && !rank.hasAttribute('disabled');
    });
  });

  test('graph type toggle switches active button', async ({ page }) => {
    const clickedProject = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const btn = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Project'
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    expect(clickedProject).toBe(true);

    await page.waitForFunction(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const btn = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Project'
      );
      return !!btn && btn.classList.contains('active');
    });

    const clickedTeam = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const btn = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Team'
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    expect(clickedTeam).toBe(true);

    await page.waitForFunction(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const btn = Array.from(root?.querySelectorAll('.segment-btn') || []).find(
        (el) => (el.textContent || '').trim() === 'Team'
      );
      return !!btn && btn.classList.contains('active');
    });
  });

  test('task filter option toggles active class when enabled', async ({ page }) => {
    const stateBefore = await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const option = root?.querySelector('.filter-dimensions .filter-option');
      return {
        exists: !!option,
        disabled: !!option && option.classList.contains('disabled'),
        active: !!option && option.classList.contains('active'),
      };
    });

    expect(stateBefore.exists).toBe(true);
    test.skip(stateBefore.disabled, 'First filter option is currently disabled by context');

    await page.evaluate(() => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const option = root?.querySelector('.filter-dimensions .filter-option');
      option?.click();
    });

    await page.waitForFunction((before) => {
      const root = document.querySelector('app-sidebar')?.shadowRoot;
      const option = root?.querySelector('.filter-dimensions .filter-option');
      return !!option && option.classList.contains('active') !== before;
    }, stateBefore.active);
  });
});
