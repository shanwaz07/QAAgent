# QA Agent Family — Progress Tracker

> **Claude: Read this file FIRST at the start of every session.**
> Then read `Plan.md` for full context and task details before starting any work.

---

## Status Legend
✅ Done | 🔄 In Progress | ⏳ Todo | ❌ Blocked

Update status as each task completes. Do not batch updates. Add notes inline when blocked.

---

## Current Phase: Phase 10.B — ✅ Code Complete (awaiting runtime validation)

> **Note for the next agent:** Phases 0–6 (one-shot pipeline) are essentially complete and working. Phase 10 pivots from a one-shot "type → run everything" UX to an **interactive multi-turn agent** with review gates. **Phases 10.A and 10.B are code-complete** (clarifications + plan review + test case review with inline editing + exploration card); Phase 10.A also got 5 post-review bug fixes. **Phase 10.C is the only remaining sub-phase**, currently deferred. See `Plan.md` § Phase 10 and the detailed plan at `C:\Users\ShanwazHalageri\.claude\plans\peaceful-wandering-widget.md`.
>
> **In-flight work absorbed by Phase 10:** A `targetUrl` threading bug (chat URL ignored, `process.env.APP_URL` used instead) was being fixed across server.js / orchestrate.js / PlannerAgent.ts (✅ done) and ChatInput.tsx (⏸ not started). The ChatInput change is **superseded** — `ChatInput.tsx` will be deleted in Phase 10.A.10 and the new `/api/converse` flow always carries `targetUrl` through the session.

---

## Phase 0 — Bug Fixes & Cleanup

| Task | Status | Notes |
|---|---|---|
| 0.1 Fix orchestrator infinite reconnect loop | ✅ Done | Exported `orchestrate(jiraId, io, options)`, removed socket.io-client, server.js imports module directly, CLI stub preserved |
| 0.2 Fix TC_UI_03 failing test | ✅ Done | Changed assertion to `inputValue().length <= 200` — OrangeHRM silently caps via maxlength |
| 0.3 Remove legacy dashboard | ✅ Done | Deleted `dashboard/frontend/Dashboard.js` |
| 0.4 Clean up duplicate faker dependency | ✅ Done | Removed `faker@6.6.6`, `@faker-js/faker@10.4.0` kept |
| 0.5 Create `.env` file and dotenv setup | ✅ Done | `.env` template created, `dotenv` loaded in server.js and orchestrate.js |

---

## Phase 1 — Infrastructure: LLM + Embeddings + Vector DB

| Task | Status | Notes |
|---|---|---|
| 1.1 Install Qdrant via Docker | ✅ Done | Running port 6333, persistent storage at `artifacts/rag/qdrant_storage` |
| 1.2 Google Gemini embeddings setup | ✅ Done | `gemini-embedding-001` (3072 dims); `embedDocument` / `embedQuery` with correct `taskType` |
| 1.3 LLM setup | ✅ Done | Multi-provider `llmClient.ts`; OpenRouter / Groq / OpenAI / Google; rate-limit retry with `withRetry()` |
| 1.4 End-to-end infra validation | ✅ Done | embed → Qdrant upsert → retrieve confirmed |

---

## Phase 2 — Jira Integration + RAG Index

| Task | Status | Notes |
|---|---|---|
| 2.1 Jira API client (`jiraClient.ts`) | ✅ Done | Cursor-based pagination, createIssue, attachFile |
| 2.2 JiraAgent (`JiraAgent.ts`) | ✅ Done | `syncProject` with filtered JQL (Task/Sub-task/Bug any status; Story/Epic excludes To Do); `shouldIndex()` helper |
| 2.3 RagAgent — index builder | ✅ Done | `buildIndex(force)`: fresh sync recreates Qdrant collection; resume continues from progress file; skips content-less issues |
| 2.4 RagAgent — 4-layer query | ✅ Done | Expansion gated on quality threshold (0.67); `MIN_RETURN_SCORE=0.62`; calibrated for `RETRIEVAL_QUERY` task type |
| 2.5 Backend route `POST /api/jira/sync` | ✅ Done | Delta + full sync; mutex (blocks during execution); `sync_meta.json`; socket progress events |
| 2.X Delta sync | ✅ Done | `deltaIndex()` fetches all updated issues; upserts indexable ones; deletes demoted ones from Qdrant; saves progress every 5 |
| 2.X Sync metadata + mutex | ✅ Done | `sync_meta.json` stores lastSyncAt/totalIssues; `isSyncing`/`isExecuting` flags; `GET /api/jira/sync-status` |
| 2.X `GET /api/jira/issues` | ✅ Done | Returns raw cached issues |
| 2.X `POST /api/rag/query` | ✅ Done | Direct RAG query endpoint for Context Explorer and diagnostics |

---

## Phase 3 — Natural Language Chat UI

| Task | Status | Notes |
|---|---|---|
| 3.1 Backend `POST /api/chat` | ✅ Done | RAG → top-5 IDs → LLM structured output `{intent, jiraId, confirmationMessage}` |
| 3.2 `ChatInput.tsx` | ✅ Done | NL input, loading state, confirmation card with RAG context chips, Proceed → orchestrate |
| 3.3 `SettingsPanel.tsx` | ✅ Done | RAG_TOP_K slider, execution mode, headless toggle, provider+model dropdowns; persists to localStorage + `/api/settings` |
| 3.4 `react-router-dom` routing | ✅ Done | Sidebar nav with 8 routes including `/context` |
| 3.X `SyncButton.tsx` | ✅ Done | Delta/full sync trigger; last sync time; locked state during execution; `sync_meta_update` / `execution_status` socket events |
| 3.X `ToastCenter.tsx` + `LogDrawer` | ✅ Done | WARN auto-dismiss (8s), ERROR manual dismiss; LogDrawer shows last 200 entries colour-coded by level |
| 3.X `ContextView.tsx` | ✅ Done | Tab 1: browse/filter/search/paginate all indexed issues with expand. Tab 2: RAG query tester with score bars and example chips |
| 3.X Structured logger (`logger.ts`) | ✅ Done | JSONL daily log files; `logBus` EventEmitter → Socket.IO; `readRecentLogs()`; `GET /api/logs` |
| 3.X `start.bat` lifecycle | ✅ Done | Launches Qdrant + backend + frontend; kills all processes + Docker on close |

---

## Phase 4 — Page Exploration + DOM Snapshots

| Task | Status | Notes |
|---|---|---|
| 4.1 Playwright MCP setup | ✅ Done | Uses `page.ariaSnapshot({ mode: 'default', depth: 8 })` directly from `@playwright/test` 1.59.1 (no MCP stdio needed) |
| 4.2 `PageExplorer.ts` agent | ✅ Done | `explorePage`, `explorePages`, `loginToApp`, `formatAccessibilityTree`; session expiry detection; non-fatal per page |
| 4.3 Multi-page exploration logic | ✅ Done | `orchestrate.js` wired: ts-node registration, lazy require, Phase 4 hook reads `test_plan.json` for URLs or falls back to login only |

---

## Phase 5 — Test Plan + Script Generation

| Task | Status | Notes |
|---|---|---|
| 5.1 `PlannerAgent.ts` | ✅ Done | `generateTestPlan(jiraId, requirements, ragContext, io?)` → test_plan.json; uses `structuredOutput<TestPlan>`; 3–5 test cases |
| 5.2 `TestPlanView.tsx` | ✅ Done | `/plan` route; socket `plan_generated` live update; type/priority badges; expand per test case |
| 5.3 `ScriptGenAgent.ts` (sequential per test case) | ✅ Done | `generateScript` + `generateAllScripts`; snapshot → locators; strips markdown fencing; emits `script_generated` |
| 5.4 Upgrade `SelfHealer.js` to real LLM call | ✅ Done | Real `chat()` call with snapshot context; heuristic fallback if LLM unavailable |

---

## Phase 6 — Execution + Live Dashboard Streaming

| Task | Status | Notes |
|---|---|---|
| 6.1 Replace `execSync` with `child_process.spawn` | ✅ Done | `runPlaywrightTest()` streams stdout/stderr → socket log events; runs generated_tests/ one at a time |
| 6.2 Update `playwright.config.ts` (add JSON reporter) | ✅ Done | HTML + JSON reporters configured; `screenshot: 'only-on-failure'`; per-test `--output` passed via spawn args |
| 6.3 `ReportView.tsx` | ✅ Done | Summary bar (total/passed/failed/pass%), per-test cards with badge/duration/error/screenshot lightbox; live `test_result` socket updates; CSS in App.css |
| 6.X Requirements auto-fetch from Jira | ✅ Done | `orchestrate.js`: when `requirements.json` missing, calls `getIssue(jiraId)` then `normalizeJiraIssue()` to flatten `fields.summary/description` into flat format; also re-normalises stale raw files on load |
| 6.X Test execution duration tracking | ✅ Done | `orchestrate.js` records `startMs` per test; emits `duration` (ms) in `test_result` event; `ReportView.tsx` displays as `1.2s` next to status badge |
| 6.X Environment health check | ✅ Done | `scripts/lib/healthCheck.js` checks Qdrant, Google Embeddings, active LLM provider, Jira in parallel (8s timeout each); `GET /api/health` in server.js; SettingsPanel "Environment Health" card auto-runs on mount with Re-check button |
| 6.4 Full Phase 5+6 pipeline validation | ⏳ Todo | Requires runtime test: chat → plan → snapshots → scripts → execute → dashboard results. Blocked until Jira token is renewed. |

---

## Phase 7 — Bug Triage UI + Jira Integration

| Task | Status | Notes |
|---|---|---|
| 7.1 Bug collection after execution | ⏳ Todo | |
| 7.2 `BugTriage.tsx` | ⏳ Todo | |
| 7.3 `BugAgent.ts` (Jira bug creation + screenshot attach) | ⏳ Todo | |
| 7.4 Discard + RAG feedback loop (re-embed to Qdrant) | ⏳ Todo | |

---

## Phase 8 — Export Package

| Task | Status | Notes |
|---|---|---|
| 8.1 `ExportAgent.ts` (docx + xlsx generation) | ⏳ Todo | |
| 8.2 Download endpoints in `server.js` | ⏳ Todo | |
| 8.3 `ExportPanel.tsx` | ⏳ Todo | |
| 8.4 Trigger export after triage completion | ⏳ Todo | |

---

## Phase 9 — End-to-End Validation & Polish

| Task | Status | Notes |
|---|---|---|
| 9.1 Full end-to-end smoke test | ⏳ Todo | |
| 9.2 UX polish (empty states, error handling, loading states) | ⏳ Todo | |
| 9.3 Cleanup (remove legacy files, update docs) | ⏳ Todo | |

---

## Blockers — Needs User Input Before Proceeding

| Blocker | Action Required |
|---|---|
| Jira API token expired (401) | Regenerate at https://id.atlassian.com/manage-profile/security/api-tokens → update `JIRA_API_TOKEN` in `.env`. Required for: requirements fetch, Jira sync, bug logging. |

---

## Phase 10 — Interactive Conversational Agent (Direction Change — ACTIVE)

> **Read this before touching anything.** Phases 0–9 above describe the original one-shot pipeline. Phases 0–6 are **built and working** — the end-to-end pipeline (Jira sync → RAG → plan → snapshots → scripts → execute → report) functions today. **Phase 10 is a UX pivot, not a rewrite.** The existing agents (`PlannerAgent`, `PageExplorer`, `ScriptGenAgent`, `orchestrate.js` execution loop) are reused as-is. What changes is the **entry point**: the user now has an interactive multi-turn conversation with clarification + plan-review gates BEFORE the existing pipeline runs.
>
> **Frozen / do not redo:** anything marked ✅ in Phases 0–6 above, including the ongoing Phase 6.X work. The `targetUrl` fix is partially done (server.js / orchestrate.js / PlannerAgent.ts ✅) and the missing piece (ChatInput.tsx) is **deliberately abandoned** — the new `/api/converse` endpoint replaces it entirely.
>
> **Current scope:** Phases 10.A and 10.B are code-complete and awaiting runtime validation. Phase 10.C is deferred — do not start it without explicit direction.
>
> **Source of truth for this phase:** `C:\Users\ShanwazHalageri\.claude\plans\peaceful-wandering-widget.md`. `Plan.md` § Phase 10 has the same task list with sub-task identifiers.

### Phase 10.A — Clarifications + Plan Review Gate (ACTIVE)

| Task | Status | Notes |
|---|---|---|
| 10.A.1 `conversationManager.js` (in-memory session store keyed by client `sessionId`, NOT socketId) | ✅ Done | Map-based singleton; CRUD + appendHistory + saveTranscript; pruneStale helper |
| 10.A.2 `ClarifierAgent.ts` | ✅ Done | LLM-driven gap detection; returns `[]` when context is sufficient; non-fatal on error |
| 10.A.3 `POST /api/converse` route | ✅ Done | Phase router with mutex; emits converse_thinking / converse_clarify / converse_plan_ready / converse_done |
| 10.A.4 `PlannerAgent.ts` accept `clarifierAnswers?` | ✅ Done | New optional 6th param injected as "User clarifications" block in prompt |
| 10.A.5 `orchestrate.js` accept `preApprovedPlan?` | ✅ Done | Skips Planning when supplied; writes plan to test_plan.json before Phase 4 |
| 10.A.6 `ConversationalAgent.tsx` (replaces ChatInput) | ✅ Done | Multi-turn thread; sessionStorage resume; renders cards inline; live execution progress |
| 10.A.7 `ClarificationCard.tsx` | ✅ Done | Text + radio choice inputs; locks after submission to read-only summary |
| 10.A.8 `PlanReviewCard.tsx` | ✅ Done | Plan summary + collapsible test case list with type/priority badges; Approve / Regenerate |
| 10.A.9 Audit persistence → `artifacts/{jiraId}/conversation.json` | ✅ Done | Wired via conversationManager.saveTranscript() in /api/converse on completion + error |
| 10.A.10 Route `/` → `ConversationalAgent`; delete `ChatInput.tsx` | ✅ Done | App.tsx import + route swapped; ChatInput.tsx deleted |
| 10.A.11 Chat thread CSS in `App.css` | ✅ Done | Thread + clarification card + plan review card styles using existing CSS variables |

### Phase 10.B — Test Case Review Gate (✅ Code Complete)

| Task | Status | Notes |
|---|---|---|
| 10.B.1 Backend: `tc_review` phase + `approve_cases` endpoint | ✅ Done | `approve_plan` now transitions to tc_review (not executing); new `approve_cases` accepts edited array, kicks off orchestrate |
| 10.B.2 `TestCaseReviewCard.tsx` with full inline editing | ✅ Done | Per-case Keep/Remove + edit title, steps (add/remove), expected result, target URL |
| 10.B.3 `ExplorationCard.tsx` (informational) | ✅ Done | Listens for `page_explored` events during execution; lists pages snapshotted live |
| 10.B.4 Wire cards into ConversationalAgent + CSS | ✅ Done | New phase `tc_review` in Phase type; `handleConfirmCases` handler; CSS for `.card-tc-review` and `.card-exploration` |

### Phase 10.A — Post-Review Bug Fixes (5 issues found, all fixed)

| # | Fix | Status | Notes |
|---|---|---|---|
| 1 | ADF description extraction in `/api/converse` | ✅ Done | New shared helper `scripts/lib/jiraNormalize.js`; orchestrate.js + server.js both use it |
| 2 | Transcript `finalStatus` reflects execution success/failure | ✅ Done | Tracks `executionFailed` flag in catch; emits accurate `'completed'` or `'error'` |
| 3 | `tsconfig.json` excludes `artifacts/` | ✅ Done | LLM-generated test files no longer break root `tsc --noEmit` |
| 4 | Conversation session memory leak | ✅ Done | `destroy()` after transcript saved + hourly `pruneStale()` setInterval |
| 5 | jiraId path-traversal validation | ✅ Done | `isValidJiraId()` regex helper applied to all 4 GET routes + `/api/converse` |

### Phase 10.C — Feedback-driven Regeneration (DEFERRED — do not start)

| Task | Status | Notes |
|---|---|---|
| 10.C.1 Free-text feedback box on regenerate | ⏸ Deferred | |
| 10.C.2 Multi-round revision tracking | ⏸ Deferred | |
| 10.C.3 Conversation viewer UI for `conversation.json` | ⏸ Deferred | |
| 10.C.4 Conversation export to docx | ⏸ Deferred | |
