import React, { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { X, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export interface LogEntry {
  ts: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  context: string;
  message: string;
  meta?: Record<string, unknown>;
}

interface Toast extends LogEntry {
  id: number;
}

const socket = io('http://localhost:5000');
let toastSeq = 0;

// Only surface WARN and ERROR as toasts — INFO is too noisy
const TOAST_LEVELS: LogEntry['level'][] = ['WARN', 'ERROR'];
const AUTO_DISMISS_MS = { INFO: 0, WARN: 8000, ERROR: 0 }; // 0 = manual dismiss

const ICONS = {
  INFO:  <Info size={14} />,
  WARN:  <AlertTriangle size={14} />,
  ERROR: <AlertCircle size={14} />,
};

export const ToastCenter: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((entry: LogEntry) => {
    if (!TOAST_LEVELS.includes(entry.level)) return;
    const id = ++toastSeq;
    setToasts(prev => [...prev.slice(-4), { ...entry, id }]); // max 5 visible
    const delay = AUTO_DISMISS_MS[entry.level];
    if (delay > 0) setTimeout(() => dismiss(id), delay);
  }, [dismiss]);

  useEffect(() => {
    socket.on('app_log', addToast);
    // log_history is replayed on connect — don't surface old history as toasts
    return () => { socket.off('app_log', addToast); };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.level.toLowerCase()}`}>
          <div className="toast-icon">{ICONS[t.level]}</div>
          <div className="toast-body">
            <span className="toast-context">{t.context}</span>
            <span className="toast-message">{t.message}</span>
            {t.meta?.error && (
              <span className="toast-meta">{String(t.meta.error).slice(0, 120)}</span>
            )}
          </div>
          <button className="toast-close" onClick={() => dismiss(t.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};

// ── Log drawer (full history panel) ──────────────────────────────

export const LogDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    socket.on('log_history', (history: LogEntry[]) => setLogs(history));
    socket.on('app_log', (entry: LogEntry) => setLogs(prev => [...prev.slice(-199), entry]));
    return () => {
      socket.off('log_history');
      socket.off('app_log');
    };
  }, []);

  if (!open) return null;

  return (
    <div className="log-drawer-overlay" onClick={onClose}>
      <div className="log-drawer" onClick={e => e.stopPropagation()}>
        <div className="log-drawer-header">
          <span>Application Logs</span>
          <button className="toast-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="log-drawer-body">
          {logs.length === 0 ? (
            <p className="dim" style={{ padding: '1rem' }}>No logs yet.</p>
          ) : [...logs].reverse().map((l, i) => (
            <div key={i} className={`log-row log-row-${l.level.toLowerCase()}`}>
              <span className="log-row-ts">{l.ts.slice(11, 19)}</span>
              <span className={`log-row-level level-${l.level.toLowerCase()}`}>{l.level}</span>
              <span className="log-row-ctx">{l.context}</span>
              <span className="log-row-msg">{l.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
