import { test, expect } from '@playwright/test';

test('TC_003 Verify Template Saving with Required Details', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  await page.locator('button[aria-label="Find Talent"]').click();
  await page.waitForLoadState('networkidle');

  await page.locator('button').nth(0).click();
  await page.waitForLoadState('networkidle');

  await page.locator('button[aria-label="Save"]').click();
  await page.waitForLoadState('networkidle');

  await expect(page.locator('div[role="alert"]').getByText('Please fill in all required fields.')).toBeVisible();
});