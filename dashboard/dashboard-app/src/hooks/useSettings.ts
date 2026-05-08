import { useState, useCallback } from 'react';

export interface AppSettings {
  ragTopK?: number;
  executionMode?: string;
  headless?: boolean;
  provider?: string;
  model?: string;
}

const LS_KEY = 'qa_agent_settings';

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load);

  const save = useCallback((updates: Partial<AppSettings>) => {
    const next = { ...load(), ...updates };
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    setSettings(next);
  }, []);

  return { settings, save };
}
