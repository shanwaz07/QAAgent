import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Database, Search, X, ChevronDown, Loader2, XCircle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

interface AdfNode { type: string; text?: string; content?: AdfNode[]; }

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    issuetype: { name: string };
    status: { name: string };
    labels: string[];
    components: { name: string }[];
    description: AdfNode | string | null;
  };
}

interface RagResult {
  jiraId: string; summary: string; type: string; status: string;
  labels: string[]; components: string[]; text: string; score: number;
}

interface SyncMeta { lastSyncAt?: string; totalIssues?: number; projectKey?: string; }

// ── Constants ─────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const ISSUE_TYPES = ['All', 'Epic', 'Story', 'Task', 'Bug', 'Sub-task'];
const PRIMARY_STATUSES = ['All', 'To Do', 'In Progress', 'Done'];
const OTHER_STATUSES = ['IN QA', 'IN REVIEW', 'In Staging', 'QA Validation', 'QA Verified', 'Need Info', 'On Hold'];

const TYPE_COLORS: Record<string, string> = {
  Epic: '#818cf8', Story: '#34d399', Task: '#38bdf8', Bug: '#fb7185', 'Sub-task': '#a78bfa',
};
const STATUS_COLORS: Record<string, string> = {
  Done: '#34d399', 'In Progress': '#fbbf24', 'To Do': '#94a3b8',
  'IN QA': '#a78bfa', 'IN REVIEW': '#a78bfa', 'In Staging': '#38bdf8',
  'QA Validation': '#a78bfa', 'QA Verified': '#34d399', 'Need Info': '#fbbf24', 'On Hold': '#94a3b8',
};

// ── Helpers ───────────────────────────────────────────────────────

function extractAdfText(node: AdfNode): string {
  if (node.type === 'text' && node.text) return node.text;
  if (node.content) return node.content.map(extractAdfText).join(' ');
  return '';
}

function getDescription(issue: JiraIssue): string {
  const d = issue.fields.description;
  if (!d) return '';
  if (typeof d === 'string') return d;
  if ((d as AdfNode).content) return extractAdfText(d as AdfNode);
  return '';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function scoreColor(s: number): string {
  if (s >= 0.8) return '#34d399';
  if (s >= 0.6) return '#fbbf24';
  return '#fb7185';
}

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? '#94a3b8';
  return (
    <span className="ctx-type-badge" style={{ background: color + '22', color, borderColor: color + '44' }}>
      {type}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────

// ── Session persistence helpers ───────────────────────────────────
const CTX_SESSION_KEY = 'qa_context_state';
interface ContextSession {
  activeTab: 'kb' | 'rag';
  searchText: string;
  typeFilter: string;
  statusFilter: string;
  showOtherStatuses: boolean;
  page: number;
  expandedKey: string | null;
  ragInput: string;
  ragTopK: number;
  ragResults: RagResult[] | null;
}
function loadCtxSession(): Partial<ContextSession> {
  try { const r = sessionStorage.getItem(CTX_SESSION_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveCtxSession(s: ContextSession) {
  try { sessionStorage.setItem(CTX_SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const ContextView: React.FC = () => {
  const s = loadCtxSession();

  const [activeTab, setActiveTab] = useState<'kb' | 'rag'>(s.activeTab ?? 'kb');

  // KB state
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({});
  const [searchText, setSearchText] = useState(s.searchText ?? '');
  const [typeFilter, setTypeFilter] = useState(s.typeFilter ?? 'All');
  const [statusFilter, setStatusFilter] = useState(s.statusFilter ?? 'All');
  const [showOtherStatuses, setShowOtherStatuses] = useState(s.showOtherStatuses ?? false);
  const [page, setPage] = useState(s.page ?? 0);
  const [expandedKey, setExpandedKey] = useState<string | null>(s.expandedKey ?? null);

  // RAG state
  const [ragInput, setRagInput] = useState(s.ragInput ?? '');
  const [ragTopK, setRagTopK] = useState(s.ragTopK ?? 10);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragResults, setRagResults] = useState<RagResult[] | null>(s.ragResults ?? null);
  const [ragError, setRagError] = useState<string | null>(null);

  // Persist all navigable state to sessionStorage on every change
  useEffect(() => {
    saveCtxSession({ activeTab, searchText, typeFilter, statusFilter, showOtherStatuses, page, expandedKey, ragInput, ragTopK, ragResults });
  }, [activeTab, searchText, typeFilter, statusFilter, showOtherStatuses, page, expandedKey, ragInput, ragTopK, ragResults]);

  // Load issues + sync meta on mount
  useEffect(() => {
    Promise.all([
      axios.get<JiraIssue[]>('http://localhost:5000/api/jira/issues'),
      axios.get<SyncMeta & { isSyncing: boolean; isExecuting: boolean }>(
        'http://localhost:5000/api/jira/sync-status'
      ),
    ])
      .then(([issRes, metaRes]) => {
        setIssues(issRes.data);
        setSyncMeta(metaRes.data);
      })
      .catch(err => {
        const msg = (err as { response?: { data?: { error?: string } }; message?: string })
          ?.response?.data?.error ?? (err instanceof Error ? err.message : String(err));
        setIssuesError(msg);
      })
      .finally(() => setIssuesLoading(false));
  }, []);

  // Filtered issues (client-side, memoised)
  const filteredIssues = useMemo(() => {
    const q = searchText.toLowerCase();
    return issues.filter(i => {
      if (typeFilter !== 'All' && i.fields.issuetype.name !== typeFilter) return false;
      if (statusFilter !== 'All' && i.fields.status.name !== statusFilter) return false;
      if (q && !i.key.toLowerCase().includes(q) && !i.fields.summary.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [issues, typeFilter, statusFilter, searchText]);

  // Reset page + expanded row when filters change
  useEffect(() => { setPage(0); setExpandedKey(null); }, [typeFilter, statusFilter, searchText]);

  const resetFilters = () => { setSearchText(''); setTypeFilter('All'); setStatusFilter('All'); setShowOtherStatuses(false); };

  const isOtherActive = !PRIMARY_STATUSES.includes(statusFilter) && statusFilter !== 'All';

  // RAG query submit
  const handleRagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ragInput.trim() || ragLoading) return;
    setRagLoading(true);
    setRagResults(null);
    setRagError(null);
    try {
      const { data } = await axios.post<RagResult[]>('http://localhost:5000/api/rag/query', {
        query: ragInput,
        topK: ragTopK,
      });
      setRagResults(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err instanceof Error ? err.message : String(err));
      setRagError(msg);
    } finally {
      setRagLoading(false);
    }
  };

  const totalPages = Math.ceil(filteredIssues.length / PAGE_SIZE);
  const pageIssues = filteredIssues.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="context-container">

      {/* Tab bar */}
      <div className="context-tabs">
        <button className={`ctx-tab ${activeTab === 'kb' ? 'active' : ''}`} onClick={() => setActiveTab('kb')}>
          <Database size={15} /> Knowledge Base
        </button>
        <button className={`ctx-tab ${activeTab === 'rag' ? 'active' : ''}`} onClick={() => setActiveTab('rag')}>
          <Search size={15} /> RAG Query Tester
        </button>
      </div>

      {/* ── Tab 1: Knowledge Base ─────────────────────────────── */}
      {activeTab === 'kb' && (
        <div className="ctx-kb">

          {/* Stats bar */}
          <div className="ctx-stats-bar">
            <span><strong>{syncMeta.totalIssues ?? issues.length}</strong> issues indexed</span>
            <span className="ctx-stats-sep">·</span>
            <span>Last synced {syncMeta.lastSyncAt ? timeAgo(syncMeta.lastSyncAt) : <span style={{ color: '#fb7185' }}>never</span>}</span>
            <span className="ctx-stats-sep">·</span>
            <span>Project: <code className="mono">{syncMeta.projectKey ?? '—'}</code></span>
          </div>

          {/* Search */}
          <div className="ctx-search-row">
            <Search size={14} className="ctx-search-icon" />
            <input
              className="ctx-search-input"
              placeholder="Search by key or summary…"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
            {searchText && (
              <button className="ctx-clear-btn" onClick={() => setSearchText('')}><X size={13} /></button>
            )}
          </div>

          {/* Type pills */}
          <div className="ctx-filter-row">
            <span className="ctx-filter-label">Type</span>
            {ISSUE_TYPES.map(t => (
              <button key={t} className={`ctx-pill ${typeFilter === t ? 'active' : ''}`}
                onClick={() => setTypeFilter(t)}>{t}</button>
            ))}
          </div>

          {/* Status pills */}
          <div className="ctx-filter-row">
            <span className="ctx-filter-label">Status</span>
            {PRIMARY_STATUSES.map(s => (
              <button key={s} className={`ctx-pill ${statusFilter === s ? 'active' : ''}`}
                onClick={() => setStatusFilter(s)}>{s}</button>
            ))}
            <button
              className={`ctx-pill ${isOtherActive || showOtherStatuses ? 'active' : ''}`}
              onClick={() => setShowOtherStatuses(v => !v)}
            >
              Other {showOtherStatuses ? '▲' : '▼'}
            </button>
          </div>

          {/* Other statuses expanded */}
          {showOtherStatuses && (
            <div className="ctx-filter-row ctx-filter-row-indent">
              {OTHER_STATUSES.map(s => (
                <button key={s} className={`ctx-pill ctx-pill-sm ${statusFilter === s ? 'active' : ''}`}
                  onClick={() => setStatusFilter(prev => prev === s ? 'All' : s)}>{s}</button>
              ))}
            </div>
          )}

          {/* Result count */}
          <div className="ctx-result-count">
            {filteredIssues.length} of {issues.length} issues
            {(searchText || typeFilter !== 'All' || statusFilter !== 'All') && (
              <button className="ctx-reset-link" onClick={resetFilters}>Clear filters</button>
            )}
          </div>

          {/* Issue list */}
          {issuesLoading ? (
            <div className="ctx-loading"><Loader2 size={20} className="spin" /> Loading issues…</div>
          ) : issuesError ? (
            <div className="ctx-error">
              <XCircle size={16} />
              {issuesError.includes('404') || issuesError.includes('No synced')
                ? 'No issues indexed yet. Use the Sync button in the sidebar to fetch Jira issues.'
                : issuesError}
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="ctx-empty">No issues match the current filters.</div>
          ) : (
            <>
              <div className="ctx-issue-list">
                {pageIssues.map(issue => {
                  const expanded = expandedKey === issue.key;
                  const desc = getDescription(issue);
                  return (
                    <div key={issue.key} className="ctx-issue-row"
                      onClick={() => setExpandedKey(expanded ? null : issue.key)}>
                      <div className="ctx-issue-main">
                        <TypeBadge type={issue.fields.issuetype.name} />
                        <span className="ctx-issue-key mono">{issue.key}</span>
                        <span className="ctx-issue-summary">{issue.fields.summary}</span>
                        <span className="ctx-status-chip"
                          style={{ color: STATUS_COLORS[issue.fields.status.name] ?? '#94a3b8' }}>
                          {issue.fields.status.name}
                        </span>
                        {issue.fields.labels.slice(0, 2).map(l => (
                          <span key={l} className="ctx-label-pill">{l}</span>
                        ))}
                        <ChevronDown size={13} className={`ctx-chevron ${expanded ? 'rotated' : ''}`} />
                      </div>

                      {expanded && (
                        <div className="ctx-issue-expanded" onClick={e => e.stopPropagation()}>
                          <p className="ctx-expand-label">Description</p>
                          <p className="ctx-expand-text">
                            {desc || <span className="dim">No description available.</span>}
                          </p>
                          {issue.fields.components.length > 0 && (
                            <div className="ctx-expand-meta">
                              <span className="ctx-filter-label">Components</span>
                              {issue.fields.components.map(c => (
                                <span key={c.name} className="ctx-label-pill">{c.name}</span>
                              ))}
                            </div>
                          )}
                          {issue.fields.labels.length > 2 && (
                            <div className="ctx-expand-meta">
                              <span className="ctx-filter-label">All labels</span>
                              {issue.fields.labels.map(l => (
                                <span key={l} className="ctx-label-pill">{l}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="ctx-pagination">
                  <button className="ctx-page-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    ← Previous
                  </button>
                  <span className="dim">Page {page + 1} of {totalPages}</span>
                  <button className="ctx-page-btn" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tab 2: RAG Query Tester ───────────────────────────── */}
      {activeTab === 'rag' && (
        <div className="ctx-rag">
          <p className="ctx-rag-desc">
            See exactly what context the agent retrieves for any natural language query.
          </p>

          <form className="ctx-rag-form" onSubmit={handleRagSubmit}>
            <div className="ctx-rag-input-row">
              <input
                className="chat-input"
                placeholder='e.g. "login feature" or "admin user management"'
                value={ragInput}
                onChange={e => setRagInput(e.target.value)}
                disabled={ragLoading}
              />
              <button type="submit" className="chat-send-btn" disabled={ragLoading || !ragInput.trim()}>
                {ragLoading ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
              </button>
            </div>

            <div className="ctx-topk-row">
              <span className="ctx-filter-label">Top K</span>
              <span className="slider-min">3</span>
              <input type="range" min={3} max={30} step={1} value={ragTopK}
                onChange={e => setRagTopK(Number(e.target.value))} className="slider" />
              <span className="slider-max">30</span>
              <span className="slider-value">{ragTopK}</span>
            </div>

            <div className="ctx-rag-examples">
              {['login feature', 'admin user management', 'employee profile', 'leave management'].map(ex => (
                <button key={ex} type="button" className="example-chip"
                  onClick={() => setRagInput(ex)} disabled={ragLoading}>{ex}</button>
              ))}
            </div>
          </form>

          {ragError && (
            <div className="chat-error"><XCircle size={14} /><span>{ragError}</span></div>
          )}

          {ragResults === null && !ragLoading && (
            <div className="ctx-rag-empty">
              <Database size={36} style={{ opacity: 0.15 }} />
              <p className="dim">Enter a query above to see what the agent would retrieve.</p>
            </div>
          )}

          {ragResults !== null && ragResults.length === 0 && (
            <div className="ctx-rag-empty">
              <p className="dim">No results returned for this query.</p>
            </div>
          )}

          {ragResults !== null && ragResults.length > 0 && (
            <div className="ctx-rag-results">
              <p className="ctx-result-count">{ragResults.length} results retrieved</p>
              {ragResults.map((r, idx) => (
                <div key={r.jiraId} className="ctx-rag-card">
                  <div className="ctx-rag-card-header">
                    <span className="ctx-rag-rank">#{idx + 1}</span>
                    <TypeBadge type={r.type} />
                    <span className="ctx-issue-key mono">{r.jiraId}</span>
                    <span className="ctx-issue-summary">{r.summary}</span>
                    <span className="ctx-status-chip"
                      style={{ color: STATUS_COLORS[r.status] ?? '#94a3b8' }}>{r.status}</span>
                    <span className="ctx-rag-score" style={{ color: scoreColor(r.score) }}>
                      {(r.score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="ctx-score-bar-track">
                    <div className="ctx-score-bar-fill"
                      style={{ width: `${r.score * 100}%`, background: scoreColor(r.score) }} />
                  </div>
                  <p className="ctx-rag-text-preview">
                    {r.text.slice(0, 180)}{r.text.length > 180 ? '…' : ''}
                  </p>
                  {r.labels.length > 0 && (
                    <div className="ctx-expand-meta">
                      {r.labels.slice(0, 4).map(l => <span key={l} className="ctx-label-pill">{l}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ContextView;
