import { test, expect } from '@playwright/test';

test('TC_005 Verify List Display with Large Number of Jobs - Edge Case', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const chatButton = page.getByRole('button', { name: 'Find Your Next Role' });
  await chatButton.click();
  await page.waitForSelector('textarea[placeholder="Type your message here..."]');

  for (let i = 0; i < 25; i++) {
    const jobTitle = `Job Title ${i + 1}`;
    await page.getByRole('textbox').type(jobTitle);
    await page.getByRole('button', { name: 'Apply Now' }).click();
    await page.waitForTimeout(500);
  }

  await page.getByRole('textbox').type('What jobs have I applied for?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.waitForSelector('.message-content');

  await page.getByRole('textbox').type('What jobs have I saved?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.waitForSelector('.message-content');

  const appliedJobsList = page.locator('.message-content').getByText(/Job Title/);
  const appliedJobsCount = await appliedJobsList.count();
  expect(appliedJobsCount).toBeGreaterThanOrEqual(20);
});