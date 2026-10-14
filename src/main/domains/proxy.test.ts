import { createServer, request, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../logger';
import { createDomainsProxy, type DomainsProxy } from './proxy';
import { buildRoutes, type RouteTable } from './router';

const servers: Server[] = [];
let proxy: DomainsProxy | null = null;
afterEach(async () => {
  await proxy?.stop();
  proxy = null;
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

async function echoTarget(): Promise<number> {
  const s = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ url: req.url, headers: req.headers }));
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return (s.address() as AddressInfo).port;
}

function tableFor(port: number | null): RouteTable {
  return buildRoutes({
    projects: [{ id: 'r1', name: 'shop', workspaces: [] }],
    overrides: {},
    rewriteHost: {},
    mainScripts: new Map(),
    processes:
      port === null
        ? []
        : [{ projectId: 'r1', script: 'dev', state: 'running', startedAt: 1 } as never],
    ports:
      port === null
        ? []
        : [
            {
              port,
              pid: 1,
              addresses: ['127.0.0.1'],
              processName: 'node',
              command: null,
              owner: { projectId: 'r1', script: 'dev' },
            },
          ],
    detectedPorts: new Map(),
    ownPorts: [],
  });
}

function get(
  port: number,
  host: string,
  path = '/x?y=1',
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('domains proxy over HTTP', () => {
  it('forwards to the route with X-Forwarded-* and the Host kept', async () => {
    const target = await echoTarget();
    let table = tableFor(target);
    proxy = createDomainsProxy({
      table: () => table,
      logger: createMemoryLogger(),
      hosts: ['127.0.0.1'],
    });
    const httpPort = await freePort();
    const state = await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
    expect(state.http).toMatchObject({ state: 'running', port: httpPort });
    const res = await get(httpPort, 'shop.localhost');
    expect(res.status).toBe(200);
    const seen = JSON.parse(res.body) as { url: string; headers: Record<string, string> };
    expect(seen.url).toBe('/x?y=1');
    expect(seen.headers).toMatchObject({
      host: 'shop.localhost',
      'x-forwarded-host': 'shop.localhost',
      'x-forwarded-proto': 'http',
    });
    // The table is read per request: a stopped script answers the not-running page at once.
    table = tableFor(null);
    expect((await get(httpPort, 'shop.localhost')).status).toBe(503);
  });

  it('answers 403, 404 and 502 pages without echoing the request', async () => {
    const dead = await freePort();
    proxy = createDomainsProxy({
      table: () => tableFor(dead),
      logger: createMemoryLogger(),
      hosts: ['127.0.0.1'],
    });
    const httpPort = await freePort();
    await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
    expect((await get(httpPort, 'example.com')).status).toBe(403);
    const unknown = await get(httpPort, 'nope.localhost', '/secret-path');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toContain('shop.localhost');
    expect(unknown.body).not.toContain('secret-path');
    expect((await get(httpPort, 'shop.localhost')).status).toBe(502);
  });

  it('reports a taken port as failed and keeps the other server', async () => {
    const taken = createServer();
    servers.push(taken);
    await new Promise<void>((r) => taken.listen(0, '127.0.0.1', r));
    const takenPort = (taken.address() as AddressInfo).port;
    proxy = createDomainsProxy({
      table: () => tableFor(null),
      logger: createMemoryLogger(),
      hosts: ['127.0.0.1'],
    });
    const state = await proxy.start({
      httpPort: takenPort,
      httpsPort: await freePort(),
      sni: null,
    });
    expect(state.http).toEqual({
      state: 'failed',
      port: takenPort,
      code: 'EADDRINUSE',
      owner: null,
    });
  });

  it('stops, and starts again on new ports (Review Focus 3)', async () => {
    proxy = createDomainsProxy({
      table: () => tableFor(null),
      logger: createMemoryLogger(),
      hosts: ['127.0.0.1'],
    });
    const first = await freePort();
    await proxy.start({ httpPort: first, httpsPort: await freePort(), sni: null });
    const second = await freePort();
    await proxy.stop();
    const state = await proxy.start({ httpPort: second, httpsPort: await freePort(), sni: null });
    expect(state.http).toMatchObject({ state: 'running', port: second });
    await expect(get(first, 'shop.localhost')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('ends the client response when the target dies mid-body', async () => {
    const s = createServer((req, res) => {
      res.writeHead(200, { 'content-length': '100' });
      res.write('part');
      setTimeout(() => req.socket.destroy(), 20);
    });
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const target = (s.address() as AddressInfo).port;
    proxy = createDomainsProxy({
      table: () => tableFor(target),
      logger: createMemoryLogger(),
      hosts: ['127.0.0.1'],
    });
    const httpPort = await freePort();
    await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
    const outcome = await new Promise<string>((resolve) => {
      const req = request(
        { host: '127.0.0.1', port: httpPort, path: '/', headers: { host: 'shop.localhost' } },
        (res) => {
          res.on('data', () => {});
          res.on('error', () => resolve('error'));
          res.on('close', () => resolve('close'));
        },
      );
      req.on('error', () => resolve('error'));
      req.end();
    });
    expect(['error', 'close']).toContain(outcome);
  });

  it('destroys the upstream request when the client aborts mid-stream', async () => {
    let closed: () => void = () => {};
    const upstreamClosed = new Promise<void>((r) => (closed = r));
    const s = createServer((req, res) => {
      req.on('close', () => closed());
      res.writeHead(200);
      res.write('tick');
    });
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const target = (s.address() as AddressInfo).port;
    proxy = createDomainsProxy({
      table: () => tableFor(target),
      logger: createMemoryLogger(),
      hosts: ['127.0.0.1'],
    });
    const httpPort = await freePort();
    await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
    await new Promise<void>((resolve) => {
      const req = request(
        { host: '127.0.0.1', port: httpPort, path: '/', headers: { host: 'shop.localhost' } },
        (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
          res.on('error', () => {});
        },
      );
      req.on('error', () => {});
      req.end();
    });
    await upstreamClosed;
  });

  it('fails a port whose ::1 side cannot bind for a reason other than missing IPv6', async () => {
    const taken = createServer();
    servers.push(taken);
    const listening = await new Promise<boolean>((resolve) => {
      taken.once('error', () => resolve(false));
      taken.listen(0, '::1', () => resolve(true));
    });
    if (!listening) return; // no IPv6 loopback here: nothing to conflict with
    const port = (taken.address() as AddressInfo).port;
    proxy = createDomainsProxy({
      table: () => tableFor(null),
      logger: createMemoryLogger(),
      hosts: ['127.0.0.1', '::1'],
    });
    const state = await proxy.start({ httpPort: port, httpsPort: await freePort(), sni: null });
    expect(state.http).toMatchObject({ state: 'failed', port, code: 'EADDRINUSE' });
    await expect(get(port, 'shop.localhost')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});

/** A raw upgrade: the target answers 101 and echoes what it gets afterwards. */
async function upgradeTarget(behaviour: 'echo' | 'close'): Promise<number> {
  const s = createServer();
  s.on('upgrade', (_req, socket: Socket) => {
    if (behaviour === 'close') return socket.destroy();
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
    );
    socket.on('data', (d) => socket.write(d));
    socket.on('end', () => socket.end());
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return (s.address() as AddressInfo).port;
}

function rawUpgrade(port: number, host: string): Promise<{ head: string; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        `GET /hmr HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
    });
    socket.once('data', (d) => resolve({ head: d.toString(), socket }));
    socket.on('error', reject);
  });
}

async function startProxy(port: number | null): Promise<number> {
  proxy = createDomainsProxy({
    table: () => tableFor(port),
    logger: createMemoryLogger(),
    hosts: ['127.0.0.1'],
  });
  const httpPort = await freePort();
  await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
  return httpPort;
}

describe('domains proxy upgrades', () => {
  it('pipes a WebSocket upgrade both ways', async () => {
    const httpPort = await startProxy(await upgradeTarget('echo'));
    const { head, socket } = await rawUpgrade(httpPort, 'shop.localhost');
    expect(head).toContain('101 Switching Protocols');
    const echoed = new Promise<string>((r) => socket.once('data', (d) => r(d.toString())));
    socket.write('ping');
    expect(await echoed).toBe('ping');
    socket.destroy();
  });

  it('closes the client when the target drops the upgrade', async () => {
    const httpPort = await startProxy(await upgradeTarget('close'));
    const socket = connect(httpPort, '127.0.0.1', () =>
      socket.write(
        'GET / HTTP/1.1\r\nHost: shop.localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
      ),
    );
    await new Promise<void>((r) => socket.on('close', () => r()));
  });

  it('refuses an upgrade for a foreign Host', async () => {
    const httpPort = await startProxy(null);
    const { head } = await rawUpgrade(httpPort, 'example.com');
    expect(head).toMatch(/^HTTP\/1\.1 403/);
  });

  it('answers 503 for a project that is not running', async () => {
    const httpPort = await startProxy(null);
    const { head } = await rawUpgrade(httpPort, 'shop.localhost');
    expect(head).toMatch(/^HTTP\/1\.1 503/);
  });

  it('destroys tunnelled sockets on stop', async () => {
    const httpPort = await startProxy(await upgradeTarget('echo'));
    const { socket } = await rawUpgrade(httpPort, 'shop.localhost');
    const closed = new Promise<void>((r) => socket.on('close', () => r()));
    await proxy?.stop();
    await closed;
  });
});
