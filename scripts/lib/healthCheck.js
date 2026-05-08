require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const https = require('https');
const http = require('http');

const TIMEOUT_MS = 8000;

// ── Generic HTTP/HTTPS GET with timeout ───────────────────────────
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    const req = mod.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('Timed out')); });
    req.on('error', reject);
    req.end();
  });
}

function safeBody(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

// ── Individual checks ─────────────────────────────────────────────

async function checkQdrant() {
  const url = (process.env.QDRANT_URL || 'http://localhost:6333') + '/healthz';
  const t = Date.now();
  try {
    const res = await httpGet(url);
    if (res.status === 200)
      return { name: 'Qdrant', status: 'ok', message: 'Running', latency: Date.now() - t };
    return { name: 'Qdrant', status: 'error', message: `HTTP ${res.status} — is Docker running?` };
  } catch (e) {
    return { name: 'Qdrant', status: 'error', message: `Not reachable — ${e.message}` };
  }
}

async function checkGoogleEmbeddings() {
  const key = process.env.GOOGLE_API_KEY || '';
  if (!key)
    return { name: 'Google Embeddings', status: 'error', message: 'GOOGLE_API_KEY not set' };
  const t = Date.now();
  try {
    const res = await httpGet(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001?key=${key}`,
    );
    if (res.status === 200)
      return { name: 'Google Embeddings', status: 'ok', message: 'Key valid', latency: Date.now() - t };
    const err = safeBody(res.body)?.error?.message || `HTTP ${res.status}`;
    return { name: 'Google Embeddings', status: 'error', message: err };
  } catch (e) {
    return { name: 'Google Embeddings', status: 'error', message: e.message };
  }
}

async function checkActiveLlm() {
  const provider = process.env.ACTIVE_LLM_PROVIDER || 'google';
  const model   = process.env.ACTIVE_LLM_MODEL   || '';

  if (provider === 'google') {
    const key = process.env.GOOGLE_LLM_API_KEY || '';
    if (!key)
      return { name: `LLM · Google (${model || 'gemini-2.0-flash'})`, status: 'error', message: 'GOOGLE_LLM_API_KEY not set' };
    const m = model || 'gemini-2.0-flash';
    const t = Date.now();
    try {
      const res = await httpGet(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}?key=${key}`,
      );
      if (res.status === 200)
        return { name: `LLM · Google (${m})`, status: 'ok', message: 'Key valid', latency: Date.now() - t };
      const err = safeBody(res.body)?.error?.message || `HTTP ${res.status}`;
      return { name: `LLM · Google (${m})`, status: 'error', message: err };
    } catch (e) {
      return { name: `LLM · Google (${m})`, status: 'error', message: e.message };
    }
  }

  if (provider === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY || '';
    if (!key)
      return { name: 'LLM · OpenRouter', status: 'error', message: 'OPENROUTER_API_KEY not set' };
    const t = Date.now();
    try {
      const res = await httpGet('https://openrouter.ai/api/v1/auth/key', { Authorization: `Bearer ${key}` });
      if (res.status === 200)
        return { name: `LLM · OpenRouter (${model})`, status: 'ok', message: 'Key valid', latency: Date.now() - t };
      return { name: `LLM · OpenRouter (${model})`, status: 'error', message: `HTTP ${res.status}` };
    } catch (e) {
      return { name: `LLM · OpenRouter (${model})`, status: 'error', message: e.message };
    }
  }

  if (provider === 'groq') {
    const key = process.env.GROQ_API_KEY || '';
    if (!key)
      return { name: 'LLM · Groq', status: 'error', message: 'GROQ_API_KEY not set' };
    const t = Date.now();
    try {
      const res = await httpGet('https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${key}` });
      if (res.status === 200)
        return { name: `LLM · Groq (${model})`, status: 'ok', message: 'Key valid', latency: Date.now() - t };
      return { name: `LLM · Groq (${model})`, status: 'error', message: `HTTP ${res.status}` };
    } catch (e) {
      return { name: `LLM · Groq (${model})`, status: 'error', message: e.message };
    }
  }

  if (provider === 'openai') {
    const key = process.env.OPENAI_API_KEY || '';
    if (!key)
      return { name: 'LLM · OpenAI', status: 'error', message: 'OPENAI_API_KEY not set' };
    const t = Date.now();
    try {
      const res = await httpGet('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` });
      if (res.status === 200)
        return { name: `LLM · OpenAI (${model})`, status: 'ok', message: 'Key valid', latency: Date.now() - t };
      return { name: `LLM · OpenAI (${model})`, status: 'error', message: `HTTP ${res.status}` };
    } catch (e) {
      return { name: `LLM · OpenAI (${model})`, status: 'error', message: e.message };
    }
  }

  return { name: `LLM · ${provider}`, status: 'error', message: `Unknown provider: ${provider}` };
}

async function checkJira() {
  const base  = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
  const email = process.env.JIRA_EMAIL || '';
  const token = process.env.JIRA_API_TOKEN || '';
  if (!base || !email || !token)
    return { name: 'Jira', status: 'error', message: 'JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN not all set' };

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const t = Date.now();
  try {
    const res = await httpGet(`${base}/rest/api/3/myself`, { Authorization: `Basic ${auth}` });
    if (res.status === 200) {
      const body = safeBody(res.body);
      return { name: 'Jira', status: 'ok', message: `Authenticated as ${body.displayName || email}`, latency: Date.now() - t };
    }
    if (res.status === 401)
      return { name: 'Jira', status: 'error', message: 'Token expired — regenerate at id.atlassian.com/manage-profile/security/api-tokens' };
    return { name: 'Jira', status: 'error', message: `HTTP ${res.status}` };
  } catch (e) {
    return { name: 'Jira', status: 'error', message: e.message };
  }
}

// ── Run all checks in parallel ────────────────────────────────────
async function runHealthChecks() {
  const results = await Promise.all([
    checkQdrant(),
    checkGoogleEmbeddings(),
    checkActiveLlm(),
    checkJira(),
  ]);
  return results;
}

module.exports = { runHealthChecks };
