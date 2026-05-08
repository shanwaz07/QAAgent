import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from 'axios';
import {
  MessageSquare, ListChecks, Play, BarChart3,
  Bug, Download, Settings, Activity, CheckCircle, XCircle, RefreshCw, Terminal, Database,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

import ConversationalAgent from './components/ConversationalAgent';
import ContextView from './components/ContextView';
import TestPlanView from './components/TestPlanView';
import ReportView from './components/ReportView';
import SettingsPanel from './components/SettingsPanel';
import SyncButton from './components/SyncButton';
import { ToastCenter, LogDrawer } from './components/ToastCenter';

const socket = io('http://localhost:5000');

interface TestData {
  totalTests: number;
  passed: number;
  failed: number;
  healed: number;
  agentStatus: string;
  recentLogs: string[];
}

// ── Sidebar nav items ─────────────────────────────────────────────
const NAV = [
  { to: '/', icon: <MessageSquare size={18} />, label: 'Chat' },
  { to: '/context', icon: <Database size={18} />, label: 'Context' },
  { to: '/plan', icon: <ListChecks size={18} />, label: 'Test Plan' },
  { to: '/run', icon: <Play size={18} />, label: 'Live Run' },
  { to: '/report', icon: <BarChart3 size={18} />, label: 'Report' },
  { to: '/bugs', icon: <Bug size={18} />, label: 'Bug Triage' },
  { to: '/export', icon: <Download size={18} />, label: 'Export' },
  { to: '/settings', icon: <Settings size={18} />, label: 'Settings' },
];

// ── Placeholder views for phases 4-8 ────────────────────────────
const Placeholder = ({ title }: { title: string }) => (
  <div className="placeholder-view">
    <h2>{title}</h2>
    <p className="dim">Coming in a future phase.</p>
  </div>
);

// ── Live Run / Dashboard view (existing) ──────────────────────────
const LiveRunView: React.FC = () => {
  const [data, setData] = useState<TestData>({
    totalTests: 0, passed: 0, failed: 0, healed: 0,
    agentStatus: 'Standby', recentLogs: [],
  });

  useEffect(() => {
    // Restore last run results on mount
    const lastJiraId = localStorage.getItem('lastJiraId');
    if (lastJiraId) {
      axios.get(`http://localhost:5000/api/results/${lastJiraId}`)
        .then(r => {
          const results = r.data;
          setData(prev => ({
            ...prev,
            totalTests: results.total ?? 0,
            passed: results.passed ?? 0,
            failed: results.failed ?? 0,
            agentStatus: results.total > 0 ? `Last run: ${lastJiraId}` : prev.agentStatus,
            recentLogs: (results.results ?? []).map((t: { tcid: string; status: string }) => `${t.tcid}: ${t.status}`).slice(0, 10),
          }));
        })
        .catch(() => { /* no previous results — keep defaults */ });
    }

    socket.on('status_changed', (message: { type: string; data?: Partial<TestData>; status?: string }) => {
      if (message.type === 'DATA_UPDATE') {
        setData(prev => ({
          ...prev, ...message.data,
          recentLogs: [...(message.data?.recentLogs ?? []), ...prev.recentLogs].slice(0, 10),
        }));
      } else if (message.type === 'STATUS_UPDATE') {
        setData(prev => ({ ...prev, agentStatus: message.status ?? prev.agentStatus }));
      }
    });
    return () => { socket.off('status_changed'); };
  }, []);

  return (
    <>
      <div className="stats-grid">
        <StatCard icon={<BarChart3 size={20} color="#818cf8" />} label="Total Executed" value={data.totalTests} />
        <StatCard icon={<CheckCircle size={20} color="#34d399" />} label="Passed" value={data.passed} />
        <StatCard icon={<XCircle size={20} color="#fb7185" />} label="Failed" value={data.failed} />
        <StatCard icon={<RefreshCw size={20} color="#38bdf8" />} label="Self Healed" value={data.healed} />
      </div>

      <div className="main-content">
        <section className="execution-pannel">
          <h2 className="panel-title">
            <Activity size={20} color="#818cf8" /> Live Execution Stream
          </h2>
          <div className="logs-list">
            <AnimatePresence initial={false}>
              {data.recentLogs.length === 0 ? (
                <p className="dim" style={{ padding: '1rem' }}>Waiting for run to start…</p>
              ) : data.recentLogs.map((log, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="log-entry">
                  <div className="log-timestamp">{new Date().toLocaleTimeString()}</div>
                  <div className="log-message">{log}</div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>

        <aside className="insights-panel">
          <div className="insight-card">
            <h2 className="panel-title"><Terminal size={20} color="#818cf8" /> AI Insights</h2>
            <div className="insight-body">
              <div className="insight-block">
                <p className="insight-kicker">Root Cause Analysis</p>
                <p className="insight-text">
                  {data.failed > 0
                    ? 'Detected DOM structure change. Check locators in failing specs.'
                    : 'System performance is optimal. No critical failures detected.'}
                </p>
              </div>
              {data.failed > 0 && (
                <div className="insight-block purple">
                  <p className="insight-kicker">Healing Suggestion</p>
                  <p className="insight-text italic">"Switch to data-testid or semantic locators for resilient selectors."</p>
                </div>
              )}
            </div>
          </div>
          <div className="agent-status-card">
            <span className="dim">Agent Status</span>
            <span className="agent-status-value">{data.agentStatus}</span>
          </div>
        </aside>
      </div>
    </>
  );
};

const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) => (
  <div className="stat-card">
    <div className="stat-header">{icon}<span className="stat-label">{label}</span></div>
    <div className="stat-value">{value}</div>
  </div>
);

// ── Root layout ───────────────────────────────────────────────────
const App: React.FC = () => {
  const [logDrawerOpen, setLogDrawerOpen] = useState(() => {
    try { return sessionStorage.getItem('qa_log_drawer') === 'true'; } catch { return false; }
  });

  const toggleLogDrawer = (open: boolean) => {
    setLogDrawerOpen(open);
    try { sessionStorage.setItem('qa_log_drawer', String(open)); } catch { /* ignore */ }
  };

  return (
    <BrowserRouter>
      <ToastCenter />
      <LogDrawer open={logDrawerOpen} onClose={() => toggleLogDrawer(false)} />
      <div className="app-layout">
        <div className="bg-glow">
          <div className="glow-1" /><div className="glow-2" />
        </div>

        <nav className="sidebar">
          <div className="sidebar-brand">
            <span className="brand-dot" />
            <span className="brand-name">AI Tester</span>
          </div>
          <ul className="nav-list">
            {NAV.map(({ to, icon, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  {icon}
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="sidebar-sync">
            <SyncButton />
          </div>

          <div className="sidebar-footer">
            <div className="pulse" /><span>v2.0.0</span>
            <button className="log-drawer-btn" onClick={() => toggleLogDrawer(true)} title="View application logs">
              Logs
            </button>
          </div>
        </nav>

        <main className="main-area">
          <Routes>
            <Route path="/" element={<ConversationalAgent />} />
            <Route path="/context" element={<ContextView />} />
            <Route path="/plan" element={<TestPlanView />} />
            <Route path="/run" element={<LiveRunView />} />
            <Route path="/report" element={<ReportView />} />
            <Route path="/bugs" element={<Placeholder title="Bug Triage" />} />
            <Route path="/export" element={<Placeholder title="Export" />} />
            <Route path="/settings" element={<SettingsPanel />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
};

export default App;
