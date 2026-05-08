import { test, expect } from '@playwright/test';

test('TC_003: Invalid Input - Non-Job Related Query', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const findYourNextRoleButton = page.getByRole('button', { name: 'Find Your Next Role' });
  await findYourNextRoleButton.click();
  await page.waitForLoadState('networkidle');

  const chatInput = page.locator('textarea[placeholder="Type your message here..."]');
  await chatInput.fill('What is the weather today?');
  await chatInput.press('Enter');

  await page.waitForLoadState('networkidle');

  const response = page.locator('.message-content');
  await expect(response).toBeVisible();
  const responseText = await response.innerText();

  expect(responseText).toContain('job-related')
});