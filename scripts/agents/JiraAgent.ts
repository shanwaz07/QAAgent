import fs from 'fs';
import path from 'path';
import { fetchIssues, fetchIssue, type JiraIssue } from '../lib/jiraClient';

const RAW_DIR = path.join(__dirname, '../../artifacts/rag');

export function extractText(issue: JiraIssue): string {
  const desc = issue.fields.description;
  let descText = '';
  if (typeof desc === 'string') {
    descText = desc;
  } else if (desc && typeof desc === 'object' && Array.isArray(desc.content)) {
    descText = extractAdfText(desc.content);
  }
  const type = issue.fields.issuetype?.name ?? '';
  const labels = (issue.fields.labels ?? []).join(', ');
  const components = (issue.fields.components ?? []).map(c => c.name).join(', ');
  return [
    `[${issue.key}] ${type}: ${issue.fields.summary}`,
    descText,
    labels ? `Labels: ${labels}` : '',
    components ? `Components: ${components}` : '',
  ].filter(Boolean).join('\n').trim();
}

function extractAdfText(content: unknown[]): string {
  const parts: string[] = [];
  for (const node of content) {
    const n = node as Record<string, unknown>;
    if (n['type'] === 'text' && typeof n['text'] === 'string') parts.push(n['text']);
    if (Array.isArray(n['content'])) parts.push(extractAdfText(n['content'] as unknown[]));
  }
  return parts.join(' ');
}

// Rules: Task / Sub-task / Bug → any status
//        Story / Epic → only when NOT "To Do"
const INDEXABLE_JQL = (projectKey: string) =>
  `project = ${projectKey} AND (` +
    `(issuetype in (Task, "Sub-task", Bug)) OR ` +
    `(issuetype in (Story, Epic) AND status NOT IN ("To Do"))` +
  `) ORDER BY updated DESC`;

export function shouldIndex(issue: JiraIssue): boolean {
  const type = issue.fields.issuetype?.name ?? '';
  const status = issue.fields.status?.name ?? '';
  if (['Task', 'Sub-task', 'Bug'].includes(type)) return true;
  if (['Story', 'Epic'].includes(type)) return status !== 'To Do';
  return false;
}

export async function syncProject(projectKey: string): Promise<JiraIssue[]> {
  console.log(`[JiraAgent] Fetching issues for project ${projectKey} (Task/Sub-task/Bug any status; Story/Epic excluding To Do)...`);
  const issues = await fetchIssues(INDEXABLE_JQL(projectKey));
  console.log(`[JiraAgent] Fetched ${issues.length} issues`);

  fs.mkdirSync(RAW_DIR, { recursive: true });
  const rawPath = path.join(RAW_DIR, `jira_raw_${projectKey}.json`);
  fs.writeFileSync(rawPath, JSON.stringify(issues, null, 2));
  console.log(`[JiraAgent] Saved raw data → ${rawPath}`);

  return issues;
}

export async function getIssue(issueKey: string): Promise<JiraIssue> {
  const issue = await fetchIssue(issueKey);
  const dir = path.join(__dirname, `../../artifacts/${issueKey}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'requirements.json'), JSON.stringify(issue, null, 2));
  return issue;
}
