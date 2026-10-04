import { brotliCompressSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  bodyView,
  Capture,
  EntryRing,
  type Entry,
  headerPairs,
  isMasked,
  MASK,
  type RecordedSide,
  sideView,
} from './record';

const side = (headers: [string, string][], body: Buffer | string, bytes?: number): RecordedSide => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return { headers, body: buf, bytes: bytes ?? buf.length };
};

describe('Capture', () => {
  it('keeps the first bytes up to the limit and counts all of them', () => {
    const c = new Capture(5);
    c.push(Buffer.from('abc'));
    c.push(Buffer.from('defgh'));
    c.push(Buffer.from('ij'));
    expect(c.buffer().toString()).toBe('abcde');
    expect(c.bytes).toBe(10);
  });
});

describe('headers', () => {
  it('pairs rawHeaders with the original casing', () => {
    expect(headerPairs(['Content-Type', 'a', 'X-Thing', 'b'])).toEqual([
      ['Content-Type', 'a'],
      ['X-Thing', 'b'],
    ]);
  });

  it.each([
    'Authorization',
    'cookie',
    'Set-Cookie',
    'X-Api-Key',
    'X-Auth-Token',
    'x-session-id',
    'X-Client-Secret',
    'api_key',
  ])('masks %s', (name) => {
    expect(isMasked(name)).toBe(true);
  });

  it.each(['Content-Type', 'Accept', 'X-Request-Id', 'User-Agent'])('shows %s', (name) => {
    expect(isMasked(name)).toBe(false);
  });

  it('masks secret values in the side view', () => {
    const view = sideView(
      side(
        [
          ['Authorization', 'Bearer s3cr3t'],
          ['Accept', '*/*'],
        ],
        '',
      ),
    );
    expect(view.headers).toEqual([
      { name: 'Authorization', value: MASK, masked: true },
      { name: 'Accept', value: '*/*', masked: false },
    ]);
    expect(JSON.stringify(view)).not.toContain('s3cr3t');
  });
});

describe('bodyView', () => {
  it('shows JSON and text, and nothing for an empty body', () => {
    expect(bodyView(side([['Content-Type', 'application/json']], '{"a":1}'))).toEqual({
      kind: 'text',
      text: '{"a":1}',
      truncated: false,
      contentType: 'application/json',
    });
    expect(bodyView(side([], 'plain'))).toMatchObject({ kind: 'text', text: 'plain' });
    expect(bodyView(side([], ''))).toEqual({ kind: 'none' });
  });

  it('decodes gzip and br for display', () => {
    const json = '{"compressed":true}';
    expect(
      bodyView(
        side(
          [
            ['Content-Type', 'application/json'],
            ['Content-Encoding', 'gzip'],
          ],
          gzipSync(json),
        ),
      ),
    ).toMatchObject({ kind: 'text', text: json });
    expect(
      bodyView(
        side(
          [
            ['Content-Type', 'text/plain'],
            ['Content-Encoding', 'br'],
          ],
          brotliCompressSync(json),
        ),
      ),
    ).toMatchObject({ kind: 'text', text: json });
  });

  it('calls images, invalid UTF-8 and cut-off compressed bodies binary', () => {
    expect(bodyView(side([['Content-Type', 'image/png']], Buffer.from([0x89, 0x50])))).toEqual({
      kind: 'binary',
      bytes: 2,
      truncated: false,
    });
    expect(
      bodyView(side([['Content-Type', 'text/plain']], Buffer.from([0xff, 0xfe, 0xfd]))),
    ).toMatchObject({ kind: 'binary' });
    expect(
      bodyView(side([['Content-Encoding', 'gzip']], gzipSync('x').subarray(0, 5), 1000)),
    ).toEqual({ kind: 'binary', bytes: 1000, truncated: true });
  });

  it('marks a truncated text body', () => {
    expect(bodyView(side([['Content-Type', 'text/plain']], 'abc', 10))).toMatchObject({
      kind: 'text',
      text: 'abc',
      truncated: true,
    });
  });
});

describe('EntryRing', () => {
  it('keeps the newest entries', () => {
    const ring = new EntryRing(2);
    for (const id of ['a', 'b', 'c']) ring.add({ id } as Entry);
    expect(ring.newestFirst().map((e) => e.id)).toEqual(['c', 'b']);
    expect(ring.get('a')).toBeUndefined();
    ring.clear();
    expect(ring.size).toBe(0);
  });
});
