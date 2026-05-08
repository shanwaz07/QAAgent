import { test, expect } from '@playwright/test';

test('TC_004 Job Listing Interaction - View Details', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Find Your Next Role' }).click();
  await page.waitForLoadState('networkidle');

  await page.locator('input[placeholder="Job Title, Keywords, or Location"]').fill('Software Engineer');
  await page.locator('input[placeholder="Job Title, Keywords, or Location"]').press('Enter');
  await page.waitForLoadState('networkidle');

  await page.getByRole('link', { name: 'Software Engineer' }).click();
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('div').filter({ hasText: 'Software Engineer' })).toBeVisible();
  await expect(page.locator('div').filter({ hasText: 'Location:' })).toBeVisible();
});