# QA Agent Family

AI-powered, end-to-end QA orchestration platform. A QA engineer types a single natural-language command — *"do full testing on CBOT-421"* — and a family of agents reads the Jira ticket, retrieves related context, plans the tests, generates real Playwright scripts against the live DOM, executes them in a visible browser, triages bugs with screenshots, files them back to Jira, and exports a Word + Excel deliverable.

The target application under test is **Convert** — Leoforce's AI careersite agent at `https://leolity-qa.goarya.com/demo-staffing/home`.

---

## Project Intent

Manual regression on a chat-based AI product is slow, repetitive, and depends heavily on the tester's familiarity with prior tickets. This project replaces the boilerplate parts of that loop with cooperating agents while keeping a human in control at every gate that matters (clarifications, plan, test cases, bug triage).

The system is built around three principles:

1. **No locator guesswork.** Every selector comes from a real Playwright accessibility-tree snapshot of the page under test, not from the LLM's imagination.
2. **RAG-grounded reasoning.** Plans and scripts are conditioned on prior Jira issues retrieved from a vector index, so the agent reuses institutional knowledge rather than rediscovering it.
3. **Interactive, not one-shot.** The user sees a multi-turn conversation: clarify gaps, review the plan, edit test cases inline, watch live execution, then triage bugs — instead of firing off a black-box run.

---

## How It Is Built

### Agent Pipeline

```
User: "do full testing on CBOT-421"
   │
   ▼
ConversationalAgent (React)  ──►  POST /api/converse
   │
   ▼
ClarifierAgent       — LLM gap detection; asks the user only what's missing
PlannerAgent         — generates a structured TestPlan JSON (3–5 cases)
   │  (user reviews + edits cases inline)
   ▼
PageExplorer         — Playwright captures live ARIA snapshots per target page
ScriptGenAgent       — emits .spec.ts using real DOM refs from those snapshots
Execution            — child_process.spawn runs each spec headed; streams logs over Socket.IO
SelfHealer           — LLM diagnoses locator failures with snapshot context
BugAgent             — files bugs to Jira with screenshots; discarded bugs feed back into RAG
ExportAgent          — summary.docx + testcases.xlsx + bugs.xlsx
```

Orchestration is sequential — one ticket, one test at a time, `workers: 1`, `retries: 0` — so the human can watch every step in the live browser.

### RAG Layer

- **Vector DB:** Qdrant (local Docker, port 6333) wrapped by `scripts/lib/vectorStore.ts` (`createCollection`, `upsertBatch`, `query`, `deletePoint`).
- **Embeddings:** Google `gemini-embedding-001` at 3072 dims via `scripts/lib/embedder.ts`. `taskType` is mandatory — `embedDocument` for indexing, `embedQuery` for search — without it the model produces undiscriminated vectors.
- **Indexing:** `JiraAgent.syncProject` pulls Jira issues with a filtered JQL (Task/Sub-task/Bug any status; Story/Epic excludes "To Do"). Issues with no description, no labels, no components, and a short summary are skipped.
- **Retrieval:** `RagAgent` runs a 4-layer query — top-K + label/component expansion + second-hop + keyword spike. Calibrated thresholds: `MIN_RETURN_SCORE=0.62`, `EXPANSION_QUALITY_THRESHOLD=0.67`. Expansion is gated by quality.
- **Sync modes:** Full sync recreates the collection. Delta sync upserts updated issues and deletes demoted ones (e.g. a Story moved back to To Do). A mutex prevents sync and execution from running concurrently.

### LLM Layer

`scripts/lib/llmClient.ts` is a multi-provider router covering OpenRouter, Groq, OpenAI, and Google Gemini. The active provider and model are read from `.env` (`ACTIVE_LLM_PROVIDER`, `ACTIVE_LLM_MODEL`) and overridable per session from the Settings Panel (persisted to `localStorage`). All calls are wrapped in `withRetry()` for rate-limit handling. `structuredOutput<T>()` is used wherever the agent needs typed JSON (test plans, intents, clarification lists).

### Backend

Express + Socket.IO in `dashboard/backend/server.js`. Key routes:

- `POST /api/converse` — phase-routed conversational endpoint (`clarify` → `plan_review` → `tc_review` → `executing`); emits `converse_thinking`, `converse_clarify`, `converse_plan_ready`, `converse_done`.
- `POST /api/jira/sync` — delta or full sync with mutex; persists `sync_meta.json`.
- `POST /api/rag/query` — direct RAG query for the Context Explorer.
- `GET /api/health` — parallel checks of Qdrant, Gemini embeddings, active LLM, and Jira (8s timeout each).
- `GET /api/logs` — recent JSONL log entries.

Conversation state lives in an in-memory `conversationManager` keyed by client `sessionId`. Transcripts are persisted to `artifacts/{jiraId}/conversation.json` on completion. Hourly `pruneStale()` prevents leaks. All `jiraId`-bearing routes go through an `isValidJiraId()` regex guard.

### Frontend

React + Vite SPA in `dashboard/dashboard-app/`. Routes:

| Route | View |
|---|---|
| `/` | `ConversationalAgent` — multi-turn chat with inline cards |
| `/context` | Context Explorer — browse indexed issues + RAG query tester |
| `/plan` | Test Plan |
| `/run` | Live Run |
| `/report` | Execution Report |
| `/bugs` | Bug Triage |
| `/export` | Export |
| `/settings` | Settings |

The conversational thread renders three review-gate cards inline: `ClarificationCard`, `PlanReviewCard`, and `TestCaseReviewCard` (full inline editing — keep/remove, edit title, steps, expected result, target URL). `ExplorationCard` listens for `page_explored` events and lists snapshotted pages live. `ToastCenter` + `LogDrawer` surface structured logs from the backend `logBus` over Socket.IO.

### Logging

`scripts/lib/logger.ts` writes JSONL daily-rotated files to `artifacts/logs/app-YYYY-MM-DD.log` and pushes the same events through an `EventEmitter` bus that Socket.IO bridges to the UI.

---

## Artifact Layout (per ticket)

```
artifacts/{JIRA_ID}/
├── requirements.json        Jira ticket data (normalized via jiraNormalize.js)
├── conversation.json        Full conversational transcript with finalStatus
├── test_plan.json           Planner output
├── page_snapshots/          Playwright ARIA snapshots (.yaml)
├── generated_tests/         LLM-generated .spec.ts files
├── results.json             Execution results
├── bugs.json / discarded_bugs.json
├── summary.docx / testcases.xlsx / bugs.xlsx
└── report.html

artifacts/rag/
├── sync_meta.json           { lastSyncAt, projectKey, totalIssues, lastDeltaCount }
├── index_progress.json      Set of indexed Jira keys (resume support)
└── qdrant_storage/          Qdrant persistent volume
```

---

## Build Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Bug fixes & cleanup | ✅ Done |
| 1 | Qdrant + embeddings + multi-provider LLM | ✅ Done |
| 2 | Jira integration + RAG index + delta sync | ✅ Done |
| 3 | Chat UI, settings, sync button, toasts, ContextView, logger | ✅ Done |
| 4 | Playwright DOM snapshots (`PageExplorer`) | ✅ Done |
| 5 | PlannerAgent, ScriptGenAgent, real-LLM SelfHealer | ✅ Done |
| 6 | Spawn-based execution + ReportView + health check | ✅ Done (6.4 runtime validation pending Jira token) |
| 7 | Bug triage UI + `BugAgent` Jira integration + RAG feedback | ⏳ Todo |
| 8 | Export package (docx + xlsx + endpoints + panel) | ⏳ Todo |
| 9 | E2E smoke + UX polish + cleanup | ⏳ Todo |
| 10.A | Clarifications + Plan Review Gate | ✅ Code complete |
| 10.B | Test Case Review Gate | ✅ Code complete |
| 10.C | Feedback-driven regeneration + conversation viewer | ⏸ Deferred |

A separate production-stack plan (Gemini Flash + DeepSeek + OpenAI embeddings + AWS S3 Vectors on a Hetzner VPS, ~$175/mo) is locked in and waiting on management approval before rollout.

**Current blockers:** Jira API token expired (401) — required to validate Phase 6.4 and unblock Phase 7.

---

## Getting Started

```bash
# Install
npm install
cd dashboard/dashboard-app && npm install

# Start everything (Docker + backend on :5000 + frontend on :5173)
start.bat

# Manual start
docker run -p 6333:6333 -v ./qdrant_storage:/qdrant/storage qdrant/qdrant
node dashboard/backend/server.js
cd dashboard/dashboard-app && npm run dev

# Type-check
npx tsc --noEmit
cd dashboard/dashboard-app && npx tsc --noEmit

# Run a Playwright spec directly
npx playwright test tests/scrum-101.spec.ts --headed
```

### Required `.env` keys (project root)

```
ACTIVE_LLM_PROVIDER=openrouter        # openrouter | groq | openai | google
ACTIVE_LLM_MODEL=qwen/qwen3-coder:free
OPENROUTER_API_KEY= ...
GROQ_API_KEY= ...
OPENAI_API_KEY= ...
GOOGLE_LLM_API_KEY= ...

GOOGLE_API_KEY= ...                   # embeddings (gemini-embedding-001)
GEMINI_EMBED_MODEL=models/gemini-embedding-001

QDRANT_URL=http://localhost:6333

JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL= ...
JIRA_API_TOKEN= ...
JIRA_PROJECT_KEY=CBOT
JIRA_DEFAULT_ASSIGNEE=

RAG_TOP_K=30
```

---

## Key Files

| File | Purpose |
|---|---|
| `Progress.md` | Live phase-by-phase status tracker |
| `Plan.md` | Full plan with sub-tasks and acceptance criteria |
| `scripts/orchestrate.js` | Main orchestration entry point |
| `scripts/agents/JiraAgent.ts` | Jira fetch, `syncProject`, `shouldIndex` |
| `scripts/agents/RagAgent.ts` | `buildIndex`, `deltaIndex`, 4-layer `ragQuery` |
| `scripts/agents/ClarifierAgent.ts` | LLM-driven gap detection |
| `scripts/agents/PlannerAgent.ts` | TestPlan generation (accepts `clarifierAnswers`) |
| `scripts/agents/PageExplorer.ts` | Playwright ARIA-tree snapshotter |
| `scripts/agents/ScriptGenAgent.ts` | `.spec.ts` generation from snapshots |
| `scripts/lib/llmClient.ts` | Multi-provider LLM router |
| `scripts/lib/embedder.ts` | `embedDocument` / `embedQuery` with `taskType` |
| `scripts/lib/vectorStore.ts` | Qdrant wrapper |
| `scripts/lib/conversationManager.js` | In-memory session store + transcript persistence |
| `scripts/lib/jiraNormalize.js` | ADF → flat description extraction |
| `scripts/lib/healthCheck.js` | Parallel infra checks |
| `dashboard/backend/server.js` | Express + Socket.IO; all REST routes; mutex flags |
| `src/components/ConversationalAgent.tsx` | Main chat thread |
| `src/components/ClarificationCard.tsx` / `PlanReviewCard.tsx` / `TestCaseReviewCard.tsx` / `ExplorationCard.tsx` | Inline review-gate cards |
