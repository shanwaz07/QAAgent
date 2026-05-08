import { test, expect } from '@playwright/test';

test('TC_002 Verify \'View Job\' handling of jobs with no details - Negative Case', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const searchInputLocator = page.getByRole('textbox');
  await searchInputLocator.fill('developer');
  await searchInputLocator.press('Enter');
  await page.waitForLoadState('networkidle');

  const jobListingLocator = page.locator('div').filter({ hasText: /developer/i }).first();
  const viewJobButtonLocator = jobListingLocator.getByRole('button', { name: 'View Job' });

  await viewJobButtonLocator.click();
  await page.waitForLoadState('networkidle');

  const errorMessageLocator = page.getByText(/Job details are unavailable/i);
  await expect(errorMessageLocator).toBeVisible();
});