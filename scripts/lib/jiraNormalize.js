// Shared helpers for normalising raw Jira API responses into the flat shape
// that PlannerAgent / ClarifierAgent / orchestrate.js expect.
//
// Used in two places (do NOT duplicate this logic):
//   - scripts/orchestrate.js  (auto-fetch on missing requirements.json)
//   - dashboard/backend/server.js  (/api/converse start phase)

// Recursively walk an Atlassian Document Format (ADF) content tree and
// concatenate every text node. Returns a plain string — empty if no text.
function extractAdfText(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const node of content) {
    if (node.type === 'text' && node.text) parts.push(node.text);
    if (Array.isArray(node.content)) parts.push(extractAdfText(node.content));
  }
  return parts.join(' ').trim();
}

// Convert a raw Jira API issue response into the flat requirements object.
// Handles both legacy string descriptions and modern ADF descriptions.
function normalizeJiraIssue(jiraId, issue) {
  const fields = issue.fields || {};
  let description = '';
  if (typeof fields.description === 'string') {
    description = fields.description;
  } else if (fields.description && Array.isArray(fields.description.content)) {
    description = extractAdfText(fields.description.content);
  }
  return {
    jiraId,
    title: fields.summary || jiraId,
    description,
    type: fields.issuetype?.name || 'Story',
    status: fields.status?.name || '',
    labels: fields.labels || [],
    components: (fields.components || []).map(c => c.name),
    priority: fields.priority?.name || '',
    assignee: fields.assignee?.displayName || '',
  };
}

module.exports = { normalizeJiraIssue, extractAdfText };
