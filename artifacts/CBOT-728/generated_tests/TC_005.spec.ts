import { test, expect } from '@playwright/test';

test('TC_005 Verify \'View Job\' button is disabled when no jobs are found - Negative Case', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const searchInputLocator = page.getByRole('textbox');
  await searchInputLocator.fill('zzzzzz');
  await searchInputLocator.press('Enter');
  await page.waitForLoadState('networkidle');

  const noJobsMessage = page.getByText('No jobs found');
  await expect(noJobsMessage).toBeVisible();

  const viewJobButton = page.getByRole('button', { name: 'View Job' });
  await expect(viewJobButton).not.toBeVisible();
});