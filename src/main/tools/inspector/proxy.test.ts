import { createServer, type IncomingMessage, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_REQUEST_BYTES } from '@shared/tools/inspector/contract';
import { createProxyHandler, outboundUrl, sendRequest } from './proxy';
import { bodyView, type Entry, headerOf } from './record';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function listen(
  handler: (req: IncomingMessage, res: import('node:http').ServerResponse) => void,
): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

/** An API that echoes what it got. */
async function echoApi() {
  const seen: {
    method?: string;
    url?: string;
    headers: IncomingMessage['headers'];
    body: string;
  }[] = [];
  const port = await listen((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === '/gzip') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Set-Cookie': 'sid=abc',
        });
        res.end(gzipSync('{"zipped":true}'));
        return;
      }
      if (req.url === '/slow') return; // never answers
      res.writeHead(201, {
        'Content-Type': 'application/json',
        'X-Api': 'yes',
        Connection: 'keep-alive',
      });
      res.end(JSON.stringify({ method: req.method, url: req.url, body }));
    });
  });
  return { port, seen };
}

async function inspector(target: string | null, opts: { headersTimeoutMs?: number } = {}) {
  const entries: Entry[] = [];
  const port = await listen(
    createProxyHandler({
      target: () => (target ? new URL(target) : null),
      onEntry: (e) => entries.push(e),
      ...opts,
    }),
  );
  return { port, entries };
}

function call(
  port: number,
  opts: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  } = {},
) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: string }>(
    (resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          method: opts.method ?? 'GET',
          path: opts.path ?? '/',
          headers: { host: `localhost:${port}`, ...opts.headers },
        },
        (res) => {
          let body = '';
          res.setEncoding('latin1');
          res.on('data', (c: string) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.on('error', reject);
      req.end(opts.body);
    },
  );
}

describe('outboundUrl', () => {
  it('joins the base path with the path and query', () => {
    expect(outboundUrl(new URL('http://localhost:3000/api/'), '/users?x=1').href).toBe(
      'http://localhost:3000/api/users?x=1',
    );
    expect(outboundUrl(new URL('http://localhost:3000'), '/').href).toBe('http://localhost:3000/');
  });
});

describe('proxy handler', () => {
  it('forwards method, path, query, headers and body, and records both sides', async () => {
    const api = await echoApi();
    const { port, entries } = await inspector(`http://localhost:${api.port}/v1`);
    const reply = await call(port, {
      method: 'POST',
      path: '/users?x=1',
      headers: {
        authorization: 'Bearer s3cr3t',
        'content-type': 'application/json',
        connection: 'keep-alive',
      },
      body: '{"name":"Ada"}',
    });
    expect(reply.status).toBe(201);
    expect(JSON.parse(reply.body)).toEqual({
      method: 'POST',
      url: '/v1/users?x=1',
      body: '{"name":"Ada"}',
    });
    expect(reply.headers['x-api']).toBe('yes');

    const got = api.seen[0];
    expect(got?.headers.authorization).toBe('Bearer s3cr3t');
    expect(got?.headers.host).toBe(`localhost:${api.port}`);
    expect(got?.headers['x-forwarded-host']).toBe(`localhost:${port}`);
    expect(got?.headers['x-forwarded-proto']).toBe('http');

    await expect.poll(() => entries.length).toBe(1);
    const entry = entries[0] as Entry;
    expect(entry).toMatchObject({
      method: 'POST',
      path: '/users?x=1',
      error: null,
      replayOf: null,
    });
    expect(entry.response?.status).toBe(201);
    expect(headerOf(entry.request.headers, 'Authorization')).toBe('Bearer s3cr3t');
    expect(entry.request.body.toString()).toBe('{"name":"Ada"}');
    expect(bodyView(entry.response as NonNullable<Entry['response']>)).toMatchObject({
      kind: 'text',
      text: expect.stringContaining('"method":"POST"'),
    });
  });

  it('passes a compressed response through untouched and records it decodable', async () => {
    const api = await echoApi();
    const { port, entries } = await inspector(`http://127.0.0.1:${api.port}`);
    const reply = await call(port, { path: '/gzip' });
    expect(reply.headers['content-encoding']).toBe('gzip');
    await expect.poll(() => entries.length).toBe(1);
    expect(bodyView(entries[0]?.response as NonNullable<Entry['response']>)).toMatchObject({
      kind: 'text',
      text: '{"zipped":true}',
    });
  });

  it('answers 502 when the API is down, 504 when it is slow, and records both', async () => {
    const dead = await listen(() => undefined);
    await new Promise<void>((r) => servers.pop()?.close(() => r()));
    const down = await inspector(`http://127.0.0.1:${dead}`);
    const reply = await call(down.port, { path: '/x' });
    expect(reply.status).toBe(502);
    expect(JSON.parse(reply.body)).toEqual({ error: 'API unreachable', code: 'ECONNREFUSED' });
    await expect.poll(() => down.entries[0]?.error).toBe('ECONNREFUSED');

    const api = await echoApi();
    const slow = await inspector(`http://127.0.0.1:${api.port}`, { headersTimeoutMs: 100 });
    expect((await call(slow.port, { path: '/slow' })).status).toBe(504);
    await expect.poll(() => slow.entries[0]?.error).toBe('timeout');
  });

  it('refuses a non-local Host, and says when there is no API address', async () => {
    const { port, entries } = await inspector(null);
    expect((await call(port, { headers: { host: 'evil.example' } })).status).toBe(403);
    const none = await call(port);
    expect(none.status).toBe(502);
    expect(none.body).toContain('No API address');
    await expect.poll(() => entries.length).toBe(1);
  });

  it('cuts off a request body over 10 MiB with 413', async () => {
    const api = await echoApi();
    const { port, entries } = await inspector(`http://127.0.0.1:${api.port}`);
    const reply = await call(port, {
      method: 'POST',
      path: '/big',
      body: Buffer.alloc(MAX_REQUEST_BYTES + 1024),
    }).catch(() => ({ status: 413, headers: {}, body: '' }));
    expect(reply.status).toBe(413);
    await expect.poll(() => entries[0]?.error).toBe('too-large');
    expect(entries[0]?.request.body.length).toBe(256 * 1024);
  });
});

describe('sendRequest', () => {
  it('sends straight to the API and records a replay entry', async () => {
    const api = await echoApi();
    const entry = await sendRequest(
      new URL(`http://localhost:${api.port}`),
      {
        method: 'PUT',
        path: '/users/1?y=2',
        headers: [
          ['Content-Type', 'text/plain'],
          ['Connection', 'close'],
        ],
        body: Buffer.from('hello'),
      },
      { replayOf: 'e1' },
    );
    expect(entry).toMatchObject({
      method: 'PUT',
      path: '/users/1?y=2',
      replayOf: 'e1',
      error: null,
    });
    expect(entry.response?.status).toBe(201);
    expect(api.seen[0]).toMatchObject({ method: 'PUT', url: '/users/1?y=2', body: 'hello' });
    expect(api.seen[0]?.headers['content-length']).toBe('5');
  });

  it('records a refused connection', async () => {
    const dead = await listen(() => undefined);
    await new Promise<void>((r) => servers.pop()?.close(() => r()));
    const entry = await sendRequest(
      new URL(`http://127.0.0.1:${dead}`),
      { method: 'GET', path: '/', headers: [], body: Buffer.alloc(0) },
      { replayOf: 'e1' },
    );
    expect(entry).toMatchObject({ response: null, error: 'ECONNREFUSED' });
  });
});
