import { test, expect } from '@playwright/test';

test('TC_004 Verify \'View Job\' button behavior with long job titles - Edge Case', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const searchInput = page.getByRole('textbox');
  await searchInput.fill('developer');
  await searchInput.press('Enter');
  await page.waitForLoadState('networkidle');

  const jobListing = page.locator('text=Developer - Senior Software Engineer - Leading Innovation in Cutting-Edge Technologies - A Highly Challenging and Rewarding Role with Significant Growth Potential');
  const viewJobButton = jobListing.getByRole('link', { name: 'View Job' });
  await viewJobButton.click();
  await page.waitForLoadState('networkidle');

  const currentUrl = page.url();
  expect(currentUrl).not.toContain('0');

  const jobTitleOnDetailsPage = page.getByRole('heading', { level: 1 });
  expect(await jobTitleOnDetailsPage.textContent()).toBe('Developer - Senior Software Engineer - Leading Innovation in Cutting-Edge Technologies - A Highly Challenging and Rewarding Role with Significant Growth Potential');
});