import { describe, expect, it } from 'vitest';
import { exportFileName, formatExport } from './export';

describe('formatExport', () => {
  it('writes ISO timestamps and plain text with CRLF', () => {
    const out = formatExport([
      { seq: 1, ts: Date.UTC(2026, 9, 1, 12, 0, 0), stream: 'stdout', text: '\u001b[31mred\u001b[0m' },
      { seq: 2, ts: Date.UTC(2026, 9, 1, 12, 0, 1), stream: 'system', text: '■ exited with code 0' },
    ]);
    expect(out).toBe('2026-10-01T12:00:00.000Z red\r\n2026-10-01T12:00:01.000Z ■ exited with code 0\r\n');
  });

  it('writes nothing for no lines', () => {
    expect(formatExport([])).toBe('');
  });
});

describe('exportFileName', () => {
  it('makes the script name safe and stamps the local time', () => {
    expect(exportFileName('dev:api', new Date(2026, 9, 1, 12, 3, 4))).toBe('dev_api-20261001-120304.log');
    expect(exportFileName('../../x', new Date(2026, 0, 2, 3, 4, 5))).toBe('.._.._x-20260102-030405.log');
  });
});
