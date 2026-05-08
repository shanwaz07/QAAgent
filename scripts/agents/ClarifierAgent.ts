import { structuredOutput } from '../lib/llmClient';
import { logger } from '../lib/logger';
import type { RagResult } from './RagAgent';

export interface ClarifyQuestion {
  id: string;          // 'scope' | 'browser' | 'known_issues' | 'target_url' | custom
  question: string;
  type: 'text' | 'choice';
  options?: string[];
  required: boolean;
}

interface ClarifierResponse {
  questions: ClarifyQuestion[];
}

// Inspect requirements + RAG context to decide whether the agent has enough information
// to generate a useful test plan. If yes → return []. If no → return up to 4 targeted questions.
//
// The LLM is told to be conservative: only ask when answers will materially change the plan.
// This keeps the conversation short for clear-cut tickets.
export async function generateClarifyingQuestions(
  jiraId: string,
  requirements: Record<string, unknown>,
  ragContext: RagResult[],
  targetUrl: string,
): Promise<ClarifyQuestion[]> {
  logger.info('ClarifierAgent', `Analysing ${jiraId} for clarification gaps`);

  const title = String(requirements.title ?? requirements.summary ?? jiraId);
  const description = String(requirements.description ?? requirements.details ?? '');
  const ragSummary = ragContext.slice(0, 5)
    .map(r => `[${r.jiraId}] ${r.summary}`)
    .join('\n') || '(no related issues)';

  const systemPrompt = `You are a senior QA engineer reviewing a Jira ticket before writing a test plan. Your job is to identify whether you have ENOUGH information to write meaningful tests, and if not, ask the user the smallest possible set of questions to fill the gaps.

Return strict JSON only — no markdown, no commentary.

Rules:
- Return up to 4 questions, fewer is better.
- If the ticket is clear AND a target URL is provided AND the scope is unambiguous, return { "questions": [] }.
- Prefer "choice" type with concrete options when feasible (faster for user to answer).
- Never ask about implementation details, only about test scope and intent.
- Never ask the user to confirm what is already in the ticket.`;

  const userPrompt = `Ticket: ${jiraId}
Title: ${title}
Description: ${description || '(empty)'}
Target URL provided: ${targetUrl ? targetUrl : '(none — APP_URL fallback will be used)'}

Top related project issues (RAG):
${ragSummary}

Decide if you need clarification before writing the test plan. Common gaps that warrant a question:
- Target URL is missing AND the ticket doesn't specify which environment to test
- Description is too short (<30 chars) or generic — scope is unclear
- Multiple flows could be tested (e.g. "test apply flow" — single page or multi-step?)
- Browser/viewport ambiguity for responsive features
- Acceptance criteria not stated — what does "done" look like?

Return JSON in exactly this shape:
{
  "questions": [
    {
      "id": "scope",
      "question": "Which apply flow should I focus on?",
      "type": "choice",
      "options": ["Quick apply (one step)", "Full multi-step apply form", "Both"],
      "required": true
    }
  ]
}

If no clarification is needed, return: { "questions": [] }`;

  try {
    const resp = await structuredOutput<ClarifierResponse>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0, maxTokens: 1024 },
    );

    const questions = Array.isArray(resp?.questions) ? resp.questions.slice(0, 4) : [];
    logger.info('ClarifierAgent', `Returning ${questions.length} question(s) for ${jiraId}`);
    return questions;
  } catch (err) {
    // Non-fatal: if the clarifier fails we just skip clarification and proceed to plan.
    logger.warn('ClarifierAgent', `Failed to generate clarifications, skipping: ${String(err)}`);
    return [];
  }
}
