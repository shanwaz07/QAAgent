import { test, expect } from '@playwright/test';

test('TC_004 Verify Handling of Ambiguous Query - Edge Case', async ({ page }) => {
  await page.goto('https://leolity-qa.goarya.com/demo-staffing/home');
  await page.waitForLoadState('networkidle');

  const chatButton = page.getByRole('button', { name: 'Get in touch' });
  await chatButton.click();

  await page.waitForSelector('textarea[placeholder="Type your message here..."]');
  const chatInput = page.locator('textarea[placeholder="Type your message here..."]');
  await chatInput.fill('My jobs?');
  await chatInput.press('Enter');

  await page.waitForSelector('div[class*="message-content"]');
  const chatResponse = page.locator('div[class*="message-content"]').last();
  const responseText = await chatResponse.textContent();

  expect(responseText).not.toBeNull();
  expect(responseText).not.toContain('I don\'t understand');
  expect(responseText).not.toContain('error');
  expect(responseText).toContain('Do you mean') || expect(responseText).toContain('applied jobs') || expect(responseText).toContain('saved jobs');
});