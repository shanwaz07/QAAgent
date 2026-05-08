import { test, expect } from '@playwright/test';

test('TC_003 Verify \'View Job\' button functionality after multiple searches - Edge Case', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const findYourNextRoleButton = page.getByRole('button', { name: 'Find Your Next Role' });
  await findYourNextRoleButton.click();
  await page.waitForLoadState('networkidle');

  const jobSearchInput = page.getByPlaceholder('Job Title, Skills, or Company');
  await jobSearchInput.fill('Data Scientist');
  await page.waitForLoadState('networkidle');

  const firstJobViewButton = page.getByRole('button', { name: 'View Job' });
  await firstJobViewButton.click();
  await page.waitForLoadState('networkidle');

  await page.goBack();
  await page.waitForLoadState('networkidle');

  await jobSearchInput.fill('Marketing Manager');
  await page.waitForLoadState('networkidle');

  const secondJobViewButton = page.getByRole('button', { name: 'View Job' });
  await secondJobViewButton.click();
  await page.waitForLoadState('networkidle');

  const currentUrl = page.url();
  expect(currentUrl).not.toContain('0');
});