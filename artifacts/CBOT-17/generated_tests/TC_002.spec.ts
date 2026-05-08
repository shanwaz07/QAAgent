import { test, expect } from '@playwright/test';

test('TC_002 Test Branching Question Functionality - Text Input', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Are you hiring?' }).click();
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'What type of role are you looking to fill?' }).click();
  await page.waitForLoadState('networkidle');

  await page.getByRole('textbox').fill('Software Engineer');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForLoadState('networkidle');

  await expect(page.getByText('Great! Let\'s dive deeper into the specifics of the Software Engineer role.')).toBeVisible();
});