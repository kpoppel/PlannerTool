import { expect } from '@playwright/test';

export async function clearOverlays(page) {
  await page.evaluate(() => {
    const overlaySelectors = [
      'onboarding-modal',
      '.onboarding-modal',
      '#onboardingModal',
      '.modal-backdrop',
      '#appSpinner',
      '.modal-spinner',
      '.overlay',
      '.onboarding-overlay',
    ];
    overlaySelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    });
  });
  // Allow any UI to settle
  await page.waitForTimeout(100);
}

export async function waitForFeatureCards(page, timeout = 30000) {
  const timelineRegion = page.getByRole('region', { name: 'Timeline and Features' });
  await expect(timelineRegion).toBeVisible({ timeout });
  await expect(page.locator('feature-card-lit').first()).toBeVisible({ timeout });
}
