import { test, expect } from '@playwright/test';

test('TC_003 Verify No Jobs Applied/Saved - Negative Case', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const chatButton = page.getByRole('button', { name: 'Find Your Next Role' });
  await chatButton.click();
  await page.waitForLoadState('networkidle');

  await page.locator('textarea').type('What jobs have I applied for?');
  await page.locator('button').click();
  await page.waitForLoadState('networkidle');

  const appliedJobsResponse = page.locator('div').filter({ hasText: /no jobs have been applied for/i });
  expect(appliedJobsResponse).toBeVisible();

  await page.locator('textarea').type('What jobs have I saved?');
  await page.locator('button').click();
  await page.waitForLoadState('networkidle');

  const savedJobsResponse = page.locator('div').filter({ hasText: /no jobs have been saved/i });
  expect(savedJobsResponse).toBeVisible();
});