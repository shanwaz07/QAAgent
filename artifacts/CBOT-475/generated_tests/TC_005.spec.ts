import { test, expect } from '@playwright/test';

test('TC_005 Chat Widget Responsiveness - Multiple Queries', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const chatButton = page.getByText('Get in touch');
  await chatButton.click();

  await page.waitForSelector('textarea[placeholder="Type your message here..."]');

  const chatInput = page.locator('textarea[placeholder="Type your message here..."]');
  await chatInput.fill('Data Scientist');
  await chatInput.press('Enter');

  await page.waitForTimeout(1000);

  await chatInput.fill('Project Manager');
  await chatInput.press('Enter');

  await page.waitForTimeout(1000);

  await chatInput.fill('Marketing Specialist');
  await chatInput.press('Enter');

  await page.waitForTimeout(2000);

  const chatHistory = page.locator('.chat-messages');
  await expect(chatHistory).toBeVisible();

  const dataScientistMessage = page.getByText('Data Scientist');
  await expect(dataScientistMessage).toBeVisible();

  const projectManagerMessage = page.getByText('Project Manager');
  await expect(projectManagerMessage).toBeVisible();

  const marketingSpecialistMessage = page.getByText('Marketing Specialist');
  await expect(marketingSpecialistMessage).toBeVisible();
});