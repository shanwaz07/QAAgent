require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { orchestrate } = require('../../scripts/orchestrate');
const { runHealthChecks } = require('../../scripts/lib/healthCheck');

// Lazy-load TypeScript agents via ts-node (registered at startup)
require('ts-node').register({ project: require('path').join(__dirname, '../../tsconfig.json'), transpileOnly: true });
const { syncProject, getIssue } = require('../../scripts/agents/JiraAgent');
const { buildIndex, deltaIndex, ragQuery } = require('../../scripts/agents/RagAgent');
const { chat } = require('../../scripts/lib/llmClient');
const { logBus, readRecentLogs, logger } = require('../../scripts/lib/logger');
const { generateClarifyingQuestions } = require('../../scripts/agents/ClarifierAgent');
const { generateTestPlan } = require('../../scripts/agents/PlannerAgent');
const { conversationManager, PHASES } = require('../../scripts/lib/conversationManager');
const { normalizeJiraIssue } = require('../../scripts/lib/jiraNormalize');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 5000;

// Defence-in-depth: jiraId flows from URL params and LLM extraction into fs.path.join().
// Reject anything that doesn't look like a Jira issue key so a hostile or buggy value
// (e.g. "../../etc") can't escape the artifacts/ directory.
const JIRA_ID_RE = /^[A-Z][A-Z0-9_]+-\d+$/;
function isValidJiraId(s) {
  return typeof s === 'string' && JIRA_ID_RE.test(s);
}

// ── Mutex flags ───────────────────────────────────────────────────
// Prevents sync during execution and vice versa
let isSyncing = false;
let isExecuting = false;

// ── Sync metadata ─────────────────────────────────────────────────
const SYNC_META_FILE    = path.join(__dirname, '../../artifacts/rag/sync_meta.json');
const INDEX_PROGRESS_FILE = path.join(__dirname, '../../artifacts/rag/index_progress.json');
const SETTINGS_FILE     = path.join(__dirname, '../../artifacts/settings.json');

function readSyncMeta() {
  try {
    return fs.existsSync(SYNC_META_FILE)
      ? JSON.parse(fs.readFileSync(SYNC_META_FILE, 'utf8'))
      : {};
  } catch { return {}; }
}

// Source of truth for how many issues are actually in the Qdrant index.
// index_progress.json is written by RagAgent after every upsert — it's always accurate.
function getActualIndexedCount() {
  try {
    const data = fs.existsSync(INDEX_PROGRESS_FILE)
      ? JSON.parse(fs.readFileSync(INDEX_PROGRESS_FILE, 'utf8'))
      : [];
    return Array.isArray(data) ? data.length : 0;
  } catch { return 0; }
}

function writeSyncMeta(meta) {
  fs.mkdirSync(path.dirname(SYNC_META_FILE), { recursive: true });
  fs.writeFileSync(SYNC_META_FILE, JSON.stringify({ ...readSyncMeta(), ...meta }, null, 2));
}

// ── Bridge logger → Socket.IO ─────────────────────────────────────
// Wired after `io` is created below — see end of io setup block

// ── Static / existing ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('QA Agent Family Backend is running. Use port 5173 for the Dashboard.');
});

app.use('/artifacts', express.static(path.join(__dirname, '../../artifacts')));

app.get('/api/results/:jiraId', (req, res) => {
  if (!isValidJiraId(req.params.jiraId)) return res.status(400).json({ error: 'Invalid jiraId' });
  const filePath = path.join(__dirname, `../../artifacts/${req.params.jiraId}/results.json`);
  fs.existsSync(filePath)
    ? res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    : res.status(404).json({ error: 'Not found' });
});

// ── GET /api/jira/sync-status ─────────────────────────────────────
// Returns last sync metadata + current mutex state.
// totalIssues is always read from index_progress.json (the authoritative source)
// so stale values in sync_meta.json never surface in the UI.
app.get('/api/jira/sync-status', (req, res) => {
  const meta = readSyncMeta();
  meta.totalIssues = getActualIndexedCount();
  res.json({ ...meta, isSyncing, isExecuting });
});

// ── POST /api/jira/sync ───────────────────────────────────────────
// delta=true  → only issues updated since lastSyncAt
// delta=false → full re-sync (re-fetches all, embeds new ones)
app.post('/api/jira/sync', async (req, res) => {
  if (isExecuting) {
    return res.status(409).json({ error: 'A test execution is in progress. Wait for it to finish before syncing.' });
  }
  if (isSyncing) {
    return res.status(409).json({ error: 'Sync already in progress.' });
  }

  const projectKey = req.body.projectKey || process.env.JIRA_PROJECT_KEY;
  if (!projectKey) return res.status(400).json({ error: 'projectKey is required' });

  const delta = req.body.delta !== false; // default: true (delta)
  const meta = readSyncMeta();
  const lastSyncAt = meta.lastSyncAt ? new Date(meta.lastSyncAt) : null;

  // Force full sync if no previous sync recorded
  const useDelta = delta && !!lastSyncAt;

  res.json({ status: 'started', mode: useDelta ? 'delta' : 'full', projectKey });

  isSyncing = true;
  io.emit('sync_status', { syncing: true, message: useDelta
    ? `Delta sync — fetching issues updated since ${lastSyncAt.toLocaleString()}...`
    : `Full sync — fetching all issues for ${projectKey}...`
  });

  const syncStartedAt = new Date();

  try {
    let count;

    if (useDelta) {
      count = await deltaIndex(projectKey, lastSyncAt);
      io.emit('sync_status', {
        syncing: false,
        done: true,
        message: count === 0
          ? 'No changes since last sync. Index is up to date.'
          : `Delta sync complete — ${count} issue(s) updated/added to the index.`,
      });
    } else {
      io.emit('sync_status', { syncing: true, message: 'Fetching all Jira issues...' });
      const issues = await syncProject(projectKey);
      io.emit('sync_status', { syncing: true, message: `Fetched ${issues.length} issues. Rebuilding RAG index from scratch...` });
      count = await buildIndex(projectKey, issues, true); // force=true → always recreate collection
      io.emit('sync_status', {
        syncing: false,
        done: true,
        message: `Full sync complete — ${issues.length} issues indexed.`,
      });
    }

    writeSyncMeta({
      lastSyncAt: syncStartedAt.toISOString(),
      projectKey,
      lastDeltaCount: useDelta ? count : undefined,
      totalIssues: getActualIndexedCount(),
    });

    io.emit('sync_meta_update', readSyncMeta());

  } catch (err) {
    io.emit('sync_status', { syncing: false, error: true, message: `Sync error: ${err.message}` });
  } finally {
    isSyncing = false;
  }
});

// ── POST /api/rag/query ───────────────────────────────────────────
app.post('/api/rag/query', async (req, res) => {
  const { query: userQuery, topK = 10 } = req.body;
  if (!userQuery || typeof userQuery !== 'string')
    return res.status(400).json({ error: 'query (string) is required' });
  try {
    const results = await ragQuery(userQuery, Math.min(Number(topK) || 10, 30));
    res.json(results);
  } catch (err) {
    logger.error('Server', `/api/rag/query error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/jira/issues ──────────────────────────────────────────
app.get('/api/jira/issues', (req, res) => {
  const projectKey = req.query.projectKey || process.env.JIRA_PROJECT_KEY;
  const rawPath = path.join(__dirname, `../../artifacts/rag/jira_raw_${projectKey}.json`);
  fs.existsSync(rawPath)
    ? res.json(JSON.parse(fs.readFileSync(rawPath, 'utf8')))
    : res.status(404).json({ error: 'No synced issues found. Run /api/jira/sync first.' });
});

// ── POST /api/chat ────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  try {
    const ragResults = await ragQuery(message, 5);
    const knownIds = ragResults.map(r => r.jiraId);
    const knownIdsStr = knownIds.join(', ');
    const ragContext = ragResults.map(r => `[${r.jiraId}] ${r.summary}`).join('\n');

    const systemPrompt = `You are a QA orchestration assistant. Extract the intent and Jira ticket ID from the user's message.

Known Jira IDs from context (only use one of these — do NOT invent IDs):
${knownIdsStr}

Context issues:
${ragContext}

Respond ONLY with a JSON object in exactly this format:
{
  "intent": "full_test" | "smoke_test" | "regression_test" | "explain",
  "jiraId": "<JIRA_ID_or_null>",
  "confirmationMessage": "<human-readable confirmation message>"
}

Rules:
- intent must be one of: full_test, smoke_test, regression_test, explain
- jiraId must be from the known IDs list above, or null if not found
- If the user explicitly mentions a Jira ID (e.g. CBOT-421) and it appears in the known list, use it
- confirmationMessage should summarize what will be tested and why`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ];

    const responseText = await chat(messages, { temperature: 0 });
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);

    let issueTitle = null;
    if (parsed.jiraId) {
      try {
        const issue = await getIssue(parsed.jiraId);
        issueTitle = issue.fields.summary;
      } catch { /* non-fatal */ }
    }

    // Extract any URL the user explicitly mentioned — this becomes the targetUrl for the run
    const urlMatch = message.match(/https?:\/\/[^\s"'<>]+/);
    const targetUrl = urlMatch ? urlMatch[0].replace(/[.,;!?]+$/, '') : null;

    res.json({ ...parsed, issueTitle, ragResults: ragResults.slice(0, 3), targetUrl });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/orchestrate ─────────────────────────────────────────
app.post('/api/orchestrate', async (req, res) => {
  if (isSyncing) {
    return res.status(409).json({ error: 'A Jira sync is in progress. Wait for it to finish before running tests.' });
  }
  if (isExecuting) {
    return res.status(409).json({ error: 'An execution is already in progress.' });
  }

  const { jiraId, ragTopK, executionMode, headless, model, targetUrl } = req.body;
  if (!jiraId) return res.status(400).json({ error: 'jiraId is required' });

  res.json({ status: 'started', jiraId });
  isExecuting = true;
  io.emit('execution_status', { executing: true, jiraId });

  orchestrate(jiraId, io, { ragTopK, executionMode, headless, model, targetUrl })
    .catch(err => {
      console.error('[SERVER] Orchestration error:', err);
      io.emit('update_status', { type: 'STATUS_UPDATE', status: `Error: ${err.message}` });
    })
    .finally(() => {
      isExecuting = false;
      io.emit('execution_status', { executing: false, jiraId });
    });
});

// ── POST /api/converse ────────────────────────────────────────────
// Stateful conversational endpoint for Phase 10.A.
// Phases: start → (clarifying →) plan_review → executing → done
// Single endpoint, phase routing inside. The client owns sessionId (UUID in sessionStorage).
app.post('/api/converse', async (req, res) => {
  const { sessionId: clientSessionId, phase, payload = {} } = req.body || {};

  // Mutex: don't start a new conversation while a sync is in flight.
  if (phase === 'start' && isSyncing) {
    return res.status(409).json({ error: 'A Jira sync is in progress. Wait for it to finish.' });
  }
  if (phase === 'approve_plan' && isExecuting) {
    return res.status(409).json({ error: 'An execution is already in progress.' });
  }

  let session = clientSessionId ? conversationManager.get(clientSessionId) : null;
  if (!session) session = conversationManager.create(clientSessionId);

  const emit = (event, data) => io.emit(event, { sessionId: session.sessionId, ...data });

  try {
    if (phase === 'start') {
      const { message, jiraId: clientJiraId, targetUrl: clientTargetUrl, ragTopK = 10 } = payload;
      if (!message && !clientJiraId) {
        return res.status(400).json({ error: 'message or jiraId required' });
      }

      conversationManager.update(session.sessionId, { phase: PHASES.ANALYZING });
      conversationManager.appendHistory(session.sessionId, {
        role: 'user', content: message || `Run tests for ${clientJiraId}`, phase: PHASES.ANALYZING,
      });
      emit('converse_thinking', { message: 'Analysing request and fetching context…' });

      // Resolve jiraId — prefer client-supplied, fall back to RAG-driven extraction via /api/chat-style flow
      let jiraId = clientJiraId;
      let targetUrl = clientTargetUrl || '';

      if (!jiraId && message) {
        const urlMatch = message.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch && !targetUrl) targetUrl = urlMatch[0].replace(/[.,;!?]+$/, '');

        const ragResults = await ragQuery(message, 5);
        const knownIds = ragResults.map(r => r.jiraId);
        const sysPrompt = `Extract intent and Jira ID from the user's message. Known IDs: ${knownIds.join(', ') || '(none)'}. Return JSON: { "jiraId": "<ID or null>" }. Use only IDs from the known list.`;
        const extracted = await chat(
          [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: message },
          ],
          { temperature: 0 },
        );
        try {
          const cleaned = extracted.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          jiraId = JSON.parse(cleaned).jiraId;
        } catch { /* leave null */ }
      }

      if (!jiraId) {
        emit('converse_done', { jiraId: null, error: 'Could not identify a Jira ticket from your request.' });
        return res.json({ sessionId: session.sessionId, phase: PHASES.ERROR, error: 'No Jira ID identified' });
      }

      // Reject anything that doesn't look like a real Jira key — prevents path-traversal
      // via a hostile or hallucinated extraction.
      if (!isValidJiraId(jiraId)) {
        emit('converse_done', { jiraId: null, error: `Invalid Jira ID format: ${jiraId}` });
        return res.json({ sessionId: session.sessionId, phase: PHASES.ERROR, error: `Invalid Jira ID format: ${jiraId}` });
      }

      // Fetch requirements (auto-fetch from Jira if not cached).
      // Always run through normalizeJiraIssue so ADF descriptions are flattened
      // to plain text — passing raw ADF objects to the LLM produces empty/naive plans.
      const artifactDir = path.join(__dirname, `../../artifacts/${jiraId}`);
      const reqPath = path.join(artifactDir, 'requirements.json');
      let requirements;
      if (fs.existsSync(reqPath)) {
        requirements = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
        // Stale cache: raw Jira response stored before normalisation. Re-flatten + re-save.
        if (requirements.fields) {
          requirements = normalizeJiraIssue(jiraId, requirements);
          fs.writeFileSync(reqPath, JSON.stringify(requirements, null, 2));
        }
      } else {
        try {
          const issue = await getIssue(jiraId);
          requirements = normalizeJiraIssue(jiraId, issue);
          fs.mkdirSync(artifactDir, { recursive: true });
          fs.writeFileSync(reqPath, JSON.stringify(requirements, null, 2));
        } catch (err) {
          emit('converse_done', { jiraId, error: `Failed to fetch ${jiraId} from Jira: ${err.message}` });
          return res.json({ sessionId: session.sessionId, phase: PHASES.ERROR, error: err.message });
        }
      }

      // RAG context
      const ragContext = await ragQuery(
        `${requirements.title || ''} ${requirements.description || ''}`.trim() || jiraId,
        ragTopK,
      );

      conversationManager.update(session.sessionId, {
        jiraId, requirements, ragContext, targetUrl,
      });

      // Run ClarifierAgent
      const questions = await generateClarifyingQuestions(jiraId, requirements, ragContext, targetUrl);

      if (questions.length > 0) {
        conversationManager.update(session.sessionId, {
          phase: PHASES.CLARIFYING, pendingQuestions: questions,
        });
        conversationManager.appendHistory(session.sessionId, {
          role: 'agent', content: `I have ${questions.length} question(s) before I build the plan.`,
          phase: PHASES.CLARIFYING, card: 'clarification', payload: questions,
        });
        emit('converse_clarify', { questions, jiraId, requirements: { title: requirements.title } });
        return res.json({ sessionId: session.sessionId, phase: PHASES.CLARIFYING, jiraId, questions, issueTitle: requirements.title });
      }

      // No clarification needed → straight to plan
      return generatePlanAndRespond(session, res, emit);
    }

    if (phase === 'answers') {
      if (!session.jiraId) {
        return res.status(400).json({ error: 'No active session — call phase=start first.' });
      }
      const answers = payload.answers || {};
      conversationManager.update(session.sessionId, { answers });
      conversationManager.appendHistory(session.sessionId, {
        role: 'user', content: 'Answered clarifying questions.', phase: PHASES.CLARIFYING, payload: answers,
      });
      return generatePlanAndRespond(session, res, emit);
    }

    if (phase === 'approve_plan') {
      if (!session.testPlan) {
        return res.status(400).json({ error: 'No test plan to approve in this session.' });
      }

      if (payload.regenerate) {
        conversationManager.appendHistory(session.sessionId, {
          role: 'user', content: 'Requested plan regeneration.', phase: PHASES.PLAN_REVIEW,
        });
        return generatePlanAndRespond(session, res, emit);
      }

      // Phase 10.B: approve_plan transitions to tc_review (NOT executing).
      // The user can now edit individual test cases before final approval.
      conversationManager.update(session.sessionId, { phase: PHASES.TC_REVIEW });
      conversationManager.appendHistory(session.sessionId, {
        role: 'user', content: 'Approved overall plan — proceeding to test case review.', phase: PHASES.TC_REVIEW,
      });
      conversationManager.appendHistory(session.sessionId, {
        role: 'agent',
        content: `Review each test case — keep, remove, or edit before execution.`,
        phase: PHASES.TC_REVIEW, card: 'tc_review', payload: session.testPlan.testCases,
      });
      emit('converse_tc_ready', { testCases: session.testPlan.testCases });
      return res.json({
        sessionId: session.sessionId,
        phase: PHASES.TC_REVIEW,
        jiraId: session.jiraId,
        testCases: session.testPlan.testCases,
      });
    }

    if (phase === 'approve_cases') {
      if (!session.testPlan) {
        return res.status(400).json({ error: 'No test plan in session.' });
      }
      if (isExecuting) {
        return res.status(409).json({ error: 'An execution is already in progress.' });
      }

      const edited = Array.isArray(payload.testCases) ? payload.testCases : [];
      if (edited.length === 0) {
        return res.status(400).json({ error: 'At least one test case is required.' });
      }

      // Replace testCases with the user-edited array. Other plan fields preserved.
      const finalPlan = { ...session.testPlan, testCases: edited };
      conversationManager.update(session.sessionId, {
        phase: PHASES.EXECUTING,
        testPlan: finalPlan,
      });
      conversationManager.appendHistory(session.sessionId, {
        role: 'user',
        content: `Confirmed ${edited.length} test case(s) — starting execution.`,
        phase: PHASES.EXECUTING, payload: edited,
      });

      res.json({ sessionId: session.sessionId, phase: PHASES.EXECUTING, jiraId: session.jiraId });

      isExecuting = true;
      io.emit('execution_status', { executing: true, jiraId: session.jiraId });

      // Track failure so the audit transcript reflects reality (was always 'completed').
      let executionFailed = false;
      let executionError = null;

      orchestrate(session.jiraId, io, {
        targetUrl: session.targetUrl,
        preApprovedPlan: session.testPlan,
        ragTopK: payload.ragTopK,
        executionMode: payload.executionMode,
        headless: payload.headless,
        model: payload.model,
      })
        .catch(err => {
          executionFailed = true;
          executionError = err.message;
          logger.error('Server', `Conversational execution error: ${err.message}`);
          io.emit('update_status', { type: 'STATUS_UPDATE', status: `Error: ${err.message}` });
        })
        .finally(() => {
          isExecuting = false;
          io.emit('execution_status', { executing: false, jiraId: session.jiraId });

          const finalPhase = executionFailed ? PHASES.ERROR : PHASES.DONE;
          const finalStatus = executionFailed ? 'error' : 'completed';
          const finalContent = executionFailed
            ? `Execution failed: ${executionError}`
            : 'Execution complete.';

          conversationManager.update(session.sessionId, { phase: finalPhase });
          conversationManager.appendHistory(session.sessionId, {
            role: 'agent', content: finalContent, phase: finalPhase,
          });
          const transcriptPath = conversationManager.saveTranscript(session.sessionId, finalStatus);
          io.emit('converse_done', {
            sessionId: session.sessionId,
            jiraId: session.jiraId,
            transcriptPath,
            error: executionError,
          });
          // Free the in-memory session — transcript is on disk for audit.
          conversationManager.destroy(session.sessionId);
        });

      return; // response already sent
    }

    return res.status(400).json({ error: `Unknown phase: ${phase}` });
  } catch (err) {
    logger.error('Server', `/api/converse error: ${err.message}`);
    conversationManager.saveTranscript(session.sessionId, 'error');
    return res.status(500).json({ error: err.message });
  }
});

// Helper: generate plan, append to history, emit, respond.
async function generatePlanAndRespond(session, res, emit) {
  emit('converse_thinking', { message: 'Generating test plan…' });
  const plan = await generateTestPlan(
    session.jiraId,
    session.requirements,
    session.ragContext,
    io,
    session.targetUrl,
    session.answers,
  );
  conversationManager.update(session.sessionId, {
    phase: PHASES.PLAN_REVIEW, testPlan: plan, pendingQuestions: [],
  });
  conversationManager.appendHistory(session.sessionId, {
    role: 'agent', content: `Generated test plan with ${plan.testCases.length} test cases.`,
    phase: PHASES.PLAN_REVIEW, card: 'plan_review', payload: plan,
  });
  emit('converse_plan_ready', { plan });
  return res.json({ sessionId: session.sessionId, phase: PHASES.PLAN_REVIEW, jiraId: session.jiraId, plan });
}

// ── GET /api/health ───────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const checks = await runHealthChecks();
    const allOk = checks.every(c => c.status === 'ok');
    res.status(allOk ? 200 : 207).json({
      checks,
      activeLlmProvider: process.env.ACTIVE_LLM_PROVIDER || 'google',
      activeLlmModel: process.env.ACTIVE_LLM_MODEL || '',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Settings ──────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  try {
    res.json(fs.existsSync(SETTINGS_FILE)
      ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
      : {});
  } catch { res.json({}); }
});

app.post('/api/settings', (req, res) => {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ── Per-ticket data ───────────────────────────────────────────────
app.get('/api/testplan/:jiraId', (req, res) => {
  if (!isValidJiraId(req.params.jiraId)) return res.status(400).json({ error: 'Invalid jiraId' });
  const filePath = path.join(__dirname, `../../artifacts/${req.params.jiraId}/test_plan.json`);
  fs.existsSync(filePath)
    ? res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    : res.status(404).json({ error: 'Test plan not yet generated' });
});

app.get('/api/report/:jiraId', (req, res) => {
  if (!isValidJiraId(req.params.jiraId)) return res.status(400).json({ error: 'Invalid jiraId' });
  const filePath = path.join(__dirname, `../../artifacts/${req.params.jiraId}/results.json`);
  fs.existsSync(filePath)
    ? res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    : res.status(404).json({ error: 'No results found' });
});

app.get('/api/bugs/:jiraId', (req, res) => {
  if (!isValidJiraId(req.params.jiraId)) return res.status(400).json({ error: 'Invalid jiraId' });
  const filePath = path.join(__dirname, `../../artifacts/${req.params.jiraId}/bugs.json`);
  fs.existsSync(filePath)
    ? res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    : res.status(404).json({ error: 'No bugs found' });
});

// ── GET /api/logs ─────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  const date = req.query.date; // YYYY-MM-DD, defaults to today
  res.json(readRecentLogs(lines, date));
});

// ── Socket.IO ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
  logger.info('Server', `Client connected: ${socket.id}`);

  // Send current state immediately on connect so UI is in sync.
  // Override totalIssues with the live count from index_progress.json.
  const connectMeta = { ...readSyncMeta(), totalIssues: getActualIndexedCount() };
  socket.emit('sync_meta_update', connectMeta);
  socket.emit('execution_status', { executing: isExecuting });
  socket.emit('sync_status', { syncing: isSyncing });

  // Replay last 50 log lines so the UI shows history on first load
  socket.emit('log_history', readRecentLogs(50));

  socket.on('update_status', (data) => {
    io.emit('status_changed', data);
  });

  socket.on('disconnect', () => {
    logger.info('Server', `Client disconnected: ${socket.id}`);
  });
});

// Bridge logger bus → all connected sockets (wired after io is ready)
logBus.on('log', (entry) => io.emit('app_log', entry));

// Belt-and-braces cleanup: in case a session is abandoned mid-flow (browser closed
// before approve_plan, network error, etc.), prune anything older than 24h hourly.
setInterval(() => conversationManager.pruneStale(), 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Dashboard Backend running on http://localhost:${PORT}`);
});
