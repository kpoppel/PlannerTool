export async function clearOverlays(page) {
  await page.evaluate(() => {
    const overlaySelectors = ['onboarding-modal', '.onboarding-modal', '#onboardingModal', '.modal-backdrop', '#appSpinner', '.modal-spinner', '.overlay', '.onboarding-overlay'];
    overlaySelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.remove());
    });
  });
  // Allow any UI to settle
  await page.waitForTimeout(100);
}
