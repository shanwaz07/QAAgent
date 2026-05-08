import { test, expect } from '@playwright/test';

test('TC_004: Test UI Responsiveness with Multiple Branching Questions', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Are you looking for a job?' }).click();
  await page.waitForLoadState('networkidle');

  for (let i = 0; i < 12; i++) {
    const branchingQuestionButton = page.locator('button');
    await branchingQuestionButton.nth(i).click();
    await page.waitForLoadState('networkidle');
  }

  await page.evaluate(() => {
    const chatWindow = document.querySelector('.chat-window');
    if (chatWindow) {
      chatWindow.scrollTop = chatWindow.scrollHeight;
    }
  });

  await page.waitForTimeout(1000);

  const scrollHeight = await page.evaluate(() => {
    const chatWindow = document.querySelector('.chat-window');
    return chatWindow ? chatWindow.scrollHeight : 0;
  });

  expect(scrollHeight).toBeGreaterThan(0);
});