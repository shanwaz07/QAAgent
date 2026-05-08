# QA Agent Family — Master Project Plan

> ## How to Read This Plan
>
> This document has accumulated across two design eras. Read carefully before starting any task:
>
> - **Phases 0–9** describe the **original one-shot pipeline** (user types → system runs everything end-to-end). Phases 0–6 are **built and working today**. Phases 7–9 were planned but never started under that design.
>
> - **Phase 10** is the **current direction**. It is a UX pivot, not a rewrite. The existing agents and the orchestration pipeline are kept; what changes is the entry point and the addition of human-in-the-loop review gates (clarifying questions → test plan review → optional test case review → execute).
>
> - **Phases 10.A and 10.B are code-complete** (awaiting runtime validation). Phase 10.A also got a follow-up pass of 5 review-driven bug fixes. Phase 10.C is the only remaining sub-phase and is currently deferred. Phases 7–9 remain on hold until Phase 10 stabilises.
>
> - **An in-flight `targetUrl` fix from late Phase 6** (chat URL ignored, `process.env.APP_URL` used instead) was partially landed in `server.js`, `orchestrate.js`, and `PlannerAgent.ts`. The remaining piece (`ChatInput.tsx`) is **deliberately abandoned** because Phase 10.A deletes that component. The new `/api/converse` endpoint always carries `targetUrl` through the session, so the bug is closed by Phase 10.A as a side effect.
>
> - **Always read `Progress.md` first** for live status. This plan describes intent; Progress.md describes reality.

## What This Project Is

An AI-powered, end-to-end QA orchestration platform. The user types a natural language command like **"do full testing on userstory CBOT-421"**, and the system autonomously:

- Reads and understands the Jira story
- Builds context from the entire project history via RAG (Retrieval-Augmented Generation)
- Generates a structured test plan and test cases
- Writes Playwright TypeScript automation scripts using real DOM snapshots (zero locator guesswork)
- Executes each test in a visible browser so the user can watch
- Triages bugs with screenshots in the dashboard UI
- Lets the user log valid bugs to Jira in one click (with all fields + screenshot attached) or discard with a mandatory explanation (fed back into the RAG)
- Exports an AI summary (Word), test cases (Excel), and bugs (Excel)

**Target application under test**: OrangeHRM demo (`https://opensource-demo.orangehrmlive.com`)
**Tech stack**: Node.js · TypeScript · Playwright · React 19 · Vite · Express · Socket.IO · Qdrant · Google Gemini · OpenRouter / Groq / OpenAI / Google (user-selectable)

---

## Current State of the Codebase

### What Is Fully Working Today

| Component | File(s) | What it does |
|---|---|---|
| Playwright test execution | `tests/scrum-101.spec.ts`, `tests/scrum-200.spec.ts` | Real headed browser tests against OrangeHRM |
| Page Object Models | `artifacts/SCRUM-101/scripts/ProfilePage.ts`, `artifacts/SCRUM-200/scripts/AdminPage.ts` | Encapsulate locators and page navigation |
| Orchestrator | `scripts/orchestrate.js` | Exported module `orchestrate(jiraId, io, options)`, called from server.js |
| HTML Report generator | `scripts/generate_report.js` | Generates dark-themed HTML from results.json + insights.json |
| Dashboard backend | `dashboard/backend/server.js` | Express + Socket.IO on port 5000; full REST API + sync/chat/orchestrate routes |
| Dashboard frontend | `dashboard/dashboard-app/src/App.tsx` | React SPA with sidebar routing; Chat, Context, Live Run, Settings, Sync, Logs |
| Jira sync + RAG index | `scripts/agents/JiraAgent.ts`, `RagAgent.ts` | 4-layer RAG, delta/full sync, Qdrant-backed, score-thresholded results |
| LLM client | `scripts/lib/llmClient.ts` | Multi-provider (OpenRouter/Groq/OpenAI/Google), rate-limit retry, structured output |
| Embeddings | `scripts/lib/embedder.ts` | `gemini-embedding-001` 3072-dim; `embedDocument`/`embedQuery` with correct `taskType` |
| Vector store | `scripts/lib/vectorStore.ts` | Qdrant wrapper: createCollection, recreateCollection, upsert, query, delete |
| Structured logger | `scripts/lib/logger.ts` | JSONL daily log files, EventEmitter bus → Socket.IO toasts + log drawer |
| Chat UI | `src/components/ChatInput.tsx` | NL input → RAG → LLM intent extraction → confirmation card → orchestrate |
| Settings Panel | `src/components/SettingsPanel.tsx` | RAG_TOP_K slider, execution mode, LLM provider/model selectors |
| Sync button | `src/components/SyncButton.tsx` | Delta/full sync trigger, last-sync time, mutex status (locked during execution) |
| Context Explorer | `src/components/ContextView.tsx` | Browse all indexed issues (filter/search/paginate) + RAG query tester with score bars |
| Toast + log drawer | `src/components/ToastCenter.tsx` | WARN/ERROR toasts from Socket.IO; full log history drawer |
| start.bat | `start.bat` | Launches Docker + backend + frontend; cleans up all processes on close |

### What Is Stubbed / Placeholder Today

| Component | File | Reality |
|---|---|---|
| Self-Healing Agent | `scripts/SelfHealer.js` | Regex heuristics only — NOT a real LLM call |
| Jira Integration | `scripts/orchestrate.js` comments | Reads static JSON files — NO real Jira API |
| Test Generation | `scripts/orchestrate.js` phase logs | Log messages only — no AI generation |
| Script Generation | `scripts/orchestrate.js` phase logs | Log messages only — no code generation |
| Bug Agent | `scripts/orchestrate.js` comments | Log messages only — no Jira bug creation |
| Email Sending | `automated_execution.js` | Writes preview .txt file — nodemailer unused |

### Known Bugs to Fix (Phase 0)

| Bug | File:Line | Impact |
|---|---|---|
| Orchestrator infinite reconnect loop | `orchestrate.js` — `socket.on('connect', ...)` | Re-runs pipeline on every socket reconnect until killed |
| TC_UI_03 always fails | `tests/scrum-101.spec.ts:35` | OrangeHRM silently caps input, doesn't show error text |
| Legacy dead dashboard | `dashboard/frontend/Dashboard.js` | Wrong port (4000), never used |
| Duplicate faker package | `package.json` | `faker@6.6.6` (deprecated) + `@faker-js/faker@10.4.0` both installed |

---

## Technology Stack (Final Decisions)

| Layer | Tool | Why |
|---|---|---|
| Vector DB | **Qdrant** (local Docker) | Open source Apache 2.0, free to self-host, production-grade |
| Embeddings | **Google Gemini gemini-embedding-001** | Free tier; 3072 dims; uses `RETRIEVAL_DOCUMENT`/`RETRIEVAL_QUERY` taskType for sharp retrieval |
| LLM | **User-selectable via UI + `.env`** | OpenRouter / Groq / OpenAI / Google — no local install required |
| DOM reading | **Playwright MCP** (Microsoft, Apache 2.0) | Reads real accessibility tree → accurate locators, no guessing |
| Browser | **Playwright headed mode** | User watches every test run live |
| Script + execution | **Sequential** | Generate one script → execute → next. Safer, debuggable |
| Word export | **docx** npm package | Pure TypeScript, no native deps |
| Excel export | **ExcelJS** | Already installed |
| Jira API | **axios** | Already installed, Jira REST v3 |

### LLM Provider Options (all OpenAI-compatible, switchable via UI or `.env`)

| Provider | Default Model | Notes |
|---|---|---|
| **OpenRouter** | `qwen/qwen3-coder:free` | Aggregator — access to 200+ models, free tier available |
| **Groq** | `llama-3.3-70b-versatile` | Fastest inference, generous free tier |
| **OpenAI** | `gpt-4o-mini` | Industry standard, pay-per-use |
| **Google** | `gemini-2.0-flash` | Same key as embeddings, cost-effective |

Active provider and model are set in `.env` (`ACTIVE_LLM_PROVIDER` + `ACTIVE_LLM_MODEL`) and overridable from the Settings Panel in the UI per session. `llmClient.ts` routes to the correct provider — no code changes needed to switch.

### Embedding Cost Reality
- 500 Jira issues × ~500 tokens = 250K tokens per full sync → **$0 on free tier**
- Daily incremental syncs (only new/changed issues) → **$0**
- Free tier sufficient unless project exceeds ~50K issues/day
- **Important**: Anthropic Claude has NO embeddings API — embeddings must use another provider

### Migration Path

| Component | Default | Upgrade |
|---|---|---|
| LLM | OpenRouter (Qwen2.5-Coder:7B) | Change `ACTIVE_LLM_PROVIDER` + `ACTIVE_LLM_MODEL` in `.env` |
| Embeddings | Google Gemini free tier | Gemini paid ($0.025/MTok) when volume exceeds 1M tokens/day |
| Vector DB | Qdrant local Docker | Qdrant Cloud |

`llmClient.ts` and `embedder.ts` are wrapper abstractions — swap provider by changing `.env` only, no code changes.

---

## Environment Setup

### `.env` file (create at project root, never commit)
```
# LLM Provider — set ACTIVE_LLM_PROVIDER to: openrouter | groq | openai | google
ACTIVE_LLM_PROVIDER=openrouter
ACTIVE_LLM_MODEL=qwen/qwen3-coder:free

# OpenRouter — https://openrouter.ai/keys
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Groq — https://console.groq.com/keys
GROQ_API_KEY=
GROQ_BASE_URL=https://api.groq.com/openai/v1

# OpenAI — https://platform.openai.com/api-keys
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1

# Google Gemini LLM — https://aistudio.google.com
GOOGLE_LLM_API_KEY=
GOOGLE_LLM_MODEL=gemini-2.0-flash

# Embeddings — Google Gemini (gemini-embedding-001, 3072 dims)
GOOGLE_API_KEY=
GEMINI_EMBED_MODEL=models/gemini-embedding-001

# Vector DB — Qdrant local Docker, no key needed
QDRANT_URL=http://localhost:6333

# Jira
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=
JIRA_API_TOKEN=
JIRA_PROJECT_KEY=CBOT
JIRA_DEFAULT_ASSIGNEE=

# RAG tuning — UI slider overrides this per session
RAG_TOP_K=30
```

### Services to start before development
```bash
# Qdrant vector DB
docker run -p 6333:6333 -v ./qdrant_storage:/qdrant/storage qdrant/qdrant

# Ollama LLM (after installing from ollama.ai)
ollama serve
ollama pull qwen2.5-coder:7b

# Dashboard backend
node dashboard/backend/server.js

# Dashboard frontend
cd dashboard/dashboard-app && npm run dev
```

---

## New Dependencies to Add

### Root `package.json`
```
@qdrant/js-client-rest    Qdrant vector DB Node.js client
@google/generative-ai     Google Gemini SDK (text-embedding-004)
@playwright/mcp           Playwright MCP server for DOM snapshots
docx                      Word .docx generation
form-data                 Multipart upload for Jira screenshot attachments
dotenv                    .env file loading
```

### `dashboard/dashboard-app/package.json`
```
react-router-dom          Client-side routing for new views
react-markdown            Render AI summary in dashboard
```

---

## Full Project Structure (After All Phases Complete)

```
QA_Agent_Family/
├── .env                                     [NEW] API keys and config
├── Plan.md                                  [THIS FILE]
├── Progress.md                              [NEW] Live status tracker — read first every session
├── CLAUDE.md                                [UPDATED]
├── playwright.config.ts                     [MODIFIED] Add JSON reporter
├── package.json                             [MODIFIED] New dependencies
│
├── scripts/
│   ├── orchestrate.js                       [REFACTORED] Exported module orchestrate(jiraId, io, options)
│   ├── SelfHealer.js                        [UPGRADED] Real Ollama LLM call (same interface)
│   ├── generate_report.js                   [MINOR UPDATE]
│   ├── agents/
│   │   ├── JiraAgent.ts                     [NEW] Jira REST: fetch issues, create bugs, attach screenshots
│   │   ├── RagAgent.ts                      [NEW] Qdrant: build index, 4-layer query expansion
│   │   ├── PageExplorer.ts                  [NEW] Playwright MCP: capture real DOM snapshots
│   │   ├── PlannerAgent.ts                  [NEW] Ollama LLM: generate structured test plan JSON
│   │   ├── ScriptGenAgent.ts                [NEW] Ollama LLM: generate .spec.ts from test case + DOM snapshot
│   │   ├── BugAgent.ts                      [NEW] Jira bug creation + discard + re-embed to Qdrant
│   │   └── ExportAgent.ts                   [NEW] docx AI summary + xlsx test cases + xlsx bugs
│   └── lib/
│       ├── llmClient.ts                     [NEW] Ollama REST wrapper (OpenAI-compatible API)
│       ├── jiraClient.ts                    [NEW] axios wrapper for Jira REST v3
│       ├── vectorStore.ts                   [NEW] Qdrant client wrapper
│       └── embedder.ts                      [NEW] Google Gemini embedding wrapper
│
├── dashboard/
│   ├── backend/
│   │   └── server.js                        [EXTENDED] New REST routes + orchestrator as module
│   └── dashboard-app/src/
│       ├── App.tsx                          [EXTENDED] react-router-dom + new routes
│       ├── components/
│       │   ├── ChatInput.tsx                [NEW] Natural language input + confirmation card
│       │   ├── TestPlanView.tsx             [NEW] Generated test cases list with badges
│       │   ├── BugTriage.tsx                [NEW] Bug cards: screenshot + Log/Discard buttons
│       │   ├── ReportView.tsx               [NEW] Per-test result cards with status + screenshots
│       │   ├── ExportPanel.tsx              [NEW] Download buttons: Word + 2 Excel files
│       │   └── SettingsPanel.tsx            [NEW] RAG_TOP_K slider + LLM model selector
│       └── hooks/
│           └── useOrchestrator.ts           [NEW] Socket.IO + REST state management
│
├── tests/
│   ├── scrum-101.spec.ts                    [BUG FIX] Fix TC_UI_03
│   ├── scrum-200.spec.ts                    [KEEP]
│   └── generated/                           [NEW] LLM-generated specs per run
│
└── artifacts/
    ├── rag/
    │   ├── qdrant_storage/                  [NEW] Qdrant Docker volume
    │   └── jira_raw_{PROJECT}.json          [NEW] Raw Jira issues cache
    ├── settings.json                        [NEW] Persisted UI settings
    └── {JIRA_ID}/
        ├── requirements.json                [EXISTING]
        ├── test_plan.json                   [NEW] LLM-generated test plan
        ├── page_snapshots/                  [NEW] Playwright MCP DOM snapshots
        │   └── {page_name}.yaml
        ├── generated_tests/                 [NEW] LLM-generated .spec.ts files
        │   └── {tc_id}.spec.ts
        ├── results.json                     [EXISTING]
        ├── insights.json                    [EXISTING]
        ├── bugs.json                        [NEW] Detected bugs
        ├── discarded_bugs.json              [NEW] Discards with user explanation
        ├── summary.docx                     [NEW] AI summary Word doc
        ├── testcases.xlsx                   [NEW] Test cases with status
        ├── bugs.xlsx                        [NEW] Bugs with Jira IDs
        └── report.html                      [EXISTING]
```

---

## Backend API Routes

```
# Existing — keep
GET  /api/results/:jiraId           Return results.json
GET  /artifacts/*                   Static file serving

# Jira + RAG (implemented)
POST /api/jira/sync                 Full or delta sync; body: { projectKey, delta: bool }
GET  /api/jira/sync-status          Returns { lastSyncAt, totalIssues, isSyncing, isExecuting }
GET  /api/jira/issues               List all synced issues from raw cache
POST /api/rag/query                 RAG search; body: { query, topK }; returns scored results
GET  /api/logs                      Recent structured logs; ?lines=N&date=YYYY-MM-DD

# Chat + Orchestration (implemented)
POST /api/chat                      Natural language → intent + jiraId via RAG + LLM
POST /api/orchestrate               Start sequential agent pipeline for a jiraId
GET  /api/testplan/:jiraId          Return test plan JSON
GET  /api/report/:jiraId            Return execution results
GET  /api/bugs/:jiraId              Return detected bugs for triage
GET  /api/settings                  Return current settings
POST /api/settings                  Save settings to artifacts/settings.json

# Environment health (implemented)
GET  /api/health                    Check all dependencies in parallel; 200=all ok, 207=partial failure
                                    Returns: { checks: [{name, status, message, latency}], activeLlmProvider, activeLlmModel, timestamp }

# Future (Phases 7–8)
POST /api/bugs/:jiraId/log          Create Jira bug + attach screenshot
POST /api/bugs/:jiraId/discard      Save explanation + re-embed to Qdrant
GET  /api/export/:jiraId/summary    Stream summary.docx
GET  /api/export/:jiraId/testcases  Stream testcases.xlsx
GET  /api/export/:jiraId/bugs       Stream bugs.xlsx
```

## Socket.IO Events

```
# Existing
update_status      client → server    Orchestrator phase update
status_changed     server → clients   Rebroadcast to dashboard

# Sync (implemented)
sync_status        server → clients   { syncing, done, error, message }
sync_meta_update   server → clients   { lastSyncAt, totalIssues, projectKey }
execution_status   server → clients   { executing, jiraId }

# Logging (implemented)
app_log            server → clients   { ts, level, context, message, meta? }
log_history        server → clients   Last 50 log entries on socket connect

# Future (Phases 5–8)
plan_generated     { jiraId, testPlan }
page_explored      { jiraId, page, snapshotPath }
script_generated   { jiraId, tcId, scriptPath }
test_result        { jiraId, tcId, status, duration, screenshot }
bugs_detected      { jiraId, bugs[] }
export_ready       { jiraId }
```

---

## Key Design Decisions

### 1. Orchestrator becomes a server module (fixes infinite loop bug)
Current `orchestrate.js` connects as a Socket.IO **client** — causing reconnect loops. Fix: export `async function orchestrate(jiraId, io, options)` and call it directly from `server.js`. The live `io` instance is passed in. CLI mode preserved for backward compatibility.

### 2. Advanced RAG — 4 layers, no Jira parent-child links required
Most teams don't link stories to epics in Jira. The RAG works without any links:
1. **Flat top-K retrieval** — cosine similarity → top-30 issues
2. **Label/component expansion** — pull all issues sharing same labels/components
3. **Semantic second-hop** — re-query Qdrant using each top-30 result as a new query
4. **Module keyword spike** — keyword filter for module names in user input (e.g. "login", "admin")

### 3. DOM snapshots eliminate locator guesswork
Before generating any script, `PageExplorer.ts` uses Playwright MCP to navigate to the target page and call `browser_snapshot`. This returns a structured YAML accessibility tree:
```yaml
- textbox "Username" [ref=e12]
- textbox "Password" [ref=e14]
- button "Login" [ref=e16]
```
The LLM uses these real refs to generate `getByRole('textbox', { name: 'Username' })` style locators. No XPath guessing.

### 4. Sequential execution — one test at a time
Generate script → explore DOM → generate → execute → capture result → next test case.
User watches each test in the visible browser window.

### 5. RAG_TOP_K and LLM provider tunable from UI
Settings panel has a RAG slider (5–100, default 30) and a multi-provider LLM selector (OpenRouter / Groq / OpenAI / Google) with a model dropdown per provider. All values stored in localStorage, sent in every `POST /api/orchestrate` request body. `.env` values are server-side defaults only — UI overrides win per-session.

### 6. Embedding taskType is critical for retrieval quality
`gemini-embedding-001` must use `taskType: RETRIEVAL_DOCUMENT` when indexing and `taskType: RETRIEVAL_QUERY` when searching. Without this, documents and queries share the same generic vector space and all cosine similarities cluster at ~0.78–0.80. With correct task types, relevant matches score 0.68–0.80 and irrelevant queries return `[]` (filtered by `MIN_RETURN_SCORE = 0.62`).

### 7. Delta sync + mutual exclusion
`sync_meta.json` stores `lastSyncAt`; delta sync fetches only issues updated since that timestamp. Two server-side mutex flags (`isSyncing`, `isExecuting`) prevent sync during test execution and vice versa — 409 responses if blocked. Sync status is broadcast over Socket.IO to all clients. Full sync always calls `recreateCollection()` first to purge stale vectors.

### 8. JQL filter: To Do Stories/Epics excluded
Task, Sub-task, Bug → indexed at any status. Story, Epic → only indexed when status ≠ "To Do". During delta sync, issues that move *to* "To Do" are detected and deleted from Qdrant. Issues with no description, no labels, no components, and summary ≤40 chars are skipped at index time (they produce near-identical vectors and pollute similarity results).

### 9. Structured logger bridges to Socket.IO
All server-side activity is logged via `scripts/lib/logger.ts` (JSONL daily files + EventEmitter `logBus`). The bus is wired to `io.emit('app_log', entry)` — every log line reaches connected clients in real time. WARN/ERROR entries surface as auto-dismissing toasts in the UI; the full log history is accessible via the Log Drawer.

### 10. Bug discard feeds back into RAG
When a user discards a bug with an explanation ("this is expected behavior because…"), that explanation is embedded via Gemini and upserted into Qdrant as a `false_positive` entry. On the next run for a similar flow, the LLM receives this context and avoids re-flagging the same scenario.

---

## Sequential Execution Flow (Per Test Case)

```
For each test case in the plan:

  Step 1 — Page Exploration
    PageExplorer.ts → Playwright MCP browser_snapshot
    Returns: YAML accessibility tree with real element refs
    Saved: artifacts/{JIRA_ID}/page_snapshots/{page}.yaml

  Step 2 — Script Generation
    ScriptGenAgent.ts → LLM via llmClient.ts (provider set in .env or UI Settings)
    Input: test steps + page snapshot YAML + ProfilePage.ts as few-shot example
    Output: complete .spec.ts with semantic locators
    Saved: artifacts/{JIRA_ID}/generated_tests/{tc_id}.spec.ts

  Step 3 — Execution
    child_process.spawn → npx playwright test {tc_id}.spec.ts --headed
    Streams stdout line-by-line → test_result socket event per test
    User watches browser window live

  Step 4 — Result
    Capture pass/fail/screenshot → update results.json
    Move to next test case
```

---

## Bug Triage Flow

```
After all tests complete:
  → Collect failed tests + screenshots → bugs.json
  → Emit: bugs_detected socket event

BugTriage.tsx shows one card per bug:
  [ Screenshot ] [ Title ] [ Steps to Reproduce ]
  [ Severity ▾ ] [ Priority ▾ ] [ Assignee ____________ ]
  [ LOG TO JIRA ] [ DISCARD ]

Log to Jira:
  POST /api/bugs/:jiraId/log
  → Jira REST: POST /rest/api/3/issue (all fields)
  → Jira REST: POST /rest/api/3/issue/{id}/attachments (screenshot)
  → UI card shows Jira ticket link

Discard (mandatory explanation required):
  POST /api/bugs/:jiraId/discard { explanation: "..." }
  → Saved to discarded_bugs.json
  → Gemini embeds explanation → upserted into Qdrant
  → metadata: { type: "false_positive", testCaseId, jiraId }
  → Next similar run: LLM receives this as context
```

---

## Export Package

| File | Contents |
|---|---|
| `summary.docx` | AI-written: Executive Summary, Test Scope, Risk Areas, Recommendations |
| `testcases.xlsx` | TC ID, Title, Type, Priority, Steps, Expected Result, Status (colour-coded) |
| `bugs.xlsx` | Bug Title, Summary, Jira Bug ID (if logged), Severity, Priority, Status |

Status colour coding in Excel: Passed = green, Failed = red, Not Executed = grey.

---

## Dashboard UI — All Views

| Route | View | Status | Purpose |
|---|---|---|---|
| `/` | Chat | ✅ Done | Natural language input + confirmation card |
| `/context` | Context Explorer | ✅ Done | Browse all indexed issues + RAG query tester |
| `/plan` | Test Plan | ⏳ Phase 5 | Generated test cases with type/priority badges |
| `/run` | Live Run | ✅ Done (basic) | Execution stream, per-test results as they arrive |
| `/report` | Report | ⏳ Phase 6 | Full execution summary, screenshots, metrics |
| `/bugs` | Bug Triage | ⏳ Phase 7 | Bug cards with Log/Discard actions |
| `/export` | Export | ⏳ Phase 8 | Download Word + 2 Excel files |
| `/settings` | Settings | ✅ Done | RAG_TOP_K slider, execution mode, LLM model selector |

---

## Phase Plan — All Phases with Tasks and Sub-tasks

---

### Phase 0 — Bug Fixes & Cleanup
**Goal**: Stabilise the existing codebase before building new features.

- [ ] **0.1** Fix orchestrator infinite reconnect loop
  - [ ] 0.1.1 Export `async function orchestrate(jiraId, io, options)` from `orchestrate.js`
  - [ ] 0.1.2 Remove `socket.io-client` import from `orchestrate.js`
  - [ ] 0.1.3 Import `orchestrate` in `server.js` and call with the live `io` instance
  - [ ] 0.1.4 Preserve CLI: `node scripts/orchestrate.js SCRUM-101` still works
- [ ] **0.2** Fix TC_UI_03 failing test
  - [ ] 0.2.1 Open OrangeHRM, type 201 chars in Nickname, inspect actual DOM feedback
  - [ ] 0.2.2 Update locator in `tests/scrum-101.spec.ts:35` to match real text
- [ ] **0.3** Remove legacy dashboard
  - [ ] 0.3.1 Delete `dashboard/frontend/Dashboard.js`
- [ ] **0.4** Clean up duplicate faker dependency
  - [ ] 0.4.1 Remove `faker@6.6.6` from `package.json`
  - [ ] 0.4.2 Confirm `@faker-js/faker` is used everywhere faker is needed
- [ ] **0.5** Create `.env` and dotenv setup
  - [ ] 0.5.1 Add `.env` to `.gitignore`
  - [ ] 0.5.2 Add `dotenv` to `package.json` dependencies
  - [ ] 0.5.3 `require('dotenv').config()` at top of `server.js` and `orchestrate.js`
  - [ ] 0.5.4 Create `.env` template with all keys (values empty)

---

### Phase 1 — Infrastructure: LLM + Embeddings + Vector DB
**Goal**: Validate all three infrastructure components independently.

- [ ] **1.1** Qdrant vector DB (local Docker)
  - [ ] 1.1.1 Run: `docker run -p 6333:6333 -v ./qdrant_storage:/qdrant/storage qdrant/qdrant`
  - [ ] 1.1.2 Add `@qdrant/js-client-rest` to `package.json`; run `npm install`
  - [ ] 1.1.3 Create `scripts/lib/vectorStore.ts`:
    - `createCollection(name, vectorSize)` — creates if not exists
    - `upsert(collection, id, vector, payload)` — insert/update a point
    - `query(collection, vector, topK)` — cosine similarity search
    - `delete(collection, id)` — remove a point
  - [ ] 1.1.4 Validate: create "test" collection → upsert 3 points → query top-2 → verify correct returns
- [ ] **1.2** Google Gemini embeddings
  - [ ] 1.2.1 User creates Google AI Studio key at aistudio.google.com (free, no credit card)
  - [ ] 1.2.2 Add `@google/generative-ai` to `package.json`; run `npm install`
  - [ ] 1.2.3 Create `scripts/lib/embedder.ts`:
    - `embed(text: string): Promise<number[]>` — calls `text-embedding-004`
    - Returns 768-dimension float array
  - [ ] 1.2.4 Validate: embed "Login to OrangeHRM" → confirm 768-dimension vector returned
- [ ] **1.3** Ollama LLM
  - [ ] 1.3.1 User installs Ollama from ollama.ai
  - [ ] 1.3.2 User runs: `ollama pull qwen2.5-coder:7b`
  - [ ] 1.3.3 Create `scripts/lib/llmClient.ts`:
    - `chat(messages: Message[], options?): Promise<string>` — general text generation
    - `structuredOutput<T>(messages: Message[], schema: object): Promise<T>` — returns typed JSON
    - Uses Ollama's OpenAI-compatible API at `localhost:11434/v1`
  - [ ] 1.3.4 Validate: send "Write a Playwright test for login" → receive TypeScript code back
- [ ] **1.4** End-to-end infra validation
  - [ ] 1.4.1 Embed "Add employee to OrangeHRM PIM" with Gemini
  - [ ] 1.4.2 Store vector in Qdrant "test" collection
  - [ ] 1.4.3 Query with "employee management" → verify original entry is top result

---

### Phase 2 — Jira Integration + RAG Index
**Goal**: Pull real Jira data, build the vector index, validate 4-layer retrieval.

- [ ] **2.1** Jira API client (`scripts/lib/jiraClient.ts`)
  - [ ] 2.1.1 `fetchIssues(jql, fields, maxTotal?)`: paginated GET `/rest/api/3/search`
  - [ ] 2.1.2 `getIssue(issueKey)`: GET `/rest/api/3/issue/{key}`
  - [ ] 2.1.3 `createIssue(fields)`: POST `/rest/api/3/issue`
  - [ ] 2.1.4 `attachFile(issueId, filePath)`: POST `/rest/api/3/issue/{id}/attachments` (multipart)
  - [ ] 2.1.5 Auth: `Authorization: Basic base64(email:api_token)` header on all requests
  - [ ] 2.1.6 Validate: fetch first 5 issues from project → log summaries to console
- [ ] **2.2** JiraAgent (`scripts/agents/JiraAgent.ts`)
  - [ ] 2.2.1 `syncProject(projectKey)`:
    - JQL: `project = {key} AND issuetype in (Story, Epic, Task, Sub-task) AND status in ("To Do", "Idea")`
    - Paginate until all results fetched
  - [ ] 2.2.2 `syncBugs(projectKey)`:
    - JQL: `project = {key} AND issuetype = Bug`
    - All statuses
  - [ ] 2.2.3 Save combined raw data to `artifacts/rag/jira_raw_{projectKey}.json`
  - [ ] 2.2.4 Validate: sync runs end-to-end, file written with all issues
- [ ] **2.3** RagAgent — index builder (`scripts/agents/RagAgent.ts`)
  - [ ] 2.3.1 `buildIndex(projectKey)`:
    - Read `jira_raw_{projectKey}.json`
    - For each issue: create chunk text `"[ID] [type]: [summary]\n[description]\n[acceptance criteria]"`
    - Embed with Gemini → upsert to Qdrant collection `jira_{projectKey}`
  - [ ] 2.3.2 Validate: vector count in Qdrant matches issue count in raw JSON
- [ ] **2.4** RagAgent — 4-layer query
  - [ ] 2.4.1 `query(userInput, topK, projectKey)`:
    - Layer 1: embed input → cosine similarity → top-K results
    - Layer 2: from retrieved issues, collect all unique labels + components → fetch Jira issues matching any of those labels/components
    - Layer 3: re-embed each of the top-K results → re-query Qdrant → collect nearest neighbors (deduplicate)
    - Layer 4: detect module keywords in input (login, admin, profile, employee, PIM, etc.) → keyword filter on Qdrant payload
    - Return deduplicated, ranked array of issue objects
  - [ ] 2.4.2 Validate: "testing the login feature" → top results are login-related issues
  - [ ] 2.4.3 Validate: "employee creation in PIM" → top results are PIM/employee issues
- [ ] **2.5** Backend route `POST /api/jira/sync`
  - [ ] 2.5.1 Call `JiraAgent.syncProject()` + `JiraAgent.syncBugs()` + `RagAgent.buildIndex()`
  - [ ] 2.5.2 Emit socket events: "Fetching Jira issues...", "Building RAG index...", "Sync complete: N issues indexed"
  - [ ] 2.5.3 Return `{ issueCount, indexedAt }` in response body
  - [ ] 2.5.4 Validate via curl: `curl -X POST http://localhost:5000/api/jira/sync`

---

### Phase 3 — Natural Language Chat UI
**Goal**: User types natural language, system identifies the right Jira ticket and confirms.

- [ ] **3.1** Backend `POST /api/chat`
  - [ ] 3.1.1 Embed the user message with Gemini
  - [ ] 3.1.2 Query RagAgent top-5 for most relevant issues
  - [ ] 3.1.3 Build Ollama prompt with known Jira IDs in system prompt (prevents hallucination)
  - [ ] 3.1.4 Structured output schema: `{ intent: "full_test"|"smoke_test"|"regression", jiraId: string, confirmationMessage: string }`
  - [ ] 3.1.5 Validate: "do full testing on CBOT-421" → `{ jiraId: "CBOT-421", intent: "full_test" }`
  - [ ] 3.1.6 Validate: "smoke test the login flow" → returns login-related ticket ID
- [ ] **3.2** `ChatInput.tsx`
  - [ ] 3.2.1 Full-width text input with placeholder: "e.g. do full testing on userstory CBOT-421"
  - [ ] 3.2.2 Submit button + Enter key support
  - [ ] 3.2.3 Loading skeleton while backend processes
  - [ ] 3.2.4 Confirmation card: ticket ID badge, title, intent badge, "Proceed" + "Cancel" buttons
  - [ ] 3.2.5 "Proceed" → `POST /api/orchestrate` with `{ jiraId, ragTopK, executionMode }`
- [ ] **3.3** `SettingsPanel.tsx`
  - [ ] 3.3.1 RAG Context Depth slider: min=5, max=100, step=5, default=30
    - Label: "Context Depth (RAG results): [value]"
    - Stored in `localStorage('ragTopK')`
  - [ ] 3.3.2 Execution Mode radio: Smoke / Full / Regression
    - Stored in `localStorage('executionMode')`
  - [ ] 3.3.3 Browser visibility toggle: Headed (visible) / Headless
    - Stored in `localStorage('headless')`
  - [ ] 3.3.4 LLM Provider dropdown: OpenRouter / Groq / OpenAI / Google
    - Stored in `localStorage('llmProvider')`
    - Changing provider updates the model list below
  - [ ] 3.3.5 LLM Model dropdown (provider-aware):
    - OpenRouter: free-text input (any model slug, e.g. `qwen/qwen-2.5-coder-7b-instruct`)
    - Groq: `llama-3.3-70b-versatile`, `llama3-8b-8192`, `mixtral-8x7b-32768`
    - OpenAI: `gpt-4o`, `gpt-4o-mini`, `o3-mini`
    - Google: `gemini-2.0-flash`, `gemini-2.5-pro`
    - Stored in `localStorage('llmModel')`
  - [ ] 3.3.6 Save button → `POST /api/settings` → persists to `artifacts/settings.json`
  - [ ] 3.3.7 Backend `GET /api/settings` returns current settings (merge of .env defaults + saved overrides)
- [ ] **3.4** `react-router-dom` routing
  - [ ] 3.4.1 Install `react-router-dom` in dashboard-app: `npm install react-router-dom`
  - [ ] 3.4.2 Routes: `/` Chat, `/plan`, `/run`, `/report`, `/bugs`, `/export`, `/settings`
  - [ ] 3.4.3 Left sidebar nav with icons and labels for each route
  - [ ] 3.4.4 Active route highlighted in sidebar

---

### Phase 4 — Page Exploration + DOM Snapshots
**Goal**: Capture real accessibility trees before generating any script. Zero locator guesswork.

- [ ] **4.1** Playwright MCP setup
  - [ ] 4.1.1 Install: `npm install @playwright/mcp`
  - [ ] 4.1.2 Configure MCP server in project (add to Claude Code MCP settings if needed)
  - [ ] 4.1.3 Confirm `browser_snapshot` tool returns YAML accessibility tree
  - [ ] 4.1.4 Confirm element refs (e.g. `[ref=e12]`) are stable within a session
- [ ] **4.2** `PageExplorer.ts` (`scripts/agents/PageExplorer.ts`)
  - [ ] 4.2.1 `explorePage(url, pageName, jiraId, credentials?)`:
    - Launch Playwright MCP browser session
    - Navigate to URL (perform login first if credentials provided)
    - Call `browser_snapshot` → receive YAML
    - Parse YAML into: `{ elements: [{ ref, role, name, type }] }`
    - Save raw YAML to `artifacts/{jiraId}/page_snapshots/{pageName}.yaml`
    - Emit `page_explored` socket event
  - [ ] 4.2.2 `extractInteractiveElements(yaml)`: filter to inputs, buttons, links, selects only
  - [ ] 4.2.3 Validate: explore OrangeHRM login page → snapshot contains Username, Password, Login button
- [ ] **4.3** Multi-page exploration
  - [ ] 4.3.1 From test plan `testCases[].targetPage`, extract unique URLs
  - [ ] 4.3.2 Explore login page first (always)
  - [ ] 4.3.3 After login, navigate to each feature page and snapshot
  - [ ] 4.3.4 Store all snapshots before any script generation begins

---

### Phase 5 — Test Plan + Script Generation (Sequential)
**Goal**: LLM generates test plan + Playwright scripts using real DOM snapshots.

- [ ] **5.1** `PlannerAgent.ts` (`scripts/agents/PlannerAgent.ts`)
  - [ ] 5.1.1 `generatePlan(jiraId, ragContext)`:
    - Load Jira issue from `jira_raw_{projectKey}.json`
    - Include RAG context (top-30 related issues)
    - Ollama structured output — schema:
      ```json
      {
        "testPlanTitle": "string",
        "scope": "string",
        "testTypes": ["UI"],
        "riskAreas": ["string"],
        "testCases": [{
          "id": "TC_001",
          "title": "string",
          "type": "Positive|Negative|Boundary",
          "priority": "High|Medium|Low",
          "steps": ["string"],
          "expectedResult": "string",
          "targetPage": "https://..."
        }]
      }
      ```
    - Write to `artifacts/{jiraId}/test_plan.json`
    - Emit `plan_generated` socket event
  - [ ] 5.1.2 Validate: test plan JSON is valid, contains ≥3 test cases
  - [ ] 5.1.3 Validate: each test case has `targetPage` populated
- [ ] **5.2** `TestPlanView.tsx`
  - [ ] 5.2.1 Display: title, scope, risk areas
  - [ ] 5.2.2 Test cases list with: ID, title, type badge (Positive/Negative/Boundary), priority badge
  - [ ] 5.2.3 "Generate Scripts & Execute" button → starts Phase 4+5+6 pipeline
- [ ] **5.3** `ScriptGenAgent.ts` (`scripts/agents/ScriptGenAgent.ts`)
  - [ ] 5.3.1 Sequential loop — for each test case:
    - [ ] 5.3.1.1 Load page snapshot YAML for `tc.targetPage`
    - [ ] 5.3.1.2 Build prompt:
      - System: "You are a Playwright TypeScript expert. Use the provided DOM snapshot for all locators."
      - DOM snapshot YAML (actual element refs from the live page)
      - Few-shot example: `ProfilePage.ts` POM pattern
      - Test case: title, steps, expected result
    - [ ] 5.3.1.3 Ollama generates complete `.spec.ts` content
    - [ ] 5.3.1.4 Validate TypeScript compiles without errors (`tsc --noEmit`)
    - [ ] 5.3.1.5 Write to `artifacts/{jiraId}/generated_tests/{tc.id}.spec.ts`
    - [ ] 5.3.1.6 Emit `script_generated` socket event: `{ jiraId, tcId, scriptPath }`
  - [ ] 5.3.2 Validate: generated locators use `getByRole()` / `getByLabel()` — not raw XPath
- [ ] **5.4** Upgrade `SelfHealer.js`
  - [ ] 5.4.1 Replace `getAISuggestion(el, err)` regex logic with real Ollama call
  - [ ] 5.4.2 Input to LLM: `{ failedLocator, errorMessage, pageSnapshotYaml }`
  - [ ] 5.4.3 LLM returns: `{ newLocator, reasoning, confidence }`
  - [ ] 5.4.4 Keep external `heal(locator, error)` interface unchanged
  - [ ] 5.4.5 Validate: failed `//label[text()='Nickname']` → LLM returns `getByLabel('Nickname')`

---

### Phase 6 — Execution + Live Dashboard Streaming
**Goal**: Run tests sequentially in visible browser, stream results to dashboard in real time.

- [ ] **6.1** Sequential execution loop in `orchestrate.js`
  - [ ] 6.1.1 Replace `execSync` with `child_process.spawn`
  - [ ] 6.1.2 For each generated spec: `spawn('npx', ['playwright', 'test', specPath, '--headed'])`
  - [ ] 6.1.3 Parse stdout line-by-line for Playwright pass/fail signals
  - [ ] 6.1.4 Emit `test_result` socket event per test: `{ jiraId, tcId, status, duration, screenshot }`
  - [ ] 6.1.5 Wait for each test to fully complete before starting the next
- [ ] **6.2** Update `playwright.config.ts`
  - [ ] 6.2.1 `reporter: ['html', ['json', { outputFile: 'playwright-report/results.json' }]]`
  - [ ] 6.2.2 Ensure `outputDir` captures screenshots for failures
- [ ] **6.3** `ReportView.tsx`
  - [ ] 6.3.1 Overall metrics: Total, Passed, Failed, execution time
  - [ ] 6.3.2 Per-test cards: TC ID, title, status badge, duration, screenshot thumbnail (click to expand)
  - [ ] 6.3.3 "View Full Playwright Report" link → opens `playwright-report/index.html`
  - [ ] 6.3.4 Updates live as `test_result` socket events arrive
- [x] **6.X** Requirements auto-fetch from Jira
  - [x] When `requirements.json` is missing for a ticket, `orchestrate.js` calls `getIssue(jiraId)` via `JiraAgent`
  - [x] `normalizeJiraIssue()` flattens raw Jira response (`fields.summary`, `fields.description` ADF) into flat `{ jiraId, title, description, type, status, labels, components, priority }` format
  - [x] If an existing `requirements.json` contains a raw Jira response (has `.fields`), it is re-normalised and re-saved transparently
  - [x] `extractAdfText()` helper parses Atlassian Document Format description nodes into plain text
- [x] **6.X** Test execution duration tracking
  - [x] `orchestrate.js` records `startMs = Date.now()` before each `runPlaywrightTest()` call
  - [x] `duration` (ms) included in `results.json` entries and `test_result` socket event
  - [x] `ReportView.tsx` displays duration as `1.2s` alongside each test status badge
- [x] **6.X** Environment health check
  - [x] `scripts/lib/healthCheck.js`: parallel checks (8s timeout each) for Qdrant, Google Embeddings, active LLM provider, Jira
  - [x] LLM check uses lightweight model-metadata endpoint (no tokens spent) — supports Google, OpenRouter, Groq, OpenAI
  - [x] Jira 401 returns actionable message: "Token expired — regenerate at id.atlassian.com/…"
  - [x] `GET /api/health` in `server.js` — returns 200 all-ok, 207 partial failure
  - [x] `SettingsPanel.tsx` "Environment Health" card: auto-runs on mount, Re-check button, traffic-light indicators with latency
- [ ] **6.4** Full pipeline validation (Phase 4 → 5 → 6)
  - [ ] 6.4.1 Enter chat input → confirm ticket → test plan generated
  - [ ] 6.4.2 Page snapshots captured with real element refs
  - [ ] 6.4.3 Scripts generated with semantic locators
  - [ ] 6.4.4 Browser opens, tests execute, user watches live
  - [ ] 6.4.5 Results appear on dashboard in real time

---

### Phase 7 — Bug Triage UI + Jira Integration
**Goal**: User reviews detected bugs, logs to Jira or discards with explanation.

- [ ] **7.1** Bug collection after execution
  - [ ] 7.1.1 After all tests complete, read failed tests + screenshot paths
  - [ ] 7.1.2 Build `bugs.json`: `[{ id, tcId, title, steps, errorMessage, screenshotPath, severity, priority }]`
  - [ ] 7.1.3 Emit `bugs_detected` socket event
- [ ] **7.2** `BugTriage.tsx`
  - [ ] 7.2.1 One card per detected bug:
    - Screenshot image (served via `/artifacts`)
    - Bug title (auto-generated: `[TC ID] - [error summary]`)
    - Steps to reproduce (from test case steps)
    - Severity dropdown: Critical / High / Medium / Low
    - Priority dropdown: Highest / High / Medium / Low
    - Assignee text input (pre-filled from `JIRA_DEFAULT_ASSIGNEE` env var)
    - "LOG TO JIRA" button (blue)
    - "DISCARD" button (grey, opens explanation input)
  - [ ] 7.2.2 Show logged Jira ticket link after successful logging
  - [ ] 7.2.3 Show confirmation after discard
  - [ ] 7.2.4 Progress bar: "X of Y bugs triaged"
- [ ] **7.3** `BugAgent.ts` — Jira bug creation
  - [ ] 7.3.1 `logBug(jiraId, bugData)`:
    - `jiraClient.createIssue()`: issuetype=Bug, summary, description (with steps), severity, priority, assignee
    - `jiraClient.attachFile()`: attach screenshot to created issue
    - Return `{ jiraBugId, jiraUrl }`
  - [ ] 7.3.2 Update `bugs.json` with `jiraBugId` and `jiraUrl` fields
  - [ ] 7.3.3 `POST /api/bugs/:jiraId/log` → call `BugAgent.logBug()`
  - [ ] 7.3.4 Validate: real Jira ticket created with screenshot attached, link returned
- [ ] **7.4** Discard + RAG feedback loop
  - [ ] 7.4.1 `POST /api/bugs/:jiraId/discard` → require non-empty `explanation` field
  - [ ] 7.4.2 Append to `discarded_bugs.json`
  - [ ] 7.4.3 `embedder.embed(explanation)` → `vectorStore.upsert()` with payload:
    ```json
    { "type": "false_positive", "testCaseId": "TC_001", "jiraId": "CBOT-421", "explanation": "..." }
    ```
  - [ ] 7.4.4 Validate: discard an item → check Qdrant contains the new false_positive entry
  - [ ] 7.4.5 Validate: run the same test again → false_positive context appears in RAG results

---

### Phase 8 — Export Package
**Goal**: One-click download of AI summary (Word), test cases (Excel), bugs (Excel).

- [ ] **8.1** `ExportAgent.ts` (`scripts/agents/ExportAgent.ts`)
  - [ ] 8.1.1 `generateSummary(jiraId)`:
    - Collect: test plan + results + bugs list + discard explanations
    - Ollama generates summary text: Executive Summary, Test Scope, Risk Areas, Recommendations
    - `docx` package builds Word file with H1/H2 headings, bullet lists, formatted paragraphs
    - Save to `artifacts/{jiraId}/summary.docx`
  - [ ] 8.1.2 `generateTestCasesExcel(jiraId)`:
    - ExcelJS: sheet named "Test Cases"
    - Columns: TC ID, Title, Type, Priority, Steps (multiline cell), Expected Result, Status
    - Status cell fill: Passed=green, Failed=red, Not Executed=grey
    - Save to `artifacts/{jiraId}/testcases.xlsx`
  - [ ] 8.1.3 `generateBugsExcel(jiraId)`:
    - ExcelJS: sheet named "Bugs"
    - Columns: Bug Title, Summary, Jira Bug ID, Severity, Priority, Status
    - Jira Bug ID column: only populated for logged bugs (discarded = blank)
    - Save to `artifacts/{jiraId}/bugs.xlsx`
  - [ ] 8.1.4 `generateAll(jiraId)`: calls all three, emits `export_ready` socket event
- [ ] **8.2** Download endpoints in `server.js`
  - [ ] 8.2.1 `GET /api/export/:jiraId/summary` → `res.download(path/to/summary.docx)`
  - [ ] 8.2.2 `GET /api/export/:jiraId/testcases` → `res.download(path/to/testcases.xlsx)`
  - [ ] 8.2.3 `GET /api/export/:jiraId/bugs` → `res.download(path/to/bugs.xlsx)`
- [ ] **8.3** `ExportPanel.tsx`
  - [ ] 8.3.1 Three download buttons: "AI Summary (.docx)", "Test Cases (.xlsx)", "Bugs (.xlsx)"
  - [ ] 8.3.2 Buttons disabled/grey until `export_ready` socket event received
  - [ ] 8.3.3 Show file size + timestamp after generation
  - [ ] 8.3.4 Validate: Word file opens with correct content; Excel has correct sheets and colours
- [ ] **8.4** Trigger after triage
  - [ ] 8.4.1 Track triage completion state (all bugs logged or discarded)
  - [ ] 8.4.2 Call `ExportAgent.generateAll(jiraId)` on completion
  - [ ] 8.4.3 Or expose "Generate Exports" button in ExportPanel as manual trigger

---

### Phase 9 — End-to-End Validation & Polish
**Goal**: Full pipeline works cleanly, UX is polished, no rough edges.

- [ ] **9.1** Full end-to-end smoke test
  - [ ] 9.1.1 Jira sync → Qdrant has all project issues
  - [ ] 9.1.2 "do full testing on [REAL_TICKET_ID]" → correct ticket confirmed
  - [ ] 9.1.3 Test plan generated with ≥3 test cases, each with targetPage
  - [ ] 9.1.4 Page snapshots captured with real element refs
  - [ ] 9.1.5 Scripts generated — no XPath locators, only semantic locators
  - [ ] 9.1.6 Tests execute in visible Chrome window
  - [ ] 9.1.7 Results stream to dashboard per test
  - [ ] 9.1.8 Bug triage: log one bug → Jira ticket created with screenshot attached
  - [ ] 9.1.9 Bug discard → explanation in Qdrant as false_positive
  - [ ] 9.1.10 Download all 3 export files → verify content correct
- [ ] **9.2** UX polish
  - [ ] 9.2.1 Empty states for every view when no run is active
  - [ ] 9.2.2 Error toasts for: Jira API down, Ollama not running, Qdrant not running
  - [ ] 9.2.3 Loading spinners on all async operations
  - [ ] 9.2.4 Disabled states during long operations (prevent double-submit)
  - [ ] 9.2.5 Responsive layout — works at 1280px and 1920px width
- [ ] **9.3** Cleanup
  - [ ] 9.3.1 Move `automated_execution.js` to `scripts/legacy/` (keep for reference)
  - [ ] 9.3.2 Update `UserGuide.md` with new setup steps (Qdrant, Ollama, Google key)
  - [ ] 9.3.3 Final `CLAUDE.md` review

---

### Phase 10 — Interactive Conversational Agent (Direction Change)

**Why this phase exists.** Phases 0–9 above describe a **one-shot pipeline**: user types a request, system extracts intent, runs everything end-to-end. Most of that pipeline is now built and works (see "What is implemented today" below). However, runtime experience showed the one-shot flow was too opaque — the agent generated naive test cases, used the wrong target URL (`process.env.APP_URL` instead of the URL typed by the user), and gave the user no chance to course-correct.

**The pivot.** Rather than tighten the one-shot prompts, the user asked for an **interactive, multi-turn agent** that asks clarifying questions, presents the test plan for review, presents test cases for review, does light exploratory testing, and only then executes. Phase 10 is that redesign. The existing pipeline is preserved (and reused under the new flow) — only the entry point, conversation state, and review gates are new.

#### What is implemented today (do not redo)

The following work from earlier phases is fully done and is the foundation Phase 10 builds on:

| Component | Status | Notes |
|---|---|---|
| Phase 0–4 (bug fixes, infra, Jira+RAG, chat backend, page exploration) | ✅ Done | See Progress.md |
| Phase 5 (PlannerAgent, TestPlanView, ScriptGenAgent, SelfHealer) | ✅ Done | One-shot test plan + scripts |
| Phase 6.1 — `child_process.spawn` execution loop | ✅ Done | Streams stdout to socket |
| Phase 6.2 — Playwright JSON reporter + `--output` per test | ✅ Done | |
| Phase 6.3 — `ReportView.tsx` with live results + screenshot lightbox | ✅ Done | |
| Phase 6.X — Requirements auto-fetch from Jira (`normalizeJiraIssue`, `extractAdfText`) | ✅ Done | |
| Phase 6.X — Test execution duration tracking | ✅ Done | |
| Phase 6.X — Environment health checks (`/api/health`, SettingsPanel card) | ✅ Done | |

#### What was in flight when the pivot happened (Phase 10 absorbs this)

A targeted bug was being fixed: when the user typed a URL in chat (e.g. `https://leolity-qa.goarya.com/ivyrehab`), the agent ignored it and used `process.env.APP_URL` instead. Three of four files were updated; the fourth (`ChatInput.tsx`) was about to be edited when the user requested the conversational redesign.

| File | Change | Status before pivot |
|---|---|---|
| `dashboard/backend/server.js` | `/api/chat` extracts URL via regex; `/api/orchestrate` forwards `targetUrl` | ✅ Done |
| `scripts/orchestrate.js` | Reads `targetUrl` option, invalidates cached test plan when URL changes, passes to PlannerAgent, uses for page exploration fallback | ✅ Done |
| `scripts/agents/PlannerAgent.ts` | Accepts `targetUrl?: string`; uses as `appUrl` | ✅ Done |
| `dashboard/dashboard-app/src/components/ChatInput.tsx` | Add `targetUrl` to `ChatResponse` interface, pass to `/api/orchestrate`, show in confirmation card | ⏸ Not started — superseded by Phase 10 |

The new `/api/converse` endpoint (Phase 10.3 below) always carries `targetUrl` through the session, so this fix lands automatically as a side effect of Phase 10. **Do not retrofit ChatInput.tsx** — it is being replaced.

#### Phase 10 — Tasks

Detailed plan lives at: `C:\Users\ShanwazHalageri\.claude\plans\peaceful-wandering-widget.md`. Summary below.

**Decisions locked in (from Phase 10 design discussion):**
- Exploratory testing = DOM snapshot + summary report (reuses existing `PageExplorer`)
- Test case review depth = full inline editing of steps + expected result (deferred to Phase 10.B)
- Rollout = ship Phase 10.A first, then iterate
- ChatInput.tsx will be deleted after replacement; conversation transcripts persist to disk for audit

**Phase 10.A — Clarifications + Plan Review Gate (this phase)**

- [ ] **10.A.1** `scripts/lib/conversationManager.js` — in-memory session store keyed by client `sessionId` (UUID, NOT socketId), CRUD + transcript writer
- [ ] **10.A.2** `scripts/agents/ClarifierAgent.ts` — `generateClarifyingQuestions(jiraId, requirements, ragContext, targetUrl)` returns `ClarifyQuestion[]`; returns `[]` when context is sufficient (URL present, scope clear)
- [ ] **10.A.3** `POST /api/converse` route in `server.js` with phase router: `start | answers | approve_plan`; mutex-aware; emits `converse_clarify`, `converse_plan_ready`, `converse_thinking`, `converse_done` socket events
- [ ] **10.A.4** `scripts/agents/PlannerAgent.ts` — accept optional `clarifierAnswers?: Record<string,string>`; inject as "User clarifications" block in user prompt
- [ ] **10.A.5** `scripts/orchestrate.js` — accept `preApprovedPlan?: TestPlan` option; when provided, skip Planning phase entirely (PageExplorer → ScriptGenAgent → execute)
- [ ] **10.A.6** `dashboard/dashboard-app/src/components/ConversationalAgent.tsx` — multi-turn message thread, sticky input bar, sessionStorage resume, renders inline cards by phase
- [ ] **10.A.7** `dashboard/dashboard-app/src/components/ClarificationCard.tsx` — inline form (text + radio inputs), submits answers, locks after submission
- [ ] **10.A.8** `dashboard/dashboard-app/src/components/PlanReviewCard.tsx` — plan summary, collapsible test case list (read-only in 10.A), `[Approve & Run]` and `[Regenerate]` actions
- [ ] **10.A.9** Audit persistence — server writes full transcript to `artifacts/{jiraId}/conversation.json` on completion (includes all turns, plan, answers, timestamps, finalStatus)
- [ ] **10.A.10** `App.tsx` — route `/` to `ConversationalAgent`; **delete** `ChatInput.tsx`
- [ ] **10.A.11** `App.css` — chat thread styles (`.msg-thread`, `.msg-bubble-*`, `.card-clarify`, `.card-plan-review`) using existing CSS variables

**New Socket.IO events:** `converse_thinking`, `converse_clarify`, `converse_plan_ready`, `converse_done`. Existing `status_changed` / `test_result` / `execution_status` continue unchanged during the execution phase.

**Phase 10.A — Post-Review Bug Fixes (✅ Done)**

A code review after 10.A.11 surfaced 5 issues, all fixed:

- [x] **Fix #1** — ADF (Atlassian Document Format) descriptions silently dropped in `/api/converse`. Extracted `normalizeJiraIssue` + `extractAdfText` into shared helper `scripts/lib/jiraNormalize.js`; both `orchestrate.js` and `server.js` import it. **Direct cause of "naive test cases" symptom — now closed.**
- [x] **Fix #2** — Audit transcript was always saved with `finalStatus: "completed"` even on execution failure. Now tracks `executionFailed` flag and saves `'error'` when appropriate.
- [x] **Fix #3** — `tsconfig.json` now excludes `artifacts/` so LLM-generated test files don't break root `tsc --noEmit`.
- [x] **Fix #4** — ConversationManager memory leak: sessions were never destroyed. Now `destroy()` after transcript saves, plus hourly `pruneStale()` interval as belt-and-braces.
- [x] **Fix #5** — Path-traversal hardening: `isValidJiraId()` regex helper applied to `/api/converse`, `/api/results/:jiraId`, `/api/testplan/:jiraId`, `/api/report/:jiraId`, `/api/bugs/:jiraId`.

**Phase 10.B — Test Case Review Gate (✅ Code Complete)**

User requested full inline editing of test cases (not just keep/remove). Delivered:

- [x] **10.B.1** — Backend: `approve_plan` now transitions to a new `tc_review` phase (not directly to executing). New `approve_cases` phase accepts the edited test cases array and kicks off orchestrate with `preApprovedPlan`.
- [x] **10.B.2** — `TestCaseReviewCard.tsx`: per-case Keep/Remove toggle plus full inline editing of title, steps (add/remove individual steps), expected result, and target URL.
- [x] **10.B.3** — `ExplorationCard.tsx`: informational card that listens for `page_explored` socket events during execution and shows pages discovered live. Matches the user's "exploratory testing to get familiarised with the application" intent.
- [x] **10.B.4** — `ConversationalAgent.tsx` wired to render the new cards inline; `handleConfirmCases` handler; CSS for `.card-tc-review` (editor) and `.card-exploration` (informational).

**Phase 10.C — Feedback-driven regeneration (deferred)**

- [ ] Free-text feedback box on plan/TC regenerate ("regenerate with focus on X")
- [ ] Multi-round revision tracking
- [ ] Conversation viewer UI for `artifacts/*/conversation.json`
- [ ] Conversation export to docx alongside the existing summary

**Verification (Phases 10.A + 10.B):**
1. `start.bat` → full stack up
2. Type `test CBOT-751 on https://leolity-qa.goarya.com/ivyrehab` → expect clarification card
3. Answer questions → expect plan card with `targetPage` matching the typed URL on every test case
4. Click `[Approve & Run]` → expect **test case review card** appears (NOT immediate execution)
5. Edit any case (pencil icon) → modify title/steps/expected/URL inline → Save
6. Remove a case (trash icon) → Restore (undo icon) to bring back
7. Click `[Confirm & Run N tests]` → execution begins
8. **Exploration card** appears as `PageExplorer` captures DOM snapshots — pages list live-updates
9. Test execution streams in live progress strip below
10. After completion: `artifacts/CBOT-751/conversation.json` exists with full transcript including edited test cases and `finalStatus`
11. Page refresh mid-conversation → thread restores from sessionStorage
12. Request with URL + clear scope → ClarifierAgent returns `[]`, agent skips clarification
