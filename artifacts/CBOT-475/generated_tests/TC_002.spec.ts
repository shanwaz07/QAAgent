import { test, expect } from '@playwright/test';

test('TC_002 No Jobs Found - Handling Empty Results', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Find Your Next Role' }).click();
  await page.waitForLoadState('networkidle');

  await page.locator('input[placeholder="Job Title, Skills, Company"]').fill('Unicorn Wrangler jobs');
  await page.locator('button[aria-label="Search"]').click();
  await page.waitForLoadState('networkidle');

  const noResultsMessage = page.getByText('No jobs found matching your criteria.');
  await expect(noResultsMessage).toBeVisible();

  const suggestionText = page.getByText('Try broadening your search or using different keywords.');
  await expect(suggestionText).toBeVisible();
});