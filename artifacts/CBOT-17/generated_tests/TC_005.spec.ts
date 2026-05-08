import { test, expect } from '@playwright/test';

test('TC_005 Verify Navigation to Follow-up Question in Collapsed Mode', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Are you hiring?' }).click();
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Yes' }).click();
  await page.waitForLoadState('networkidle');

  await page.locator('text=What type of role are you looking to fill?').click();
  await page.waitForLoadState('networkidle');

  await page.locator('text=Full-time').click();
  await page.waitForLoadState('networkidle');

  const followUpQuestionVisible = await page.locator('text=What is the seniority level of this role?').isVisible();
  expect(followUpQuestionVisible).toBe(true);
});