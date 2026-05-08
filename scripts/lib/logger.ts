import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  context: string;
  message: string;
  meta?: Record<string, unknown>;
}

// Bus that server.js bridges to Socket.IO
export const logBus = new EventEmitter();
logBus.setMaxListeners(20);

const LOG_DIR = path.join(__dirname, '../../artifacts/logs');

function todayFile(): string {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `app-${d}.log`);
}

function write(entry: LogEntry): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(todayFile(), JSON.stringify(entry) + '\n');
  } catch {
    // never let logging crash the app
  }
}

function emit(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): LogEntry {
  const entry: LogEntry = { ts: new Date().toISOString(), level, context, message };
  if (meta) entry.meta = meta;

  // Console — keep existing developer visibility
  const prefix = `[${entry.ts.slice(11, 19)}] [${level}] [${context}]`;
  if (level === 'ERROR') console.error(prefix, message, meta ?? '');
  else if (level === 'WARN') console.warn(prefix, message, meta ?? '');
  else console.log(prefix, message);

  write(entry);
  logBus.emit('log', entry);
  return entry;
}

export const logger = {
  info:  (ctx: string, msg: string, meta?: Record<string, unknown>) => emit('INFO',  ctx, msg, meta),
  warn:  (ctx: string, msg: string, meta?: Record<string, unknown>) => emit('WARN',  ctx, msg, meta),
  error: (ctx: string, msg: string, meta?: Record<string, unknown>) => emit('ERROR', ctx, msg, meta),
};

// Read last N lines from today's log (used by GET /api/logs)
export function readRecentLogs(lines = 100, date?: string): LogEntry[] {
  try {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const file = path.join(LOG_DIR, `app-${d}.log`);
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').trim().split('\n');
    return raw
      .slice(-lines)
      .map(l => { try { return JSON.parse(l) as LogEntry; } catch { return null; } })
      .filter(Boolean) as LogEntry[];
  } catch {
    return [];
  }
}
