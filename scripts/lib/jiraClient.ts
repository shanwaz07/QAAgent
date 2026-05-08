import https from 'https';

const BASE_URL = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const EMAIL = process.env.JIRA_EMAIL || '';
const TOKEN = process.env.JIRA_API_TOKEN || '';
const AUTH = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

function request<T>(method: string, path: string, body?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${BASE_URL}${path}`);
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      'Authorization': `Basic ${AUTH}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    const req = https.request(
      { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method, headers },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode === 204) return resolve(undefined as T);
          try {
            const parsed = JSON.parse(data) as T;
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Jira ${method} ${path} → ${res.statusCode}: ${data}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Non-JSON response from Jira: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: { content?: { content?: { text?: string }[] }[] } | string | null;
    issuetype?: { name: string };
    status?: { name: string };
    labels?: string[];
    components?: { name: string }[];
    assignee?: { displayName: string } | null;
    priority?: { name: string } | null;
    parent?: { key: string } | null;
    [key: string]: unknown;
  };
}

interface SearchResponse {
  issues: JiraIssue[];
  nextPageToken?: string;
}

export async function fetchIssues(jql: string, fields = 'summary,description,issuetype,status,labels,components,assignee,priority,parent'): Promise<JiraIssue[]> {
  const all: JiraIssue[] = [];
  let nextPageToken: string | undefined;

  do {
    const params = new URLSearchParams({ jql, maxResults: '50', fields });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await request<SearchResponse>('GET', `/rest/api/3/search/jql?${params}`);
    all.push(...(res.issues ?? []));
    nextPageToken = res.nextPageToken;
    process.stdout.write(`\r[JiraClient] Fetched ${all.length} issues...`);
  } while (nextPageToken);

  process.stdout.write('\n');
  return all;
}

export async function fetchIssue(issueKey: string): Promise<JiraIssue> {
  return request<JiraIssue>('GET', `/rest/api/3/issue/${issueKey}?fields=summary,description,issuetype,status,labels,components,assignee,priority,parent,comment`);
}

export interface CreateIssuePayload {
  projectKey: string;
  summary: string;
  description: string;
  issueType?: string;
  priority?: string;
  assigneeAccountId?: string;
  labels?: string[];
}

export async function createIssue(payload: CreateIssuePayload): Promise<{ id: string; key: string }> {
  const body = {
    fields: {
      project: { key: payload.projectKey },
      summary: payload.summary,
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: payload.description }] }],
      },
      issuetype: { name: payload.issueType || 'Bug' },
      ...(payload.priority ? { priority: { name: payload.priority } } : {}),
      ...(payload.assigneeAccountId ? { assignee: { accountId: payload.assigneeAccountId } } : {}),
      ...(payload.labels?.length ? { labels: payload.labels } : {}),
    },
  };
  return request<{ id: string; key: string }>('POST', '/rest/api/3/issue', body);
}

export async function attachFile(issueId: string, fileName: string, fileContent: Buffer, mimeType = 'image/png'): Promise<void> {
  return new Promise((resolve, reject) => {
    const boundary = `----FormBoundary${Date.now()}`;
    const urlObj = new URL(`${BASE_URL}/rest/api/3/issue/${issueId}/attachments`);
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const total = header.length + fileContent.length + footer.length;

    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${AUTH}`,
        'X-Atlassian-Token': 'no-check',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': total,
      },
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) reject(new Error(`Attach failed ${res.statusCode}: ${data}`));
        else resolve();
      });
    });
    req.on('error', reject);
    req.write(header);
    req.write(fileContent);
    req.write(footer);
    req.end();
  });
}
