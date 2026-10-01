import { stripAnsi } from '@shared/ansi-strip';
import type { LogLine } from '@shared/processes';
import { type Level, structuredOf } from './structured';

export interface LogFilters {
  levels: ReadonlySet<Level>;
  context: string | null;
  requestId: string;
}

export const NO_FILTERS: LogFilters = { levels: new Set(), context: null, requestId: '' };

export function structuredFilterActive(f: LogFilters): boolean {
  return f.levels.size > 0 || f.context !== null || f.requestId.trim() !== '';
}

/** With a structured filter active, only matching structured lines remain: plain and system lines are hidden. */
export function visibleLines(lines: readonly LogLine[], f: LogFilters): readonly LogLine[] {
  if (!structuredFilterActive(f)) return lines;
  const requestId = f.requestId.trim().toLowerCase();
  return lines.filter((line) => {
    const s = structuredOf(line);
    if (!s) return false;
    if (f.levels.size > 0 && !f.levels.has(s.level)) return false;
    if (f.context !== null && s.context !== f.context) return false;
    if (requestId && !(s.requestId ?? '').toLowerCase().includes(requestId)) return false;
    return true;
  });
}

/** What search looks at: the plain text, or a structured line's message plus its raw JSON. */
export function searchableText(line: LogLine): string {
  const s = structuredOf(line);
  return s ? `${s.message} ${JSON.stringify(s.raw)}` : stripAnsi(line.text);
}

/** Indexes into `visible` whose searchable text contains the query (case-insensitive). */
export function searchHits(visible: readonly LogLine[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: number[] = [];
  visible.forEach((line, i) => {
    if (searchableText(line).toLowerCase().includes(q)) hits.push(i);
  });
  return hits;
}

/** Every context seen in structured lines, sorted. */
export function contextsOf(lines: readonly LogLine[]): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    const context = structuredOf(line)?.context;
    if (context) seen.add(context);
  }
  return [...seen].sort();
}
