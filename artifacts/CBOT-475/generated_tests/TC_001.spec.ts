import { test, expect } from '@playwright/test';

test('TC_001 Initial Chat Interaction - Valid Query', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Find Your Next Role' }).click();
  await page.waitForLoadState('networkidle');

  await page.getByPlaceholder('Type your question here...').fill('Registered Nurse jobs');
  await page.getByPlaceholder('Type your question here...').press('Enter');

  await page.waitForLoadState('networkidle');

  const response = page.locator('.message-content').last();
  await expect(response).toBeVisible();
  await expect(response).toContain(expect.stringThatMatches(/Registered Nurse|jobs/i));
});