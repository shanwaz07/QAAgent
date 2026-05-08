import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { ListChecks, AlertTriangle, ChevronDown, Loader2, Play } from 'lucide-react';

interface TestCase {
  id: string;
  title: string;
  type: 'Positive' | 'Negative' | 'Boundary' | 'Edge';
  priority: 'High' | 'Medium' | 'Low';
  steps: string[];
  expectedResult: string;
  targetPage: string;
}

interface TestPlan {
  testPlanTitle: string;
  jiraId: string;
  scope: string;
  testTypes: string[];
  riskAreas: string[];
  testCases: TestCase[];
}

const socket = io('http://localhost:5000');

const TYPE_COLORS: Record<string, string> = {
  Positive: '#34d399',
  Negative: '#fb7185',
  Boundary: '#fbbf24',
  Edge:     '#a78bfa',
};

const PRIORITY_COLORS: Record<string, string> = {
  High:   '#fb7185',
  Medium: '#fbbf24',
  Low:    '#94a3b8',
};

const TP_SESSION_KEY = 'qa_testplan_state';

const TestPlanView: React.FC = () => {
  const [plan, setPlan] = useState<TestPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(TP_SESSION_KEY) ?? 'null'); } catch { return null; }
  });
  const [jiraId, setJiraId] = useState<string>(() => localStorage.getItem('lastJiraId') || '');
  const [runLoading, setRunLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    try { sessionStorage.setItem(TP_SESSION_KEY, JSON.stringify(expandedId)); } catch { /* ignore */ }
  }, [expandedId]);

  const fetchPlan = (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    axios.get(`http://localhost:5000/api/testplan/${id}`)
      .then(r => setPlan(r.data))
      .catch(e => {
        if (e.response?.status === 404) setError('No test plan yet — run a ticket from the Chat tab.');
        else setError(e.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPlan(jiraId);

    socket.on('plan_generated', (data: { jiraId: string; testPlan: TestPlan }) => {
      setPlan(data.testPlan);
      setJiraId(data.jiraId);
      localStorage.setItem('lastJiraId', data.jiraId);
    });

    return () => { socket.off('plan_generated'); };
  }, []);

  if (loading) return (
    <div className="tp-container">
      <div className="tp-loading"><Loader2 size={20} className="spin" /> Generating test plan…</div>
    </div>
  );

  if (!jiraId) return (
    <div className="tp-container">
      <div className="tp-empty">
        <ListChecks size={32} className="dim" />
        <p>Run a ticket from the Chat tab to generate a test plan.</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="tp-container">
      <div className="tp-empty">
        <AlertTriangle size={32} style={{ color: '#fbbf24' }} />
        <p>{error}</p>
        <button className="tp-retry-btn" onClick={() => fetchPlan(jiraId)}>Retry</button>
      </div>
    </div>
  );

  const handleRun = async () => {
    if (!jiraId || runLoading) return;
    setRunLoading(true);
    try {
      await axios.post('http://localhost:5000/api/orchestrate', {
        jiraId,
        ragTopK: 10,
        executionMode: 'full',
        headless: false,
      });
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setRunLoading(false);
    }
  };

  if (!plan) return null;

  return (
    <div className="tp-container">
      <div className="tp-header">
        <div>
          <h1 className="tp-title">{plan.testPlanTitle}</h1>
          <p className="tp-meta dim">
            {plan.jiraId} &middot; {plan.testCases.length} test case{plan.testCases.length !== 1 ? 's' : ''}
            {plan.testTypes.length > 0 && <> &middot; {plan.testTypes.join(', ')}</>}
          </p>
        </div>
        <button className="tp-run-btn" onClick={handleRun} disabled={!jiraId || runLoading}>
          {runLoading ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          {runLoading ? 'Starting…' : 'Run Tests'}
        </button>
      </div>

      <div className="tp-section">
        <span className="tp-section-label">Scope</span>
        <p className="tp-scope-text">{plan.scope}</p>
      </div>

      {plan.riskAreas.length > 0 && (
        <div className="tp-section">
          <span className="tp-section-label">Risk Areas</span>
          <div className="tp-risk-row">
            {plan.riskAreas.map(r => (
              <span key={r} className="tp-risk-chip">{r}</span>
            ))}
          </div>
        </div>
      )}

      <div className="tp-cases">
        {plan.testCases.map(tc => {
          const expanded = expandedId === tc.id;
          return (
            <div key={tc.id} className={`tp-case ${expanded ? 'expanded' : ''}`}>
              <button
                className="tp-case-header"
                onClick={() => setExpandedId(expanded ? null : tc.id)}
              >
                <div className="tp-case-left">
                  <span className="tp-tc-id">{tc.id}</span>
                  <span className="tp-badge" style={{ background: TYPE_COLORS[tc.type] + '22', color: TYPE_COLORS[tc.type], borderColor: TYPE_COLORS[tc.type] + '55' }}>
                    {tc.type}
                  </span>
                  <span className="tp-badge" style={{ background: PRIORITY_COLORS[tc.priority] + '22', color: PRIORITY_COLORS[tc.priority], borderColor: PRIORITY_COLORS[tc.priority] + '55' }}>
                    {tc.priority}
                  </span>
                  <span className="tp-case-title">{tc.title}</span>
                </div>
                <ChevronDown size={16} className={`tp-chevron ${expanded ? 'rotated' : ''}`} />
              </button>

              {expanded && (
                <div className="tp-case-body">
                  <div className="tp-case-section">
                    <span className="tp-case-label">Steps</span>
                    <ol className="tp-steps">
                      {tc.steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  </div>
                  <div className="tp-case-section">
                    <span className="tp-case-label">Expected Result</span>
                    <p className="tp-expected">{tc.expectedResult}</p>
                  </div>
                  <div className="tp-case-section">
                    <span className="tp-case-label">Target Page</span>
                    <a className="tp-url" href={tc.targetPage} target="_blank" rel="noopener noreferrer">{tc.targetPage}</a>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TestPlanView;
