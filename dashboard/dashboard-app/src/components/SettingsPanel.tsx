import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { SlidersHorizontal, Save, CheckCircle, RefreshCw, AlertCircle, Circle, Loader2 } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';

type CheckStatus = 'ok' | 'error' | 'skip';

interface HealthCheck {
  name: string;
  status: CheckStatus;
  message: string;
  latency?: number;
}

const API = 'http://localhost:5000';

const PROVIDERS = ['google', 'openrouter', 'groq', 'openai'] as const;
type Provider = typeof PROVIDERS[number];

const PROVIDER_MODELS: Record<Provider, string[]> = {
  google: ['gemma-3-27b-it', 'gemini-1.5-pro', 'gemini-2.0-flash'],
  openrouter: ['qwen/qwen3-coder:free', 'google/gemma-4-31b-it:free', 'deepseek/deepseek-chat:free'],
  groq: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'qwen-qwq-32b'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
};

const StatusDot: React.FC<{ status: CheckStatus | 'checking' }> = ({ status }) => {
  if (status === 'checking') return <Loader2 size={14} className="spin hc-dot-checking" />;
  if (status === 'ok')       return <CheckCircle size={14} className="hc-dot-ok" />;
  if (status === 'error')    return <AlertCircle size={14} className="hc-dot-error" />;
  return <Circle size={14} className="hc-dot-skip" />;
};

const SettingsPanel: React.FC = () => {
  const { settings, save } = useSettings();
  const [saved, setSaved] = useState(false);

  const [ragTopK, setRagTopK] = useState(settings.ragTopK ?? 30);
  const [executionMode, setExecutionMode] = useState(settings.executionMode ?? 'full');
  const [headless, setHeadless] = useState(settings.headless ?? false);
  const [provider, setProvider] = useState<Provider>((settings.provider as Provider) ?? 'google');
  const [model, setModel] = useState(settings.model ?? 'gemma-3-27b-it');

  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const runHealthCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const res = await axios.get<{ checks: HealthCheck[] }>(`${API}/api/health`);
      setChecks(res.data.checks);
    } catch {
      setCheckError('Backend not reachable — is the server running?');
      setChecks([]);
    } finally {
      setChecking(false);
    }
  };

  // Auto-run on mount
  useEffect(() => { runHealthCheck(); }, []);

  // Reset model to first in list when provider changes
  useEffect(() => {
    const models = PROVIDER_MODELS[provider];
    if (!models.includes(model)) setModel(models[0]!);
  }, [provider]);

  const handleSave = async () => {
    const updated = { ragTopK, executionMode, headless, provider, model };
    save(updated);
    await axios.post('http://localhost:5000/api/settings', updated).catch(() => null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-container">
      <div className="settings-header">
        <SlidersHorizontal size={22} color="#818cf8" />
        <h1>Settings</h1>
      </div>

      <div className="settings-card">
        <h2>RAG Context Depth</h2>
        <p className="settings-desc">How many Jira issues to retrieve as context. Higher = more coverage, slower.</p>
        <div className="slider-row">
          <span className="slider-min">5</span>
          <input
            type="range"
            min={5} max={100} step={5}
            value={ragTopK}
            onChange={e => setRagTopK(Number(e.target.value))}
            className="slider"
          />
          <span className="slider-max">100</span>
          <span className="slider-value">{ragTopK}</span>
        </div>
      </div>

      <div className="settings-card">
        <h2>Test Execution Mode</h2>
        <div className="radio-group">
          {(['smoke', 'full', 'regression'] as const).map(mode => (
            <label key={mode} className={`radio-label ${executionMode === mode ? 'active' : ''}`}>
              <input
                type="radio"
                name="executionMode"
                value={mode}
                checked={executionMode === mode}
                onChange={() => setExecutionMode(mode)}
              />
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <div className="settings-card">
        <h2>Browser Visibility</h2>
        <div className="radio-group">
          <label className={`radio-label ${!headless ? 'active' : ''}`}>
            <input type="radio" name="headless" checked={!headless} onChange={() => setHeadless(false)} />
            Visible (Headed)
          </label>
          <label className={`radio-label ${headless ? 'active' : ''}`}>
            <input type="radio" name="headless" checked={headless} onChange={() => setHeadless(true)} />
            Headless
          </label>
        </div>
      </div>

      <div className="settings-card">
        <h2>LLM Provider &amp; Model</h2>
        <div className="llm-selectors">
          <div className="select-group">
            <label className="select-label">Provider</label>
            <select
              className="select-input"
              value={provider}
              onChange={e => setProvider(e.target.value as Provider)}
            >
              {PROVIDERS.map(p => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="select-group">
            <label className="select-label">Model</label>
            <select
              className="select-input"
              value={model}
              onChange={e => setModel(e.target.value)}
            >
              {PROVIDER_MODELS[provider].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Health Check ───────────────────────────────────────── */}
      <div className="settings-card">
        <div className="hc-header">
          <h2>Environment Health</h2>
          <button className="hc-refresh-btn" onClick={runHealthCheck} disabled={checking} title="Re-run checks">
            <RefreshCw size={14} className={checking ? 'spin' : ''} />
            {checking ? 'Checking…' : 'Re-check'}
          </button>
        </div>

        {checkError && <p className="hc-backend-err">{checkError}</p>}

        {checks.length > 0 && (
          <table className="hc-table">
            <tbody>
              {checks.map(c => (
                <tr key={c.name} className={`hc-row hc-row-${c.status}`}>
                  <td className="hc-dot-cell">
                    <StatusDot status={c.status} />
                  </td>
                  <td className="hc-name">{c.name}</td>
                  <td className="hc-msg">{c.message}</td>
                  <td className="hc-latency">
                    {c.latency != null ? `${c.latency}ms` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {checking && checks.length === 0 && (
          <div className="hc-loading"><Loader2 size={16} className="spin" /> Running checks…</div>
        )}
      </div>

      <button className="save-btn" onClick={handleSave}>
        {saved ? <><CheckCircle size={16} /> Saved!</> : <><Save size={16} /> Save Settings</>}
      </button>
    </div>
  );
};

export default SettingsPanel;
