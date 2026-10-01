import { describe, expect, it } from 'vitest';
import { parseAnsi } from './ansi';
import { findLinks } from './links';
import { decorate, findMatches } from './pieces';

describe('findMatches', () => {
  it('finds case-insensitive, non-overlapping matches', () => {
    expect(findMatches('Error error', 'error')).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
    ]);
    expect(findMatches('aaaa', 'aa')).toHaveLength(2);
  });

  it('finds nothing for an empty query', () => {
    expect(findMatches('abc', '')).toEqual([]);
  });
});

describe('decorate', () => {
  it('splits at link and match boundaries and keeps styles', () => {
    const text = '\u001b[31mfail\u001b[0m at src/a.ts:3 now';
    const segments = parseAnsi(text);
    const plain = segments.map((s) => s.text).join('');
    const pieces = decorate(segments, findLinks(plain), findMatches(plain, 'fa'));
    expect(pieces.map((p) => [p.text, p.link?.path ?? null, p.match, p.style.fg?.kind ?? null])).toEqual([
      ['fa', null, true, 'palette'],
      ['il', null, false, 'palette'],
      [' at ', null, false, null],
      ['src/a.ts:3', 'src/a.ts', false, null],
      [' now', null, false, null],
    ]);
  });

  it('gives a link that spans two segments to both pieces', () => {
    const segments = parseAnsi('\u001b[1msrc/\u001b[22ma.ts:9');
    const plain = segments.map((s) => s.text).join('');
    const pieces = decorate(segments, findLinks(plain), []);
    expect(pieces.map((p) => [p.text, p.link?.line ?? null])).toEqual([
      ['src/', 9],
      ['a.ts:9', 9],
    ]);
  });
});
