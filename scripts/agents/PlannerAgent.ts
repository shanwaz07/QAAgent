import fs from 'fs';
import path from 'path';
import { structuredOutput } from '../lib/llmClient';
import { logger } from '../lib/logger';
import type { RagResult } from './RagAgent';

const ARTIFACTS_DIR = path.join(__dirname, '../../artifacts');

export interface TestCase {
  id: string;
  title: string;
  type: 'Positive' | 'Negative' | 'Boundary' | 'Edge';
  priority: 'High' | 'Medium' | 'Low';
  steps: string[];
  expectedResult: string;
  targetPage: string;
}

export interface TestPlan {
  testPlanTitle: string;
  jiraId: string;
  scope: string;
  testTypes: string[];
  riskAreas: string[];
  testCases: TestCase[];
}

export async function generateTestPlan(
  jiraId: string,
  requirements: Record<string, unknown>,
  ragContext: RagResult[],
  io?: { emit: (event: string, data: unknown) => void },
  targetUrl?: string,
  clarifierAnswers?: Record<string, string>,
): Promise<TestPlan> {
  logger.info('PlannerAgent', `Generating test plan for ${jiraId}`);

  const appUrl = targetUrl || process.env.APP_URL || '';
  const title = String(requirements.title ?? requirements.summary ?? jiraId);
  const description = String(requirements.description ?? requirements.details ?? '(no description)');

  const ragSummary = ragContext.slice(0, 10)
    .map(r => `[${r.jiraId}] ${r.type}: ${r.summary} (${r.status})`)
    .join('\n') || '(no related issues found)';

  const clarificationsBlock = clarifierAnswers && Object.keys(clarifierAnswers).length > 0
    ? `\n\nUser clarifications (use these to shape scope and priorities):\n${
        Object.entries(clarifierAnswers).map(([k, v]) => `- ${k}: ${v}`).join('\n')
      }`
    : '';

  const systemPrompt = `You are a senior QA engineer. Generate a structured test plan as valid JSON only — no markdown, no explanation, no code fences.

Application under test: ${appUrl}
This is "Convert" — a conversational AI careersite agent by Leoforce. It helps job seekers find jobs via a chat interface and helps recruiters through candidate rediscovery. The careersite is public — no login required.`;

  const userPrompt = `Generate a test plan for this Jira ticket:

TICKET: ${jiraId}
TITLE: ${title}
DESCRIPTION: ${description}

Related project context (RAG):
${ragSummary}${clarificationsBlock}

Return ONLY this JSON (no markdown):
{
  "testPlanTitle": "string",
  "jiraId": "${jiraId}",
  "scope": "string — what is being tested",
  "testTypes": ["UI"],
  "riskAreas": ["string"],
  "testCases": [
    {
      "id": "TC_001",
      "title": "string",
      "type": "Positive",
      "priority": "High",
      "steps": ["step 1", "step 2"],
      "expectedResult": "string",
      "targetPage": "${appUrl}"
    }
  ]
}

Rules:
- Generate 3–5 test cases covering positive, negative, and edge cases
- targetPage must be a full URL starting with https://
- Each test case needs at least 2 steps
- Focus on UI interactions: chat widget, job search, navigation, form inputs`;

  const plan = await structuredOutput<TestPlan>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0, maxTokens: 2048 },
  );

  const outDir = path.join(ARTIFACTS_DIR, jiraId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'test_plan.json'), JSON.stringify(plan, null, 2), 'utf8');

  logger.info('PlannerAgent', `Test plan saved: ${plan.testCases.length} test cases for ${jiraId}`);
  if (io) io.emit('plan_generated', { jiraId, testPlan: plan });

  return plan;
}
