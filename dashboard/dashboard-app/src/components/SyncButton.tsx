import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

interface SyncMeta {
  lastSyncAt?: string;
  projectKey?: string;
  totalIssues?: number;
  lastDeltaCount?: number;
}

interface SyncStatus {
  syncing: boolean;
  done?: boolean;
  error?: boolean;
  message?: string;
}

const socket = io('http://localhost:5000');

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const SyncButton: React.FC = () => {
  const [meta, setMeta] = useState<SyncMeta>({});
  const [status, setStatus] = useState<SyncStatus>({ syncing: false });
  const [isExecuting, setIsExecuting] = useState(false);
  const [, setTick] = useState(0); // force re-render for timeAgo

  // Refresh "X ago" label every minute
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Load initial state from server
  useEffect(() => {
    axios.get<SyncMeta & { isSyncing: boolean; isExecuting: boolean }>(
      'http://localhost:5000/api/jira/sync-status'
    ).then(({ data }) => {
      setMeta(data);
      setStatus(prev => ({ ...prev, syncing: data.isSyncing }));
      setIsExecuting(data.isExecuting);
    }).catch(() => null);
  }, []);

  // Socket listeners
  useEffect(() => {
    socket.on('sync_meta_update', (data: SyncMeta) => setMeta(data));

    socket.on('sync_status', (data: SyncStatus) => {
      setStatus(data);
      // Clear message after 5s once done
      if (data.done || data.error) {
        setTimeout(() => setStatus(prev => ({ ...prev, message: undefined, done: false, error: false })), 5000);
      }
    });

    socket.on('execution_status', (data: { executing: boolean }) => {
      setIsExecuting(data.executing);
    });

    return () => {
      socket.off('sync_meta_update');
      socket.off('sync_status');
      socket.off('execution_status');
    };
  }, []);

  const triggerSync = async (delta: boolean) => {
    try {
      await axios.post('http://localhost:5000/api/jira/sync', {
        projectKey: meta.projectKey || undefined,
        delta,
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Sync failed';
      setStatus({ syncing: false, error: true, message: msg });
      setTimeout(() => setStatus(prev => ({ ...prev, message: undefined, error: false })), 5000);
    }
  };

  const disabled = status.syncing || isExecuting;

  return (
    <div className="sync-widget">
      {/* Last sync info */}
      <div className="sync-meta">
        {meta.lastSyncAt ? (
          <>
            <Clock size={11} />
            <span>Synced {timeAgo(meta.lastSyncAt)}</span>
            {meta.totalIssues !== undefined && (
              <span className="sync-count">{meta.totalIssues} issues</span>
            )}
          </>
        ) : (
          <span className="sync-never">Never synced</span>
        )}
      </div>

      {/* Status message */}
      {status.message && (
        <div className={`sync-message ${status.error ? 'sync-error' : status.done ? 'sync-done' : ''}`}>
          {status.error ? <AlertCircle size={11} /> : status.done ? <CheckCircle2 size={11} /> : null}
          <span>{status.message}</span>
        </div>
      )}

      {/* Buttons */}
      <div className="sync-buttons">
        <button
          className={`sync-btn ${status.syncing ? 'syncing' : ''}`}
          onClick={() => triggerSync(true)}
          disabled={disabled}
          title={
            isExecuting ? 'Sync not available during test execution'
            : status.syncing ? 'Sync in progress…'
            : meta.lastSyncAt ? `Fetch changes since ${new Date(meta.lastSyncAt).toLocaleString()}`
            : 'No previous sync — will run full sync'
          }
        >
          <RefreshCw size={12} className={status.syncing ? 'spin' : ''} />
          {status.syncing ? 'Syncing…' : 'Sync Jira'}
        </button>

        {meta.lastSyncAt && (
          <button
            className="sync-btn-full"
            onClick={() => triggerSync(false)}
            disabled={disabled}
            title="Re-index all issues from scratch"
          >
            Full
          </button>
        )}
      </div>

      {isExecuting && !status.syncing && (
        <div className="sync-blocked">Locked during execution</div>
      )}
    </div>
  );
};

export default SyncButton;
