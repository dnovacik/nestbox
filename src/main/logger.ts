/** Fields are primitives only, so whole objects (payloads, env, file contents) cannot be logged by accident. */
export type LogFields = Record<string, string | number | boolean | null>;
export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  fields: LogFields | undefined;
}

export function createConsoleLogger(): Logger {
  const write = (level: LogLevel) => (message: string, fields?: LogFields) => {
    const line = fields ? `${message} ${JSON.stringify(fields)}` : message;
    console[level](`[nestbox] ${line}`);
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}

export function createMemoryLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const write = (level: LogLevel) => (message: string, fields?: LogFields) => {
    entries.push({ level, message, fields });
  };
  return { entries, info: write('info'), warn: write('warn'), error: write('error') };
}
