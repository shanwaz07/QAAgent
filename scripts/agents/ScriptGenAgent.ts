import fs from 'fs';
import path from 'path';
import { chat } from '../lib/llmClient';
import { logger } from '../lib/logger';
import type { TestCase } from './PlannerAgent';

const ARTIFACTS_DIR = path.join(__dirname, '../../artifacts');

export async function generateScript(
  jiraId: string,
  testCase: TestCase,
  snapshot: string,
  io?: { emit: (event: string, data: unknown) => void },
): Promise<string> {
  logger.info('ScriptGenAgent', `Generating script for ${testCase.id}: ${testCase.title}`);

  const systemPrompt = `You are a Playwright TypeScript test automation engineer. Generate a complete, runnable .spec.ts file. Return ONLY the TypeScript code — no markdown code fences, no explanation, no comments about what you're doing.`;

  const userPrompt = `Generate a Playwright spec for this test case.

TEST CASE:
ID: ${testCase.id}
Title: ${testCase.title}
Type: ${testCase.type}
Priority: ${testCase.priority}
Steps:
${testCase.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Expected Result: ${testCase.expectedResult}

TARGET PAGE: ${testCase.targetPage}

DOM ACCESSIBILITY SNAPSHOT (use these element names for locators):
${snapshot}

STRICT RULES:
- Start with exactly: import { test, expect } from '@playwright/test';
- No other imports
- No Page Object Model classes
- No login steps — this is a public careersite with no authentication
- Derive locators from the snapshot: getByRole(), getByText(), getByLabel()
- Call page.waitForLoadState('networkidle') after page.goto()
- Each numbered step in the test case must become a Playwright action
- Add at least one expect() assertion matching the expected result
- The test must be self-contained with no external dependencies

Return ONLY valid TypeScript starting with: import { test, expect } from '@playwright/test';`;

  const raw = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.1, maxTokens: 2048 },
  );

  // Strip any accidental markdown fencing the LLM adds
  const code = raw
    .replace(/^```(?:typescript|ts)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  const outDir = path.join(ARTIFACTS_DIR, jiraId, 'generated_tests');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${testCase.id}.spec.ts`);
  fs.writeFileSync(outPath, code, 'utf8');

  logger.info('ScriptGenAgent', `Script saved: ${testCase.id}.spec.ts`);
  if (io) io.emit('script_generated', { jiraId, tcId: testCase.id, scriptPath: outPath });

  return code;
}

export async function generateAllScripts(
  jiraId: string,
  testCases: TestCase[],
  io?: { emit: (event: string, data: unknown) => void },
): Promise<string[]> {
  const snapshotDir = path.join(ARTIFACTS_DIR, jiraId, 'page_snapshots');
  const scriptPaths: string[] = [];

  // Preload available snapshots
  const availableSnapshots = fs.existsSync(snapshotDir) ? fs.readdirSync(snapshotDir) : [];

  for (const tc of testCases) {
    // Match targetPage URL → pageName → snapshot file
    const pageName = tc.targetPage
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    const exactPath = path.join(snapshotDir, `${pageName}.yaml`);
    let snapshot = '(no snapshot available — use generic Playwright locators)';

    if (fs.existsSync(exactPath)) {
      snapshot = fs.readFileSync(exactPath, 'utf8');
    } else if (availableSnapshots.length > 0) {
      // Fall back to any available snapshot (same app, same DOM structure)
      snapshot = fs.readFileSync(path.join(snapshotDir, availableSnapshots[0]!), 'utf8');
    }

    await generateScript(jiraId, tc, snapshot, io);
    scriptPaths.push(path.join(ARTIFACTS_DIR, jiraId, 'generated_tests', `${tc.id}.spec.ts`));
  }

  logger.info('ScriptGenAgent', `Generated ${scriptPaths.length} scripts for ${jiraId}`);
  return scriptPaths;
}
