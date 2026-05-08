import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Send, Loader2, Activity, CheckCircle, Bot, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../hooks/useSettings';
import ClarificationCard from './ClarificationCard';
import PlanReviewCard from './PlanReviewCard';
import TestCaseReviewCard from './TestCaseReviewCard';
import ExplorationCard from './ExplorationCard';

const socket = io('http://localhost:5000');

// ── Types matching backend conversationManager phases ─────────────
type Phase = 'idle' | 'analyzing' | 'clarifying' | 'plan_review' | 'tc_review' | 'executing' | 'done' | 'error';

export interface ClarifyQuestion {
  id: string;
  question: string;
  type: 'text' | 'choice';
  options?: string[];
  required: boolean;
}

export interface TestCase {
  id: string;
  title: string;
  type: string;
  priority: string;
  steps: string[];
  expectedResult: string;
  targetPage: string;
}

export interface TestPlan {
  testPlanTitle: string;
  jiraId: string;
  scope: string;
  testTypes: string[];
  riskAreas: string[];
  testCases: TestCase[];
}

interface AgentMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text?: string;
  card?: 'clarification' | 'plan_review' | 'tc_review' | 'exploration';
  payload?: ClarifyQuestion[] | TestPlan | TestCase[] | { jiraId: string };
  cardLocked?: boolean;
  timestamp: number;
}

interface StepLog { status: string; done: boolean }

const SESSION_KEY = 'qa_conv_session';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'sess-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadSession(): { sessionId: string; messages: AgentMessage[]; phase: Phase } {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { sessionId: uuid(), messages: [], phase: 'idle' };
}

function saveSession(data: { sessionId: string; messages: AgentMessage[]; phase: Phase }) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

const ConversationalAgent: React.FC = () => {
  const initial = loadSession();
  const [sessionId, setSessionId] = useState(initial.sessionId);
  const [messages, setMessages] = useState<AgentMessage[]>(initial.messages);
  const [phase, setPhase] = useState<Phase>(initial.phase);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<StepLog[]>([]);
  const [executionStarted, setExecutionStarted] = useState(false);
  const [finished, setFinished] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { settings } = useSettings();

  // Persist on every change
  useEffect(() => {
    saveSession({ sessionId, messages, phase });
  }, [sessionId, messages, phase]);

  // Auto-scroll to bottom on new message / step
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, steps]);

  // ── Socket listeners ──
  useEffect(() => {
    const onThinking = (data: { sessionId: string; message: string }) => {
      if (data.sessionId !== sessionId) return;
      setMessages(prev => [...prev, {
        id: uuid(), role: 'system', text: data.message, timestamp: Date.now(),
      }]);
    };

    const onStatus = (msg: { type: string; status?: string }) => {
      if (msg.type !== 'STATUS_UPDATE' || !msg.status) return;
      setSteps(prev => {
        const prevDone = prev.map((s, i) => i === prev.length - 1 ? { ...s, done: true } : s);
        if (prevDone.length > 0 && prevDone[prevDone.length - 1]?.status === msg.status) return prevDone;
        return [...prevDone, { status: msg.status!, done: false }];
      });
      if (msg.status.startsWith('Workflow complete') || msg.status.startsWith('Error:')) {
        setSteps(prev => prev.map((s, i) => i === prev.length - 1 ? { ...s, done: true } : s));
        setFinished(true);
      }
    };

    const onDone = (data: { sessionId: string; jiraId: string; transcriptPath?: string }) => {
      if (data.sessionId !== sessionId) return;
      setPhase('done');
      setFinished(true);
      if (data.jiraId) localStorage.setItem('lastJiraId', data.jiraId);
    };

    socket.on('converse_thinking', onThinking);
    socket.on('status_changed', onStatus);
    socket.on('converse_done', onDone);

    return () => {
      socket.off('converse_thinking', onThinking);
      socket.off('status_changed', onStatus);
      socket.off('converse_done', onDone);
    };
  }, [sessionId]);

  // ── Helpers ──
  const appendMessage = (m: Omit<AgentMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, { ...m, id: uuid(), timestamp: Date.now() }]);
  };

  const lockLastCard = () => {
    setMessages(prev => {
      const out = [...prev];
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].card && !out[i].cardLocked) { out[i] = { ...out[i], cardLocked: true }; break; }
      }
      return out;
    });
  };

  // ── Send the initial message → /api/converse phase=start ──
  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const message = input.trim();
    setInput('');
    setLoading(true);

    appendMessage({ role: 'user', text: message });

    try {
      const { data } = await axios.post('http://localhost:5000/api/converse', {
        sessionId,
        phase: 'start',
        payload: { message, ragTopK: settings.ragTopK ?? 10 },
      });
      setSessionId(data.sessionId);
      setPhase(data.phase);

      if (data.phase === 'clarifying' && data.questions?.length) {
        appendMessage({
          role: 'agent',
          text: `Found ${data.jiraId}${data.issueTitle ? ` — ${data.issueTitle}` : ''}. I have a few questions before I build the plan:`,
          card: 'clarification',
          payload: data.questions,
        });
      } else if (data.phase === 'plan_review' && data.plan) {
        appendMessage({
          role: 'agent',
          text: `Generated a test plan for ${data.jiraId} — ${data.plan.testCases.length} test cases. Review below:`,
          card: 'plan_review',
          payload: data.plan,
        });
      } else if (data.error) {
        appendMessage({ role: 'agent', text: `${data.error}` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appendMessage({ role: 'agent', text: `Error: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  // ── Submit clarification answers → phase=answers ──
  const handleSubmitAnswers = async (answers: Record<string, string>) => {
    setLoading(true);
    lockLastCard();
    const summary = Object.entries(answers).map(([k, v]) => `**${k}**: ${v}`).join(' · ');
    appendMessage({ role: 'user', text: summary || 'Submitted answers' });

    try {
      const { data } = await axios.post('http://localhost:5000/api/converse', {
        sessionId, phase: 'answers', payload: { answers },
      });
      setPhase(data.phase);
      if (data.phase === 'plan_review' && data.plan) {
        appendMessage({
          role: 'agent',
          text: `Test plan ready — ${data.plan.testCases.length} test cases. Review below:`,
          card: 'plan_review',
          payload: data.plan,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appendMessage({ role: 'agent', text: `Error: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  // ── Approve or regenerate plan → phase=approve_plan ──
  // Approval now transitions to tc_review (Phase 10.B), NOT directly to executing.
  const handlePlanDecision = async (decision: 'approve' | 'regenerate') => {
    setLoading(true);
    lockLastCard();
    appendMessage({
      role: 'user',
      text: decision === 'approve' ? 'Approved overall plan — review test cases.' : 'Regenerate the plan.',
    });

    try {
      const { data } = await axios.post('http://localhost:5000/api/converse', {
        sessionId,
        phase: 'approve_plan',
        payload: { regenerate: decision === 'regenerate' },
      });
      setPhase(data.phase);

      if (decision === 'approve' && data.testCases) {
        appendMessage({
          role: 'agent',
          text: `Review each test case below. Edit, remove, or keep before final execution.`,
          card: 'tc_review',
          payload: data.testCases,
        });
      } else if (decision === 'regenerate' && data.plan) {
        appendMessage({
          role: 'agent',
          text: `Regenerated — ${data.plan.testCases.length} test cases:`,
          card: 'plan_review',
          payload: data.plan,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appendMessage({ role: 'agent', text: `Error: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  // ── Confirm edited test cases → phase=approve_cases → kicks off execution ──
  const handleConfirmCases = async (finalCases: TestCase[]) => {
    setLoading(true);
    lockLastCard();
    appendMessage({
      role: 'user',
      text: `Confirmed ${finalCases.length} test case(s) — starting execution.`,
    });

    try {
      const { data } = await axios.post('http://localhost:5000/api/converse', {
        sessionId,
        phase: 'approve_cases',
        payload: {
          testCases: finalCases,
          ragTopK: settings.ragTopK ?? 30,
          executionMode: settings.executionMode ?? 'full',
          headless: settings.headless ?? false,
          model: settings.model,
        },
      });
      setPhase(data.phase);
      setExecutionStarted(true);
      setSteps([{ status: 'Loading requirements…', done: false }]);
      // Drop in an exploration card that watches page_explored events
      const jId = data.jiraId;
      if (jId) {
        appendMessage({
          role: 'agent',
          text: 'Familiarising with the application — capturing DOM snapshots…',
          card: 'exploration',
          payload: { jiraId: jId },
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appendMessage({ role: 'agent', text: `Error: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  // ── Reset (Cancel / new conversation) ──
  const handleReset = () => {
    sessionStorage.removeItem(SESSION_KEY);
    const newId = uuid();
    setSessionId(newId);
    setMessages([]);
    setPhase('idle');
    setSteps([]);
    setExecutionStarted(false);
    setFinished(false);
  };

  return (
    <div className="conv-container">
      <div className="conv-header">
        <h1>QA Agent</h1>
        <p className="chat-subtitle">
          Describe what you'd like to test. I'll ask any clarifying questions before building the plan.
        </p>
        {messages.length > 0 && (
          <button className="conv-reset-btn" onClick={handleReset}>New conversation</button>
        )}
      </div>

      <div className="msg-thread">
        {messages.map(m => (
          <div key={m.id} className={`msg-row msg-row-${m.role}`}>
            <div className="msg-avatar">
              {m.role === 'user' ? <User size={16} /> : m.role === 'agent' ? <Bot size={16} /> : <Activity size={14} />}
            </div>
            <div className={`msg-bubble msg-bubble-${m.role}`}>
              {m.text && <div className="msg-text">{m.text}</div>}
              {m.card === 'clarification' && (
                <ClarificationCard
                  questions={m.payload as ClarifyQuestion[]}
                  locked={!!m.cardLocked}
                  onSubmit={handleSubmitAnswers}
                />
              )}
              {m.card === 'plan_review' && (
                <PlanReviewCard
                  plan={m.payload as TestPlan}
                  locked={!!m.cardLocked}
                  onDecision={handlePlanDecision}
                />
              )}
              {m.card === 'tc_review' && (
                <TestCaseReviewCard
                  cases={m.payload as TestCase[]}
                  locked={!!m.cardLocked}
                  onConfirm={handleConfirmCases}
                />
              )}
              {m.card === 'exploration' && (
                <ExplorationCard jiraId={(m.payload as { jiraId: string }).jiraId} />
              )}
            </div>
          </div>
        ))}

        {executionStarted && steps.length > 0 && (
          <div className="run-progress run-progress-inline">
            <div className="run-progress-header">
              <Activity size={16} color="#818cf8" />
              <span>Execution {finished ? '— Done' : '— Running…'}</span>
              {!finished && <Loader2 size={14} className="spin dim" style={{ marginLeft: 'auto' }} />}
              {finished && <CheckCircle size={14} color="#34d399" style={{ marginLeft: 'auto' }} />}
            </div>
            <div className="run-steps">
              {steps.map((s, i) => {
                const cls = s.status.startsWith('PASSED') ? 'pass'
                          : s.status.startsWith('FAILED') ? 'fail' : '';
                return (
                  <div key={i} className={`run-step ${s.done ? 'done' : i === steps.length - 1 ? 'active' : ''} ${cls}`}>
                    <span className="run-step-icon">{s.done ? '✓' : i === steps.length - 1 ? '›' : '·'}</span>
                    <span className="run-step-text">{s.status}</span>
                  </div>
                );
              })}
            </div>
            {finished && (
              <div className="run-footer">
                <button className="run-view-btn" onClick={() => navigate('/plan')}>View Test Plan</button>
                <button className="run-view-btn" onClick={() => navigate('/report')}>View Report</button>
              </div>
            )}
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      <div className="conv-input-bar">
        <input
          type="text"
          className="chat-input"
          placeholder={
            messages.length === 0
              ? 'e.g. "test CBOT-751 on https://leolity-qa.goarya.com/ivyrehab"'
              : phase === 'clarifying'
                ? 'Use the form above to answer…'
                : phase === 'plan_review'
                  ? 'Use the buttons above to approve or regenerate…'
                  : phase === 'tc_review'
                    ? 'Use the cards above to edit and confirm…'
                    : phase === 'executing' || phase === 'done'
                      ? 'Click "New conversation" to start over'
                      : 'Type a message…'
          }
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          disabled={loading || phase === 'clarifying' || phase === 'plan_review' || phase === 'tc_review' || phase === 'executing'}
          autoFocus
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim() || phase === 'clarifying' || phase === 'plan_review' || phase === 'tc_review' || phase === 'executing'}
        >
          {loading ? <Loader2 size={20} className="spin" /> : <Send size={20} />}
        </button>
      </div>

      {messages.length === 0 && (
        <div className="chat-examples">
          <p className="examples-label">Try asking:</p>
          <div className="examples-list">
            {[
              'test CBOT-751 on https://leolity-qa.goarya.com/ivyrehab',
              'do full testing on CBOT-421',
              'smoke test the chat widget on https://leolity-qa.goarya.com/demo-staffing/home',
            ].map(ex => (
              <button key={ex} className="example-chip" onClick={() => setInput(ex)} disabled={loading}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConversationalAgent;
