import { test, expect } from '@playwright/test';

test('TC_001 Verify Chat Widget Initialization and Basic Interaction', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const chatWidget = page.getByText('ABC STAFFING Advisor');
  await expect(chatWidget).toBeVisible();

  const chatInput = page.getByRole('textbox');
  await chatInput.fill('Hello');
  await chatInput.press('Enter');

  await page.waitForTimeout(2000);

  const responseMessage = page.getByText('I can help you with:', { exact: false });
  await expect(responseMessage).toBeVisible();
});