import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { logger } from '../lib/logger';

const ARTIFACTS_DIR = path.join(__dirname, '../../artifacts');

// ── Login (optional — skipped when APP_USERNAME is not set) ──────

export async function loginToApp(page: Page): Promise<void> {
  const url = process.env.APP_URL || '';
  const username = process.env.APP_USERNAME || '';
  const password = process.env.APP_PASSWORD || '';

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/auth/login')) {
    throw new Error('Login failed — still on login page after submit');
  }
}

// ── Single page snapshot ─────────────────────────────────────────

export async function explorePage(
  url: string,
  pageName: string,
  jiraId: string,
  page: Page,
  io?: { emit: (event: string, data: unknown) => void },
): Promise<string> {
  const snapshotDir = path.join(ARTIFACTS_DIR, jiraId, 'page_snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });
  const outPath = path.join(snapshotDir, `${pageName}.yaml`);

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    // Re-login if session expired — only applies when auth is configured
    const requiresAuth = !!process.env.APP_USERNAME;
    if (requiresAuth && !url.includes('/auth/login') && page.url().includes('/auth/login')) {
      logger.info('PageExplorer', `Session expired navigating to ${pageName} — re-logging in`);
      await loginToApp(page);
      await page.goto(url, { waitUntil: 'networkidle' });
    }

    // ariaSnapshot available in Playwright 1.49+ (replaces removed page.accessibility.snapshot)
    // ref:true embeds [ref=eNN] on each element so LLM-generated locators can reference them
    const rawYaml = await (page as Page & { ariaSnapshot(opts?: { ref?: boolean }): Promise<string> })
      .ariaSnapshot({ ref: true });

    const formatted = formatAccessibilityTree(rawYaml);
    fs.writeFileSync(outPath, formatted, 'utf8');

    logger.info('PageExplorer', `Snapshot saved: ${pageName} (${formatted.split('\n').length} lines)`);
    if (io) io.emit('page_explored', { jiraId, page: pageName, snapshotPath: outPath });

    return formatted;
  } catch (err) {
    const msg = `# ERROR capturing ${pageName}: ${err instanceof Error ? err.message : String(err)}\n`;
    fs.writeFileSync(outPath, msg, 'utf8');
    logger.error('PageExplorer', `Failed to capture ${pageName} — wrote error note`, { error: String(err) });
    return msg;
  }
}

// ── Multi-page exploration ───────────────────────────────────────

export async function explorePages(
  pages: Array<{ url: string; pageName: string }>,
  jiraId: string,
  io?: { emit: (event: string, data: unknown) => void },
): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const requiresAuth = !!process.env.APP_USERNAME;

    if (requiresAuth) {
      // Capture login page pre-auth, then authenticate
      const loginUrl = process.env.APP_URL || '';
      logger.info('PageExplorer', 'Capturing login page snapshot (pre-auth)');
      await explorePage(loginUrl, 'login', jiraId, page, io);
      logger.info('PageExplorer', 'Logging in to app');
      await loginToApp(page);
    }

    // Capture all target pages
    for (const { url, pageName } of pages) {
      logger.info('PageExplorer', `Capturing snapshot: ${pageName}`);
      await explorePage(url, pageName, jiraId, page, io);
    }

    logger.info('PageExplorer', `All snapshots captured for ${jiraId}`);
  } finally {
    await browser.close();
  }
}

// ── Formatter ────────────────────────────────────────────────────

export function formatAccessibilityTree(rawYaml: string): string {
  const lines = rawYaml.split('\n');
  const MAX_LINES = 200;

  const interactiveKeywords = ['button', 'textbox', 'link', 'checkbox', 'combobox', 'menuitem', 'radio', 'option'];
  const interactiveLines = lines.filter(l =>
    interactiveKeywords.some(kw => l.toLowerCase().includes(kw))
  );

  const allLines = lines.slice(0, MAX_LINES);

  const sections: string[] = [];

  if (interactiveLines.length > 0) {
    sections.push('# Interactive Elements:');
    sections.push(...interactiveLines.slice(0, 80));
    sections.push('');
  }

  sections.push(`# All Elements (${lines.length > MAX_LINES ? `truncated to ${MAX_LINES}` : `${lines.length} lines`}):`);
  sections.push(...allLines);

  if (lines.length > MAX_LINES) {
    sections.push(`# ... ${lines.length - MAX_LINES} more lines omitted`);
  }

  return sections.join('\n');
}
