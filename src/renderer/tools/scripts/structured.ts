import { stripAnsi } from '@shared/ansi-strip';
import { isRecord } from '@shared/is-record';
import type { LogLine } from '@shared/processes';

export const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type Level = (typeof LEVELS)[number];

export interface StructuredLine {
  level: Level;
  time: number | null;
  context: string | null;
  message: string;
  requestId: string | null;
  raw: Record<string, unknown>;
}

const PINO: [number, Level][] = [
  [10, 'trace'],
  [20, 'debug'],
  [30, 'info'],
  [40, 'warn'],
  [50, 'error'],
];

const NAMED: Record<string, Level> = {
  trace: 'trace',
  verbose: 'trace',
  debug: 'debug',
  info: 'info',
  log: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'fatal',
};

function levelOf(v: unknown): Level | null {
  if (typeof v === 'number' && Number.isFinite(v)) return PINO.find(([max]) => v <= max)?.[1] ?? 'fatal';
  if (typeof v === 'string') return Object.hasOwn(NAMED, v.toLowerCase()) ? (NAMED[v.toLowerCase()] ?? null) : null;
  return null;
}

function timeOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

const idOf = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

/**
 * NestJS's default ConsoleLogger: `[Nest] 20596  - 10/01/2026, 4:01:34 PM     LOG [Context] message +2ms`.
 * The app name is configurable, the context optional, and the timestamp locale-formatted.
 */
const NEST_TEXT = /^\[([^\]]+)\]\s+(\d+)\s+-\s+(.+?)\s+(LOG|ERROR|WARN|DEBUG|VERBOSE|FATAL)\s+(?:\[([^\]]+)\]\s*)?(.*?)(?:\s+\+\d+ms)?$/;

function parseNestText(t: string): StructuredLine | null {
  const m = NEST_TEXT.exec(t);
  if (!m) return null;
  const [, app = '', pid = '', timestamp = '', label = '', context, message = ''] = m;
  const level = levelOf(label);
  if (!level) return null;
  return {
    level,
    // The timestamp is locale-formatted and Date.parse misreads many locales; the arrival time is exact.
    time: null,
    context: context ?? null,
    message,
    requestId: null,
    raw: { app, pid: Number(pid), timestamp, level: label, context: context ?? null, message },
  };
}

/** Parses one log line from pino, NestJS (JSON or its default text logger) or winston; null for anything else. */
export function parseStructured(text: string): StructuredLine | null {
  const t = stripAnsi(text).trim();
  if (t.startsWith('[')) return parseNestText(t);
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const level = levelOf(raw['level']);
  if (!level) return null;
  const msg = raw['msg'] ?? raw['message'];
  const req = raw['req'];
  return {
    level,
    time: timeOf(raw['time'] ?? raw['timestamp']),
    context: typeof raw['context'] === 'string' ? raw['context'] : null,
    message: typeof msg === 'string' ? msg : msg === undefined ? '' : JSON.stringify(msg),
    requestId: idOf(raw['reqId'] ?? raw['requestId'] ?? (isRecord(req) ? req['id'] : undefined)),
    raw,
  };
}

const cache = new WeakMap<LogLine, StructuredLine | null>();

/** Cached per line object; system lines are never structured. */
export function structuredOf(line: LogLine): StructuredLine | null {
  if (line.stream === 'system') return null;
  if (!cache.has(line)) cache.set(line, parseStructured(line.text));
  return cache.get(line) ?? null;
}
