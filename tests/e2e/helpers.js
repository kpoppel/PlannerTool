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

export async function selectAllPlans(page) {
  const planButton = page.getByRole('button', { name: /^Plan(?:\s|$)/ });
  await expect(planButton).toBeVisible();
  await planButton.click();

  const toggle = page.locator('plan-menu').getByTitle('Select all / Clear all projects');
  await expect(toggle).toBeVisible();
  if ((await toggle.textContent()).trim() === 'All') {
    await toggle.click();
  } else {
    await planButton.click();
  }
}

export async function waitForFeatureCards(page, timeout = 30000) {
  await selectAllPlans(page);
  const timelineRegion = page.getByRole('region', { name: 'Timeline and Features' });
  await expect(timelineRegion).toBeVisible({ timeout });
  await expect(page.locator('feature-card-lit').first()).toBeVisible({ timeout });
}
