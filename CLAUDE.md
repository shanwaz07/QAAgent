# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Session Startup — Do This First, Every Session

1. **Read `Progress.md`** — understand what is ✅ Done, 🔄 In Progress, ⏳ Todo, ❌ Blocked
2. **Read `Plan.md`** — get full task details, sub-tasks, and acceptance criteria for the current phase
3. **Only work on tasks listed as ⏳ Todo or 🔄 In Progress** — do not skip phases
4. **Update `Progress.md` status as each task completes** — do not batch; update immediately

---

## Project Overview

AI-powered end-to-end QA orchestration platform. User types a natural language command ("do full testing on CBOT-421"), and the system: reads the Jira story, builds context via RAG, generates a test plan and Playwright scripts using real DOM snapshots, executes in a visible browser, triages bugs with screenshots, logs them to Jira, and exports Word + Excel reports.

**Target app under test**: Convert — Leoforce AI careersite agent (https://leolity-qa.goarya.com/demo-staffing/home) — no login required (public careersite). Engages job seekers via chat, recommends jobs via vector-based matching, persists sessions for candidate rediscovery.

---

## Commands

```bash
# Install all dependencies
npm install
cd dashboard/dashboard-app && npm install

# Start everything (recommended)
start.bat   # Launches Docker + backend (port 5000) + frontend (port 5173); kills all on close

# Manual start
docker run -p 6333:6333 -v ./qdrant_storage:/qdrant/storage qdrant/qdrant
node dashboard/backend/server.js
cd dashboard/dashboard-app && npm run dev

# TypeScript check (root scripts)
npx tsc --noEmit

# TypeScript check (frontend)
cd dashboard/dashboard-app && npx tsc --noEmit

# Run existing tests
npx playwright test tests/scrum-101.spec.ts --headed
npx playwright test tests/scrum-200.spec.ts --headed
npx playwright test --grep "TC_UI_01"
```

---

## Architecture

### Agent Pipeline (sequential — one ticket at a time)

```
User: "do full testing on CBOT-421"
  ↓
ChatInput.tsx → POST /api/chat
  → embedQuery(message) → Qdrant top-5 → LLM: { intent, jiraId, confirmationMessage }
  → User confirms → POST /api/orchestrate

Server → orchestrate(jiraId, io, options):
  1. JiraAgent     — fetch Jira issue data
  2. RagAgent      — 4-layer query (top-K + label/component expansion + second-hop + keyword spike)
  3. PlannerAgent  — LLM → structured test plan JSON        [Phase 5]
  4. PageExplorer  — Playwright MCP → DOM accessibility snapshot per page  [Phase 4]
  5. ScriptGenAgent— LLM → .spec.ts using real DOM refs     [Phase 5]
  6. Execution     — child_process.spawn → headed browser   [Phase 6]
  7. SelfHealer    — LLM diagnoses locator failures         [Phase 5]
  8. BugAgent      — Log to Jira or discard (re-embeds to RAG) [Phase 7]
  9. ExportAgent   — docx summary + testcases.xlsx + bugs.xlsx [Phase 8]
```

### Key Design Rules
- **taskType is mandatory** — `embedDocument()` for indexing, `embedQuery()` for search. Without this, gemini-embedding-001 produces undiscriminated vectors (all ~0.78–0.80). Calibrated thresholds: `MIN_RETURN_SCORE=0.62`, `EXPANSION_QUALITY_THRESHOLD=0.67`.
- **JQL filter** — Task/Sub-task/Bug: any status. Story/Epic: excludes "To Do". Issues with no description + no labels + no components + summary ≤40 chars are skipped at index time.
- **Full sync** always calls `recreateCollection()` + resets progress file. Resuming an interrupted sync uses `createCollection()` (doesn't wipe).
- **Delta sync** fetches all updated issues, upserts indexable ones, deletes demoted ones (e.g. Story moved to To Do) from Qdrant.
- **Mutual exclusion** — `isSyncing` / `isExecuting` flags on server. Sync blocked during execution and vice versa (409).
- **Sequential execution** — one test generated and run at a time. `workers: 1`, `retries: 0`.
- **No locator guesswork** — all locators derived from Playwright MCP DOM snapshots.
- **Bug feedback loop** — discarded bugs re-embedded into Qdrant so LLM avoids re-flagging.

---

## Key Files

| File | Purpose |
|---|---|
| `Progress.md` | Live status tracker — read FIRST every session |
| `Plan.md` | Full plan with all phases and sub-tasks |
| `scripts/orchestrate.js` | Main orchestration entry point |
| `scripts/agents/JiraAgent.ts` | Jira fetch, `syncProject`, `shouldIndex`, `extractText` |
| `scripts/agents/RagAgent.ts` | `buildIndex(force)`, `deltaIndex`, `ragQuery`; 4-layer expansion |
| `scripts/lib/embedder.ts` | `embedDocument` / `embedQuery` with `taskType`; rate-limit retry |
| `scripts/lib/vectorStore.ts` | Qdrant wrapper: `createCollection`, `recreateCollection`, `upsertBatch`, `query`, `deletePoint` |
| `scripts/lib/llmClient.ts` | Multi-provider LLM; `chat()`, `withRetry()`; provider routing |
| `scripts/lib/logger.ts` | Structured JSONL logger; `logBus` EventEmitter → Socket.IO |
| `dashboard/backend/server.js` | Express + Socket.IO; all REST routes; mutex flags; sync metadata |
| `dashboard/dashboard-app/src/App.tsx` | React SPA; sidebar nav; routes; ToastCenter; LogDrawer |
| `src/components/ChatInput.tsx` | NL input → confirmation card → orchestrate |
| `src/components/ContextView.tsx` | Browse indexed issues + RAG query tester |
| `src/components/SyncButton.tsx` | Delta/full sync; last-sync time; mutex state |
| `src/components/ToastCenter.tsx` | WARN/ERROR toasts + full LogDrawer |
| `src/components/SettingsPanel.tsx` | RAG_TOP_K, LLM provider/model, execution mode |
| `artifacts/rag/sync_meta.json` | `{ lastSyncAt, projectKey, totalIssues, lastDeltaCount }` |
| `artifacts/rag/index_progress.json` | Set of already-indexed Jira keys (for resume) |

---

## Artifact Structure Per Ticket

```
artifacts/{JIRA_ID}/
├── requirements.json        Jira ticket data
├── test_plan.json           LLM-generated test plan  [Phase 5]
├── page_snapshots/          Playwright MCP DOM snapshots (.yaml)  [Phase 4]
├── generated_tests/         LLM-generated .spec.ts files  [Phase 5]
├── results.json             Execution results
├── bugs.json                Detected bugs with screenshot paths  [Phase 7]
├── discarded_bugs.json      Discarded bugs with explanations  [Phase 7]
├── summary.docx             AI summary Word document  [Phase 8]
├── testcases.xlsx           Test cases with Passed/Failed/Not Executed  [Phase 8]
├── bugs.xlsx                Bugs with Jira IDs  [Phase 8]
└── report.html              HTML execution report

artifacts/logs/
└── app-YYYY-MM-DD.log       JSONL structured log file (daily rotation)
```

---

## Technology Stack

| Layer | Tool | Notes |
|---|---|---|
| Vector DB | Qdrant (local Docker) | Port 6333; `recreateCollection()` on full sync |
| Embeddings | Google `gemini-embedding-001` | 3072 dims; `taskType` required for correct retrieval |
| LLM | Multi-provider via `llmClient.ts` | OpenRouter / Groq / OpenAI / Google; selectable from UI |
| DOM reading | Playwright MCP (Phase 4) | Real accessibility tree; no locator guessing |
| Browser | Playwright headed | User watches every test live |
| Logger | `scripts/lib/logger.ts` | JSONL files + EventEmitter bus → Socket.IO toasts |

---

## Environment Variables (`.env` at project root)

```
ACTIVE_LLM_PROVIDER=openrouter       # openrouter | groq | openai | google
ACTIVE_LLM_MODEL=qwen/qwen3-coder:free

OPENROUTER_API_KEY=
GROQ_API_KEY=
OPENAI_API_KEY=
GOOGLE_LLM_API_KEY=
GOOGLE_LLM_MODEL=gemini-2.0-flash

GOOGLE_API_KEY=                       # For embeddings (gemini-embedding-001)
GEMINI_EMBED_MODEL=models/gemini-embedding-001

QDRANT_URL=http://localhost:6333

JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=
JIRA_API_TOKEN=
JIRA_PROJECT_KEY=CBOT
JIRA_DEFAULT_ASSIGNEE=

RAG_TOP_K=30
```

---

## Dashboard Routes

| Route | View | Status |
|---|---|---|
| `/` | Chat | ✅ Done |
| `/context` | Context Explorer | ✅ Done |
| `/plan` | Test Plan | ⏳ Phase 5 |
| `/run` | Live Run | ✅ Basic done |
| `/report` | Report | ⏳ Phase 6 |
| `/bugs` | Bug Triage | ⏳ Phase 7 |
| `/export` | Export | ⏳ Phase 8 |
| `/settings` | Settings | ✅ Done |
