import { test, expect } from '@playwright/test';

test('TC_001 Verify \'Applied Jobs\' List Retrieval - Positive Case', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Find Your Next Role' }).click();
  await page.waitForLoadState('networkidle');

  const chatInputLocator = page.locator('textarea[placeholder="Type your message here..."]');
  await chatInputLocator.fill('What jobs have I applied for?');
  await chatInputLocator.press('Enter');

  await page.waitForTimeout(5000);

  const chatResponseLocator = page.locator('.message-content');
  const chatResponseText = await chatResponseLocator.last().textContent();

  await expect(chatResponseText).not.toBeNull();
  await expect(chatResponseText).toContain('Here are the jobs you have applied for');
});