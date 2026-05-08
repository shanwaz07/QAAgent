import fs from 'fs';
import path from 'path';
import { embedDocument, embedQuery } from '../lib/embedder';
import { createCollection, recreateCollection, upsertBatch, query, deletePoint } from '../lib/vectorStore';
import { extractText, syncProject, shouldIndex } from './JiraAgent';
import type { JiraIssue } from '../lib/jiraClient';
import { logger } from '../lib/logger';

const COLLECTION = 'jira_issues';
const PROGRESS_FILE = path.join(__dirname, '../../artifacts/rag/index_progress.json');

// ── Progress tracking ────────────────────────────────────────────

function loadProgress(): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) as string[];
    return new Set(data);
  } catch {
    return new Set();
  }
}

function saveProgress(indexed: Set<string>): void {
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...indexed]));
}

// ── Index Builder ────────────────────────────────────────────────

export async function buildIndex(projectKey: string, issues?: JiraIssue[], force = false): Promise<number> {
  const allIssues = issues ?? (await syncProject(projectKey));

  const indexed = loadProgress();
  const isResume = !force && indexed.size > 0;

  if (isResume) {
    // Resuming an interrupted full sync — don't drop the collection
    await createCollection(COLLECTION);
    console.log(`[RagAgent] Resuming — ${indexed.size} already indexed, ${allIssues.length - indexed.size} remaining`);
  } else {
    // Fresh full sync — wipe progress file and recreate collection to purge stale vectors
    saveProgress(new Set());
    await recreateCollection(COLLECTION);
    console.log(`[RagAgent] Full sync — embedding ${allIssues.length} issues...`);
  }

  const toIndex = allIssues.filter(i => !indexed.has(i.key));

  // Free tier: 100 req/min — pause 65s every 85 embeddings
  const RATE_LIMIT_BATCH = 85;
  const RATE_LIMIT_PAUSE = 65000;
  const UPSERT_CHUNK = 10;

  const points: { id: number; vector: number[]; payload: Record<string, unknown> }[] = [];
  let batchCount = 0;

  for (let i = 0; i < toIndex.length; i++) {
    const issue = toIndex[i]!;
    const text = extractText(issue);

    // Skip issues with no meaningful content beyond the key+type+summary line.
    // These pollute the index with indistinguishable vectors (e.g. "Code changes", "Dev Testing").
    if (!hasSubstantiveContent(issue)) {
      indexed.add(issue.key); // mark as processed so resume skips them too
      process.stdout.write(`\r[RagAgent] Skipped (no content) ${indexed.size + i + 1}/${allIssues.length}: ${issue.key}`);
      continue;
    }

    const vector = await embedDocument(text);

    points.push({
      id: stableId(issue.key),
      vector,
      payload: {
        jiraId: issue.key,
        summary: issue.fields.summary,
        type: issue.fields.issuetype?.name ?? '',
        status: issue.fields.status?.name ?? '',
        labels: issue.fields.labels ?? [],
        components: (issue.fields.components ?? []).map(c => c.name),
        text,
      },
    });

    batchCount++;
    process.stdout.write(`\r[RagAgent] Embedded ${indexed.size + i + 1}/${allIssues.length}`);

    // Upsert + save progress every UPSERT_CHUNK
    if (points.length >= UPSERT_CHUNK) {
      await upsertBatch(COLLECTION, points.splice(0, UPSERT_CHUNK));
      toIndex.slice(Math.max(0, i - UPSERT_CHUNK + 1), i + 1).forEach(iss => indexed.add(iss.key));
      saveProgress(indexed);
    }

    // Rate limit pause every RATE_LIMIT_BATCH
    if (batchCount % RATE_LIMIT_BATCH === 0 && i + 1 < toIndex.length) {
      process.stdout.write(`\n[RagAgent] Rate limit pause (65s)...`);
      await new Promise(r => setTimeout(r, RATE_LIMIT_PAUSE));
    }
  }

  // Flush remaining
  if (points.length > 0) {
    await upsertBatch(COLLECTION, points);
    toIndex.slice(toIndex.length - points.length).forEach(iss => indexed.add(iss.key));
    saveProgress(indexed);
  }

  console.log(`\n[RagAgent] Index build complete. Total indexed: ${indexed.size}`);
  return allIssues.length;
}

// ── Delta Index (re-embed issues updated since a given timestamp) ─

export async function deltaIndex(projectKey: string, since: Date): Promise<number> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const jqlDate = `${since.getFullYear()}/${pad(since.getMonth() + 1)}/${pad(since.getDate())} ${pad(since.getHours())}:${pad(since.getMinutes())}`;

  // Fetch ALL updated issue types so we can catch demotions (e.g. Story moved to To Do)
  const jql = `project = ${projectKey} AND issuetype in (Task, "Sub-task", Bug, Story, Epic) AND updated >= "${jqlDate}" ORDER BY updated DESC`;

  logger.info('RagAgent', `Delta sync — fetching issues updated since ${jqlDate}`);
  const { fetchIssues: fetchJiraIssues } = await import('../lib/jiraClient');
  const updated = await fetchJiraIssues(jql);

  if (updated.length === 0) {
    logger.info('RagAgent', 'Delta sync — no changes found, index is up to date');
    return 0;
  }

  logger.info('RagAgent', `Delta sync — ${updated.length} issue(s) changed`);
  await createCollection(COLLECTION);

  const indexed = loadProgress();
  let upserted = 0;
  let deleted = 0;
  const SAVE_EVERY = 5;

  for (const issue of updated) {
    try {
      if (shouldIndex(issue) && hasSubstantiveContent(issue)) {
        // Indexable and has meaningful content — embed and upsert
        const text = extractText(issue);
        const vector = await embedDocument(text);
        await upsertBatch(COLLECTION, [{
          id: stableId(issue.key),
          vector,
          payload: {
            jiraId: issue.key,
            summary: issue.fields.summary,
            type: issue.fields.issuetype?.name ?? '',
            status: issue.fields.status?.name ?? '',
            labels: issue.fields.labels ?? [],
            components: (issue.fields.components ?? []).map(c => c.name),
            text,
          },
        }]);
        indexed.add(issue.key);
        upserted++;
        logger.info('RagAgent', `Delta upserted ${upserted}: ${issue.key}`);
      } else {
        // No longer indexable (e.g. Story moved to To Do) — remove from index
        if (indexed.has(issue.key)) {
          await deletePoint(COLLECTION, stableId(issue.key));
          indexed.delete(issue.key);
          deleted++;
          logger.info('RagAgent', `Delta removed ${issue.key} (${issue.fields.issuetype?.name} / ${issue.fields.status?.name})`);
        }
      }

      if ((upserted + deleted) % SAVE_EVERY === 0) saveProgress(indexed);
    } catch (err) {
      logger.error('RagAgent', `Failed to process ${issue.key} — skipping`, { error: String(err) });
    }
  }

  saveProgress(indexed);
  logger.info('RagAgent', `Delta sync complete — ${upserted} upserted, ${deleted} removed`);
  return upserted + deleted;
}

// ── 4-Layer Query ────────────────────────────────────────────────

export interface RagResult {
  jiraId: string;
  summary: string;
  type: string;
  status: string;
  labels: string[];
  components: string[];
  text: string;
  score: number;
}

// With RETRIEVAL_QUERY + RETRIEVAL_DOCUMENT task types, gemini-embedding-001 scores:
//   Highly relevant  → 0.68–0.80
//   Somewhat relevant → 0.63–0.68
//   Noise floor       → below 0.62
// Layer 1 scores below this → skip expansion layers (would only amplify noise)
const EXPANSION_QUALITY_THRESHOLD = 0.67;
// Never return results below this score — anything under 0.62 is noise
const MIN_RETURN_SCORE = 0.62;

export async function ragQuery(userInput: string, topK = 30): Promise<RagResult[]> {
  const queryVec = await embedQuery(userInput);

  // Layer 1: flat top-K cosine similarity
  const layer1 = await query(COLLECTION, queryVec, topK);
  const seen = new Set(layer1.map(r => String(r.id)));
  const results = [...layer1];

  const bestScore = layer1[0]?.score ?? 0;
  const qualityOk = bestScore >= EXPANSION_QUALITY_THRESHOLD;

  // Layer 2: label/component expansion — only when Layer 1 quality is good
  // and labels/components actually exist (otherwise expansion adds noise)
  if (qualityOk) {
    const expandLabels = new Set<string>();
    const expandComponents = new Set<string>();
    for (const r of layer1) {
      for (const l of (r.payload['labels'] as string[] | undefined) ?? []) expandLabels.add(l);
      for (const c of (r.payload['components'] as string[] | undefined) ?? []) expandComponents.add(c);
    }

    if (expandLabels.size > 0 || expandComponents.size > 0) {
      const layer2 = await query(COLLECTION, queryVec, topK * 3);
      for (const r of layer2) {
        if (seen.has(String(r.id))) continue;
        const rLabels = (r.payload['labels'] as string[] | undefined) ?? [];
        const rComps = (r.payload['components'] as string[] | undefined) ?? [];
        if (rLabels.some(l => expandLabels.has(l)) || rComps.some(c => expandComponents.has(c))) {
          results.push(r);
          seen.add(String(r.id));
        }
      }
    }
  }

  // Layer 3: semantic second-hop — only when quality is good AND the seed text is
  // substantive (>80 chars). Short generics like "Code changes" produce pure noise.
  if (qualityOk) {
    for (const hop of layer1.slice(0, 5)) {
      const hopText = (hop.payload['text'] as string | undefined) ?? '';
      if (hopText.length <= 80) continue; // skip trivially short seeds
      const hopVec = await embedQuery(hopText);
      for (const r of await query(COLLECTION, hopVec, 10)) {
        if (!seen.has(String(r.id))) { results.push(r); seen.add(String(r.id)); }
      }
    }
  }

  // Layer 4: module keyword spike — always runs (keyword-driven, not seeded from noisy results)
  const modules = extractModuleKeywords(userInput);
  if (modules.length > 0) {
    const modVec = await embedQuery(modules.join(' '));
    for (const r of await query(COLLECTION, modVec, 20)) {
      if (!seen.has(String(r.id))) { results.push(r); seen.add(String(r.id)); }
    }
  }

  results.sort((a, b) => b.score - a.score);

  // Drop results below the minimum return threshold — a low-score result is noise,
  // returning it gives the agent false context which is worse than returning nothing
  const filtered = results.filter(r => r.score >= MIN_RETURN_SCORE);

  return filtered.slice(0, topK).map(r => ({
    jiraId: String(r.payload['jiraId'] ?? ''),
    summary: String(r.payload['summary'] ?? ''),
    type: String(r.payload['type'] ?? ''),
    status: String(r.payload['status'] ?? ''),
    labels: (r.payload['labels'] as string[] | undefined) ?? [],
    components: (r.payload['components'] as string[] | undefined) ?? [],
    text: String(r.payload['text'] ?? ''),
    score: r.score,
  }));
}

// ── Helpers ──────────────────────────────────────────────────────

// Returns false for issues whose entire embedded text is just the key+type+summary line
// with no description, no labels, no components — these produce near-identical vectors
// and pollute similarity results.
function hasSubstantiveContent(issue: JiraIssue): boolean {
  const desc = issue.fields.description;
  const hasDesc = desc != null && (
    (typeof desc === 'string' && desc.trim().length > 0) ||
    (typeof desc === 'object' && Array.isArray((desc as Record<string, unknown>)['content']) &&
      (desc as Record<string, unknown>)['content'] !== null)
  );
  const hasLabels = (issue.fields.labels ?? []).length > 0;
  const hasComponents = (issue.fields.components ?? []).length > 0;
  // Always index if there's any supplementary content; for issues with only a summary,
  // require the summary to be descriptive enough (>40 chars) to add search value.
  if (hasDesc || hasLabels || hasComponents) return true;
  return (issue.fields.summary ?? '').trim().length > 40;
}

function stableId(jiraKey: string): number {
  return parseInt(jiraKey.replace(/[^0-9]/g, '') || '0', 10);
}

const MODULE_KEYWORDS = [
  // Auth & account
  'login', 'logout', 'auth', 'password', 'forgot', 'reset', 'otp', 'token',
  'signup', 'register', 'verify', 'verification', 'session', 'credential',
  // Admin & users
  'admin', 'user', 'employee', 'profile', 'account', 'permission', 'role',
  // Navigation & UI
  'dashboard', 'settings', 'notification', 'menu', 'sidebar', 'navigation',
  // Data operations
  'report', 'search', 'filter', 'export', 'import', 'upload', 'download',
  // HR-specific
  'leave', 'attendance', 'payroll', 'salary', 'recruitment', 'candidate',
  'job', 'career', 'resume', 'onboard',
];

function extractModuleKeywords(input: string): string[] {
  return MODULE_KEYWORDS.filter(k => input.toLowerCase().includes(k));
}
