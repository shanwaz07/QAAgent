import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { BarChart3, CheckCircle2, XCircle, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';

const socket = io('http://localhost:5000');
const API = 'http://localhost:5000';

interface TestResult {
  tcid: string;
  title?: string;
  status: 'PASS' | 'FAIL';
  duration?: number;
  error?: string;
  screenshot?: string | null;
}

interface Report {
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

interface TestCase {
  id: string;
  title: string;
}

const ReportView: React.FC = () => {
  const [jiraId] = useState(() => localStorage.getItem('lastJiraId') ?? '');
  const [report, setReport] = useState<Report | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedImg, setExpandedImg] = useState<string | null>(null);

  useEffect(() => {
    if (!jiraId) return;

    setLoading(true);
    Promise.all([
      axios.get<Report>(`${API}/api/results/${jiraId}`).catch(() => null),
      axios.get<{ testCases: TestCase[] }>(`${API}/api/testplan/${jiraId}`).catch(() => null),
    ]).then(([resResult, resPlan]) => {
      if (resResult) setReport(resResult.data);
      if (resPlan) {
        const map: Record<string, string> = {};
        for (const tc of resPlan.data.testCases) map[tc.id] = tc.title;
        setTitles(map);
      }
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));

    // Live updates during execution
    socket.on('test_result', (data: { jiraId: string; tcId: string; title?: string; status: 'PASS' | 'FAIL'; duration?: number; error?: string; screenshot?: string | null }) => {
      if (data.jiraId !== jiraId) return;
      setReport(prev => {
        if (!prev) {
          return { total: 1, passed: data.status === 'PASS' ? 1 : 0, failed: data.status === 'FAIL' ? 1 : 0, results: [{ tcid: data.tcId, title: data.title, status: data.status, duration: data.duration, error: data.error, screenshot: data.screenshot }] };
        }
        const existing = prev.results.findIndex(r => r.tcid === data.tcId);
        const newEntry: TestResult = { tcid: data.tcId, title: data.title, status: data.status, duration: data.duration, error: data.error, screenshot: data.screenshot };
        const newResults = existing >= 0
          ? prev.results.map((r, i) => i === existing ? newEntry : r)
          : [...prev.results, newEntry];
        const passed = newResults.filter(r => r.status === 'PASS').length;
        const failed = newResults.filter(r => r.status === 'FAIL').length;
        return { ...prev, results: newResults, passed, failed, total: newResults.length };
      });
      if (data.title) setTitles(prev => ({ ...prev, [data.tcId]: data.title! }));
    });

    return () => { socket.off('test_result'); };
  }, [jiraId]);

  if (!jiraId) return (
    <div className="rv-container">
      <div className="rv-empty">
        <BarChart3 size={32} className="dim" />
        <p>Run a ticket from the Chat tab to generate a report.</p>
      </div>
    </div>
  );

  if (loading) return (
    <div className="rv-container">
      <div className="rv-loading"><Loader2 size={20} className="spin" /> Loading report…</div>
    </div>
  );

  if (error) return (
    <div className="rv-container">
      <div className="rv-empty">
        <AlertTriangle size={32} style={{ color: '#fbbf24' }} />
        <p>{error}</p>
      </div>
    </div>
  );

  if (!report) return (
    <div className="rv-container">
      <div className="rv-empty">
        <BarChart3 size={32} className="dim" />
        <p>No results yet — run a ticket from the Chat tab.</p>
      </div>
    </div>
  );

  const passRate = report.total > 0 ? Math.round((report.passed / report.total) * 100) : 0;

  return (
    <div className="rv-container">
      {/* Header */}
      <div className="rv-header">
        <div>
          <h1 className="rv-title">Test Report</h1>
          <p className="rv-meta dim">{jiraId} &middot; {report.total} test{report.total !== 1 ? 's' : ''}</p>
        </div>
        <a
          className="rv-html-link"
          href={`${API}/artifacts/${jiraId}/report.html`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={14} /> HTML Report
        </a>
      </div>

      {/* Summary bar */}
      <div className="rv-summary">
        <div className="rv-stat">
          <span className="rv-stat-val">{report.total}</span>
          <span className="rv-stat-lbl dim">Total</span>
        </div>
        <div className="rv-stat pass">
          <span className="rv-stat-val">{report.passed}</span>
          <span className="rv-stat-lbl dim">Passed</span>
        </div>
        <div className="rv-stat fail">
          <span className="rv-stat-val">{report.failed}</span>
          <span className="rv-stat-lbl dim">Failed</span>
        </div>
        <div className="rv-pass-bar-wrap">
          <div className="rv-pass-bar" style={{ width: `${passRate}%` }} />
          <span className="rv-pass-pct">{passRate}%</span>
        </div>
      </div>

      {/* Per-test cards */}
      <div className="rv-cards">
        {report.results.map(r => {
          const title = r.title || titles[r.tcid] || r.tcid;
          const isPassed = r.status === 'PASS';
          const screenshotUrl = r.screenshot
            ? `${API}/artifacts/${jiraId}/${r.screenshot}`
            : null;
          return (
            <div key={r.tcid} className={`rv-card ${isPassed ? 'rv-card-pass' : 'rv-card-fail'}`}>
              <div className="rv-card-header">
                <div className="rv-card-left">
                  <span className="rv-tc-id">{r.tcid}</span>
                  <span className="rv-card-title">{title}</span>
                </div>
                <div className="rv-card-right">
                  {r.duration != null && (
                    <span className="rv-duration dim">{(r.duration / 1000).toFixed(1)}s</span>
                  )}
                  <span className={`rv-badge ${isPassed ? 'rv-badge-pass' : 'rv-badge-fail'}`}>
                    {isPassed
                      ? <><CheckCircle2 size={13} /> PASSED</>
                      : <><XCircle size={13} /> FAILED</>}
                  </span>
                </div>
              </div>

              {!isPassed && r.error && (
                <div className="rv-error-block">
                  <span className="rv-error-label">Error</span>
                  <p className="rv-error-text">{r.error}</p>
                </div>
              )}

              {screenshotUrl && (
                <div className="rv-screenshot-wrap">
                  <img
                    src={screenshotUrl}
                    alt={`Screenshot for ${r.tcid}`}
                    className="rv-screenshot-thumb"
                    onClick={() => setExpandedImg(screenshotUrl)}
                  />
                  <span className="rv-screenshot-hint dim">Click to expand</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lightbox */}
      {expandedImg && (
        <div className="rv-lightbox" onClick={() => setExpandedImg(null)}>
          <img src={expandedImg} alt="Screenshot" className="rv-lightbox-img" />
        </div>
      )}
    </div>
  );
};

export default ReportView;
