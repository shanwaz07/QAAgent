import { test, expect } from '@playwright/test';

test('TC_001 Verify \'View Job\' redirects to valid job details page - Positive Case', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const findYourNextRoleButton = page.getByRole('button', { name: 'Find Your Next Role' });
  await findYourNextRoleButton.click();
  await page.waitForLoadState('networkidle');

  const searchInput = page.getByPlaceholder('Job Title, Skills, Company');
  await searchInput.fill('Sales Agent');
  await searchInput.press('Enter');
  await page.waitForLoadState('networkidle');

  const firstJobViewButton = page.locator('div').filter({ hasText: 'Sales Agent'}).getByRole('button', { name: 'View Job' });
  await firstJobViewButton.click();
  await page.waitForLoadState('networkidle');

  const currentUrl = page.url();
  expect(currentUrl).not.toContain('0');
});