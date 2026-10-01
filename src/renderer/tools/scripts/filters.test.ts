import { describe, expect, it } from 'vitest';
import type { LogLine } from '@shared/processes';
import { contextsOf, NO_FILTERS, searchHits, visibleLines } from './filters';

let seq = 0;
const line = (text: string, stream: LogLine['stream'] = 'stdout'): LogLine => ({ seq: ++seq, ts: 0, stream, text });
const json = (level: number, msg: string, extra: Record<string, unknown> = {}) => line(JSON.stringify({ level, msg, ...extra }));

const lines = [
  line('▸ pnpm run dev', 'system'),
  line('plain \u001b[31mboom\u001b[0m'),
  json(30, 'GET /', { context: 'Http', reqId: 'req-1' }),
  json(50, 'db down', { context: 'Db', reqId: 'req-2' }),
  json(50, 'http failed', { context: 'Http', reqId: 'req-3' }),
];

describe('filters', () => {
  it('shows everything without filters', () => {
    expect(visibleLines(lines, NO_FILTERS)).toBe(lines);
  });

  it('keeps only matching structured lines when filtering by level', () => {
    expect(visibleLines(lines, { ...NO_FILTERS, levels: new Set(['error']) }).map((l) => l.seq)).toEqual([
      lines[3]?.seq,
      lines[4]?.seq,
    ]);
  });

  it('combines context and requestId filters', () => {
    const out = visibleLines(lines, { levels: new Set(), context: 'Http', requestId: 'REQ-3' });
    expect(out).toEqual([lines[4]]);
  });

  it('searches plain text without ANSI and structured message and JSON', () => {
    expect(searchHits(lines, 'boom')).toEqual([1]);
    expect(searchHits(lines, 'req-2')).toEqual([3]);
    expect(searchHits(lines, '  ')).toEqual([]);
  });

  it('lists contexts sorted and unique', () => {
    expect(contextsOf(lines)).toEqual(['Db', 'Http']);
  });
});
