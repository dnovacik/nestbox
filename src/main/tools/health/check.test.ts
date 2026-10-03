import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { checkUrl } from './check';

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const a = server?.address();
      resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
    });
  });
}

describe('checkUrl', () => {
  it('is ok for 2xx and 3xx, without following the redirect', async () => {
    let hits = 0;
    const base = await serve((req, res) => {
      hits++;
      if (req.url === '/moved') res.writeHead(302, { location: '/elsewhere' }).end();
      else res.writeHead(200).end('fine');
    });
    expect(await checkUrl(`${base}/`, {})).toMatchObject({ state: 'ok', status: 200, reason: null });
    expect(await checkUrl(`${base}/moved`, {})).toMatchObject({ state: 'ok', status: 302 });
    expect(hits).toBe(2);
  });

  it('fails on other statuses, unless that status is expected', async () => {
    const base = await serve((req, res) => res.writeHead(req.url === '/auth' ? 401 : 500).end());
    expect(await checkUrl(`${base}/`, {})).toMatchObject({ state: 'fail', status: 500, reason: 'status 500' });
    expect(await checkUrl(`${base}/auth`, { expect: 401 })).toMatchObject({ state: 'ok', status: 401 });
    expect(await checkUrl(`${base}/`, { expect: 401 })).toMatchObject({ state: 'fail', reason: 'status 500' });
  });

  it("doesn't wait for the body", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200);
      res.write('start');
      // Never ends.
    });
    const started = Date.now();
    expect(await checkUrl(`${base}/`, { timeoutMs: 2_000 })).toMatchObject({ state: 'ok' });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it('times out on a server that never answers', async () => {
    const base = await serve(() => undefined);
    expect(await checkUrl(`${base}/`, { timeoutMs: 100 })).toMatchObject({ state: 'fail', status: null, reason: 'timeout' });
  });

  it('reports a refused connection by its code', async () => {
    const base = await serve((_req, res) => res.end());
    await new Promise<void>((r) => server?.close(() => r()));
    server = null;
    expect(await checkUrl(`${base}/`, {})).toMatchObject({ state: 'fail', reason: 'ECONNREFUSED' });
  });

  it('measures the time to the headers', async () => {
    const base = await serve((_req, res) => setTimeout(() => res.writeHead(204).end(), 30));
    const out = await checkUrl(`${base}/`, {});
    expect(out.ms).toBeGreaterThanOrEqual(25);
  });
});
