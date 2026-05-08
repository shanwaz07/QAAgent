import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Play, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { TestPlan, TestCase } from './ConversationalAgent';

interface Props {
  plan: TestPlan;
  locked: boolean;
  onDecision: (decision: 'approve' | 'regenerate') => void;
}

const PlanReviewCard: React.FC<Props> = ({ plan, locked, onDecision }) => {
  const [expandedTcId, setExpandedTcId] = useState<string | null>(null);

  const toggleTc = (id: string) => setExpandedTcId(prev => prev === id ? null : id);
  const targetUrl = plan.testCases?.[0]?.targetPage || '';

  return (
    <div className={`card-plan-review ${locked ? 'card-plan-review-locked' : ''}`}>
      <div className="card-plan-header">
        <div className="card-plan-title">{plan.testPlanTitle || `Test Plan: ${plan.jiraId}`}</div>
        {locked && (
          <span className="card-plan-locked-badge">
            <CheckCircle2 size={12} /> Decision recorded
          </span>
        )}
      </div>

      <div className="card-plan-meta">
        <div className="card-plan-meta-row">
          <span className="conf-label">Jira ID</span>
          <span className="conf-value mono">{plan.jiraId}</span>
        </div>
        {targetUrl && (
          <div className="card-plan-meta-row">
            <span className="conf-label">Target URL</span>
            <span className="conf-value mono card-plan-url">{targetUrl}</span>
          </div>
        )}
        <div className="card-plan-meta-row">
          <span className="conf-label">Scope</span>
          <span className="conf-value">{plan.scope}</span>
        </div>
        {plan.testTypes?.length > 0 && (
          <div className="card-plan-meta-row">
            <span className="conf-label">Types</span>
            <span className="conf-value">
              {plan.testTypes.map(t => <span key={t} className="card-plan-chip">{t}</span>)}
            </span>
          </div>
        )}
      </div>

      {plan.riskAreas?.length > 0 && (
        <div className="card-plan-risk">
          <div className="card-plan-risk-header">
            <AlertTriangle size={14} color="#fbbf24" />
            <span>Risk areas</span>
          </div>
          <ul>
            {plan.riskAreas.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      <div className="card-plan-cases">
        <div className="card-plan-cases-header">
          Test cases ({plan.testCases?.length || 0})
        </div>
        {plan.testCases?.map((tc: TestCase) => (
          <div key={tc.id} className="card-plan-case">
            <button
              className="card-plan-case-row"
              onClick={() => toggleTc(tc.id)}
              type="button"
            >
              {expandedTcId === tc.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="card-plan-case-id mono">{tc.id}</span>
              <span className="card-plan-case-title">{tc.title}</span>
              <span className={`card-plan-case-type type-${(tc.type || '').toLowerCase()}`}>{tc.type}</span>
              <span className={`card-plan-case-priority pri-${(tc.priority || '').toLowerCase()}`}>{tc.priority}</span>
            </button>
            {expandedTcId === tc.id && (
              <div className="card-plan-case-details">
                <div className="case-detail-block">
                  <span className="case-detail-label">Steps</span>
                  <ol>
                    {tc.steps?.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
                <div className="case-detail-block">
                  <span className="case-detail-label">Expected</span>
                  <p>{tc.expectedResult}</p>
                </div>
                <div className="case-detail-block">
                  <span className="case-detail-label">Page</span>
                  <p className="mono">{tc.targetPage}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {!locked && (
        <div className="card-plan-actions">
          <button className="btn-proceed" onClick={() => onDecision('approve')}>
            <Play size={14} /> Approve & Run
          </button>
          <button className="btn-cancel" onClick={() => onDecision('regenerate')}>
            <RefreshCw size={14} /> Regenerate
          </button>
        </div>
      )}
    </div>
  );
};

export default PlanReviewCard;
