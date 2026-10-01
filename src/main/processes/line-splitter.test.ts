import { describe, expect, it } from 'vitest';
import { LineSplitter, MAX_LINE_CHARS, MAX_PENDING_CHARS } from './line-splitter';

describe('LineSplitter', () => {
  it('splits on LF and CRLF and holds back a partial line', () => {
    const s = new LineSplitter();
    expect(s.push('a\r\nb\nc')).toEqual(['a', 'b']);
    expect(s.hasPending).toBe(true);
    expect(s.flush()).toEqual(['c']);
    expect(s.hasPending).toBe(false);
  });

  it('joins a line split across chunks', () => {
    const s = new LineSplitter();
    expect(s.push('hel')).toEqual([]);
    expect(s.push('lo\n')).toEqual(['hello']);
  });

  it('keeps only the text after a lone CR (progress redraws)', () => {
    expect(new LineSplitter().push('10%\r50%\r100%\n')).toEqual(['100%']);
  });

  it('keeps empty lines', () => {
    expect(new LineSplitter().push('a\n\nb\n')).toEqual(['a', '', 'b']);
  });

  it('decodes multibyte characters split across chunks', () => {
    const bytes = new TextEncoder().encode('café\n');
    const s = new LineSplitter();
    expect(s.push(bytes.slice(0, 4))).toEqual([]);
    expect(s.push(bytes.slice(4))).toEqual(['café']);
  });

  it('truncates long lines with an ellipsis', () => {
    const [out] = new LineSplitter().push(`${'x'.repeat(100_000)}\n`);
    expect(out).toHaveLength(MAX_LINE_CHARS + 1);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('emits an over-long pending line instead of growing without bound', () => {
    const s = new LineSplitter();
    expect(s.push('y'.repeat(MAX_PENDING_CHARS + 10))).toHaveLength(1);
    expect(s.hasPending).toBe(false);
  });

  it('keeps a split character pending across a non-final flush', () => {
    const bytes = new TextEncoder().encode('é');
    const s = new LineSplitter();
    s.push(bytes.slice(0, 1));
    expect(s.flush()).toEqual([]);
    expect(s.push(bytes.slice(1))).toEqual([]);
    expect(s.flush(true)).toEqual(['é']);
  });

  it('flushes an empty splitter to nothing', () => {
    expect(new LineSplitter().flush()).toEqual([]);
  });
});
