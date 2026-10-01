import { stripAnsi } from '@shared/ansi-strip';
import type { LogLine } from '@shared/processes';

/** Plain-text export: one `ISO-timestamp text` line each, ANSI stripped, CRLF line endings. */
export function formatExport(lines: readonly LogLine[]): string {
  return lines.map((l) => `${new Date(l.ts).toISOString()} ${stripAnsi(l.text)}\r\n`).join('');
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** e.g. dev_api-20261001-120304.log, in local time; anything outside [A-Za-z0-9.-] becomes _. */
export function exportFileName(script: string, now: Date): string {
  const safe = script.replace(/[^A-Za-z0-9.-]+/g, '_').slice(0, 80) || 'script';
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${safe}-${stamp}.log`;
}
