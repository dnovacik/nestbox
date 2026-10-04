import { describe, expect, it } from 'vitest';
import { buildCurl, shellQuote } from './curl';
import type { Entry } from './record';

const entry = (patch: Partial<Entry> & { body?: string | Buffer; bytes?: number } = {}): Entry => {
  const body =
    patch.body === undefined
      ? Buffer.alloc(0)
      : Buffer.isBuffer(patch.body)
        ? patch.body
        : Buffer.from(patch.body);
  return {
    id: 'e1',
    at: 0,
    method: 'POST',
    path: '/users?x=1',
    request: {
      headers: [
        ['Host', 'localhost:4020'],
        ['Content-Type', 'application/json'],
        ['Authorization', 'Bearer a$b'],
        ['Content-Length', '9'],
      ],
      body,
      bytes: patch.bytes ?? body.length,
    },
    response: null,
    ms: 1,
    replayOf: null,
    error: null,
    ...patch,
  };
};

describe('shellQuote', () => {
  it('survives quotes, $ and newlines', () => {
    expect(shellQuote(`it's $HOME\nnext`)).toBe(`'it'\\''s $HOME\nnext'`);
  });
});

describe('buildCurl', () => {
  it('builds the command against the target, with headers and the body', () => {
    expect(buildCurl(entry({ body: `{"n":"O'Neil"}` }), new URL('http://localhost:3000/api'))).toBe(
      `curl -X POST 'http://localhost:3000/api/users?x=1' -H 'Content-Type: application/json' -H 'Authorization: Bearer a$b' --data-binary '{"n":"O'\\''Neil"}'`,
    );
  });

  it('leaves out the body when there is none', () => {
    expect(buildCurl(entry({ method: 'GET' }), new URL('http://localhost:3000'))).not.toContain(
      '--data-binary',
    );
  });

  it('refuses binary and truncated bodies', () => {
    expect(() =>
      buildCurl(entry({ body: Buffer.from([0xff, 0xfe]) }), new URL('http://localhost:3000')),
    ).toThrow(/binary/);
    expect(() =>
      buildCurl(entry({ body: 'abc', bytes: 10_000_000 }), new URL('http://localhost:3000')),
    ).toThrow(/too large/);
  });
});
