import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaticHandler, isHiddenPath, type RequestLog } from './handler';

let dir = '';
let server: Server | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nestbox-static-'));
  await mkdir(join(dir, 'assets'));
  await mkdir(join(dir, '.git'));
  await writeFile(join(dir, 'index.html'), '<h1>app</h1>');
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(join(dir, '.env'), 'SECRET=hunter2');
  await writeFile(join(dir, '.git', 'config'), '[core]');
});
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
  await rm(dir, { recursive: true, force: true });
});

async function serve(opts: Partial<Parameters<typeof createStaticHandler>[0]> = {}) {
  const logs: RequestLog[] = [];
  const handler = createStaticHandler({
    folder: dir,
    spa: true,
    cors: false,
    noCache: false,
    latencyMs: 0,
    onRequest: (entry) => logs.push(entry),
    ...opts,
  });
  server = createServer(handler);
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, logs };
}

describe('static handler', () => {
  it('serves files with ETags and logs each request without the query string', async () => {
    const { base, logs } = await serve();
    const res = await fetch(`${base}/assets/app.js?token=abc`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1)');
    expect(res.headers.get('etag')).toBeTruthy();
    await vi.waitFor(() => expect(logs).toHaveLength(1));
    expect(logs).toEqual([expect.objectContaining({ method: 'GET', path: '/assets/app.js', status: 200 })]);
    expect(JSON.stringify(logs)).not.toContain('token');
  });

  it('falls back to index.html for unknown routes when SPA is on, 404 when off', async () => {
    const spa = await serve();
    expect(await (await fetch(`${spa.base}/deep/route`)).text()).toBe('<h1>app</h1>');
    await new Promise<void>((r) => server?.close(() => r()));
    const plain = await serve({ spa: false });
    expect((await fetch(`${plain.base}/deep/route`)).status).toBe(404);
  });

  it.each(['/.env', '/.git/config', '/%2eenv', '/assets/../.env'])('never serves dotfiles: %s', async (path) => {
    const { base } = await serve({ spa: false });
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('hunter2');
  });

  it.each(['/.env', '/%2Eenv', '/a/%2e%2e/.env', '/assets/..%5C.env', '/%E0%A4%A', '/ENV~1', '/GIT~1/config', '/env%7E1'])(
    'flags hidden or broken paths: %s',
    (path) => {
      expect(isHiddenPath(path)).toBe(true);
    },
  );

  it.each(['/', '/index.html', '/assets/app.js', '/docs/v2~beta/', '/a.b/c'])('lets ordinary paths through: %s', (path) => {
    expect(isHiddenPath(path)).toBe(false);
  });

  it('never falls back to index.html for a dotfile either', async () => {
    const { base } = await serve();
    expect(await (await fetch(`${base}/.env`)).text()).not.toContain('hunter2');
  });

  it('adds CORS headers and answers preflight', async () => {
    const { base } = await serve({ cors: true });
    const res = await fetch(`${base}/index.html`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const pre = await fetch(`${base}/index.html`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('adds Cache-Control: no-store with no-cache', async () => {
    const { base } = await serve({ noCache: true });
    expect((await fetch(`${base}/index.html`)).headers.get('cache-control')).toBe('no-store');
  });

  it('delays responses by the latency', async () => {
    const { base, logs } = await serve({ latencyMs: 150 });
    const started = Date.now();
    await (await fetch(`${base}/index.html`)).text();
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    await vi.waitFor(() => expect(logs[0]?.ms).toBeGreaterThanOrEqual(140));
  });
});
