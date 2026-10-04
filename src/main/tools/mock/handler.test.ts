import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PackageMock, PackageMockSchema, RouteSchema } from '@shared/tools/mock/contract';
import { createMockHandler, MAX_REQUEST_BYTES } from './handler';

let server: Server | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

const route = (patch: Record<string, unknown>) =>
  RouteSchema.parse({ id: 'r1', method: 'GET', path: '/users/:id', ...patch });

async function serve(config: Partial<PackageMock>) {
  const lines: string[] = [];
  let current: PackageMock = PackageMockSchema.parse(config);
  const onRequest = vi.fn();
  server = createServer(
    createMockHandler({ config: () => current, log: (_s, text) => lines.push(text), onRequest }),
  );
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const set = (next: Partial<PackageMock>) => {
    current = PackageMockSchema.parse({ ...current, ...next });
  };
  return { port, lines, set, onRequest };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function call(
  port: number,
  opts: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
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
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe('mock handler', () => {
  it('answers a matched route with its status, headers and rendered body', async () => {
    const { port, lines, onRequest } = await serve({
      routes: [
        route({
          status: 201,
          headers: [{ name: 'X-Custom', value: 'yes' }],
          body: '{"id":"{{params.id}}","q":"{{query.q}}"}',
        }),
      ],
    });
    const reply = await call(port, { path: '/users/42?q=hi&token=s3cr3t' });
    expect(reply.status).toBe(201);
    expect(JSON.parse(reply.body)).toEqual({ id: '42', q: 'hi' });
    expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(reply.headers['x-custom']).toBe('yes');
    expect(reply.headers['x-nestbox-mock']).toBe('r1');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(lines).toEqual([
      expect.stringMatching(/^GET \/users\/42 → 201 · \d+ ms · GET \/users\/:id$/),
    ]);
    expect(lines.join()).not.toMatch(/s3cr3t|token/);
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for an unmatched path, and HEAD without a body', async () => {
    const { port, lines } = await serve({ routes: [route({ body: '{"a":1}' })] });
    const miss = await call(port, { path: '/nope?x=1' });
    expect(miss.status).toBe(404);
    expect(JSON.parse(miss.body)).toEqual({ error: 'No mock route', method: 'GET', path: '/nope' });
    expect(miss.headers['x-nestbox-mock']).toBe('none');
    const head = await call(port, { method: 'HEAD', path: '/users/1' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(lines[0]).toMatch(/→ 404 · \d+ ms · no route$/);
  });

  it('refuses a request whose Host is not local', async () => {
    const { port } = await serve({ routes: [route({})] });
    expect(
      (await call(port, { path: '/users/1', headers: { host: 'evil.example:4010' } })).status,
    ).toBe(403);
    expect((await call(port, { path: '/users/1', headers: { host: '127.0.0.1' } })).status).toBe(
      200,
    );
    expect((await call(port, { path: '/users/1', headers: { host: '[::1]:9' } })).status).toBe(200);
  });

  it('sends CORS headers and answers preflights', async () => {
    const { port } = await serve({ routes: [route({})] });
    const plain = await call(port, { path: '/users/1' });
    expect(plain.headers['access-control-allow-origin']).toBe('*');
    const fromApp = await call(port, {
      path: '/users/1',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(fromApp.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(fromApp.headers['access-control-allow-credentials']).toBe('true');
    const preflight = await call(port, {
      method: 'OPTIONS',
      path: '/users/1',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-headers']).toBe('authorization, content-type');
    expect(preflight.headers['access-control-allow-methods']).toContain('PUT');
  });

  it('fails a route or everything when switched on, and applies edits at once', async () => {
    const { port, set, lines } = await serve({
      routes: [route({ fail: { on: true, status: 503 } })],
    });
    const failed = await call(port, { path: '/users/1' });
    expect(failed.status).toBe(503);
    expect(JSON.parse(failed.body)).toEqual({ error: 'Mocked failure' });
    expect(lines[0]).toMatch(/→ 503 · \d+ ms · GET \/users\/:id · failed$/);
    set({ routes: [route({})], failAll: { on: true, status: 500 } });
    expect((await call(port, { path: '/users/1' })).status).toBe(500);
    expect((await call(port, { path: '/unmatched' })).status).toBe(500);
    set({ failAll: { on: false, status: 500 } });
    expect((await call(port, { path: '/users/1' })).status).toBe(200);
  });

  it('waits the global delay plus the route delay', async () => {
    const { port } = await serve({ routes: [route({ delayMs: 150 })], delayMs: 100 });
    const t0 = Date.now();
    await call(port, { path: '/users/1' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240);
  });

  it('reads and drops a request body, and answers 413 past 1 MiB', async () => {
    const { port } = await serve({ routes: [route({ method: 'POST', path: '/users' })] });
    expect(
      (await call(port, { method: 'POST', path: '/users', body: '{"password":"x"}' })).status,
    ).toBe(200);
    const big = await call(port, {
      method: 'POST',
      path: '/users',
      body: Buffer.alloc(MAX_REQUEST_BYTES + 10),
    }).catch(() => ({ status: 413 }) as Reply);
    expect(big.status).toBe(413);
  });
});
