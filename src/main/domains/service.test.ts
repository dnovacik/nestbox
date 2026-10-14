import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect as tlsConnect } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainsSettingsSchema, type DomainsSettings } from '@shared/domains';
import { createMemoryLogger } from '../logger';
import { createLocalCa, type LocalCa } from './ca';
import { createDomainsService, type DomainsProject, type DomainsService } from './service';

let service: DomainsService | null = null;
afterEach(async () => {
  await service?.stop();
  service = null;
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

type TrustFn = (file: string) => Promise<'trusted' | 'cancelled' | 'failed'>;
type UntrustFn = () => Promise<'removed' | 'failed'>;

async function setup(
  over: Partial<DomainsSettings> = {},
  opts: { projects?: DomainsProject[]; wrapCa?: (ca: LocalCa) => LocalCa } = {},
) {
  let settings: DomainsSettings = {
    ...DomainsSettingsSchema.parse({}),
    httpPort: await freePort(),
    httpsPort: await freePort(),
    ...over,
  };
  const trust = vi.fn<TrustFn>(async () => 'trusted');
  const untrust = vi.fn<UntrustFn>(async () => 'removed');
  const confirm = vi.fn(async (_kind: 'trust' | 'remove') => true);
  const emit = vi.fn();
  const ca = createLocalCa({
    file: join(await mkdtemp(join(tmpdir(), 'nestbox-svc-')), 'ca.json'),
    now: Date.now,
    logger: createMemoryLogger(),
  });
  service = createDomainsService({
    settings: { get: () => settings, update: (fn) => void (settings = fn(settings)) },
    projects: async () =>
      opts.projects ?? [{ id: 'r1', name: 'Shop', path: '/shop', workspaces: [] }],
    mainScript: () => null,
    processes: () => [],
    ports: async () => ({ rows: [], scannedAt: 0, stale: false }),
    detectedPort: async () => 5173,
    ca: opts.wrapCa ? opts.wrapCa(ca) : ca,
    trust: { trust, untrust },
    confirm,
    emit,
    logger: createMemoryLogger(),
    hosts: ['127.0.0.1'],
  });
  return { get: () => settings, trust, untrust, confirm, emit, service };
}

/** A TLS handshake to the proxy with this SNI name: resolves 'ok' or the error. */
function handshake(port: number, servername: string): Promise<'ok' | Error> {
  return new Promise((resolve) => {
    const socket = tlsConnect(
      { host: '127.0.0.1', port, servername, rejectUnauthorized: false },
      () => {
        socket.end();
        resolve('ok');
      },
    );
    socket.on('error', (error) => resolve(error));
  });
}

describe('domains service', () => {
  it('is off by default and starts both servers when turned on', async () => {
    const s = await setup();
    expect(await s.service.status()).toMatchObject({
      enabled: false,
      http: { state: 'off' },
      https: { state: 'off' },
    });
    const on = await s.service.setEnabled(true);
    expect(on).toMatchObject({
      enabled: true,
      http: { state: 'running' },
      https: { state: 'running' },
      trust: 'none',
    });
    expect(on.routes).toEqual([
      {
        name: 'shop.localhost',
        projectId: 'r1',
        script: null,
        port: 5173,
        source: 'detected',
        rewriteHost: false,
      },
    ]);
    expect(s.get().enabled).toBe(true);
    expect(s.emit).toHaveBeenCalled();
  });

  it('trusts after the confirmation, writing the root to a temporary file', async () => {
    const s = await setup({ enabled: true });
    await s.service.start();
    expect(await s.service.trustCa()).toEqual({ result: 'trusted' });
    expect(s.confirm).toHaveBeenCalledWith('trust');
    expect(s.trust.mock.calls[0]?.[0]).toMatch(/nestbox-ca-.*\.crt$/);
    expect(s.get().trust).toBe('trusted');
    s.confirm.mockResolvedValueOnce(false);
    expect(await s.service.trustCa()).toEqual({ result: 'cancelled' });
  });

  it('removes the CA from the store and the disk', async () => {
    const s = await setup({ enabled: true, trust: 'trusted' });
    expect(await s.service.removeCa()).toEqual({ result: 'removed' });
    expect(s.untrust).toHaveBeenCalled();
    expect(s.get().trust).toBe('none');
  });

  it('moves to new ports, and validates overrides', async () => {
    const s = await setup({ enabled: true });
    await s.service.start();
    const httpPort = await freePort();
    const httpsPort = await freePort();
    expect(await s.service.setPorts({ httpPort, httpsPort })).toMatchObject({
      http: { port: httpPort, state: 'running' },
    });
    expect((await s.service.setName({ projectId: 'r1', label: 'store' })).routes[0]?.name).toBe(
      'store.localhost',
    );
    await expect(s.service.setName({ projectId: 'nope', label: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('signs only names in the route table', async () => {
    const leaf = vi.fn<LocalCa['leaf']>();
    const s = await setup(
      { enabled: true },
      {
        wrapCa: (ca) => {
          leaf.mockImplementation((host) => ca.leaf(host));
          return { ...ca, leaf };
        },
      },
    );
    await s.service.start();
    const port = s.get().httpsPort;
    expect(await handshake(port, 'nope.localhost')).toBeInstanceOf(Error);
    expect(leaf).not.toHaveBeenCalled();
    expect(await handshake(port, 'shop.localhost')).toBe('ok');
    expect(leaf).toHaveBeenCalledWith('shop.localhost');
  });

  it('answers failed when the trust or untrust command throws', async () => {
    const s = await setup({ enabled: true });
    await s.service.start();
    s.trust.mockRejectedValueOnce(
      Object.assign(new Error('spawn certutil ENOENT'), { code: 'ENOENT' }),
    );
    expect(await s.service.trustCa()).toEqual({ result: 'failed' });
    expect(s.get().trust).toBe('untrusted');
    s.untrust.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await s.service.removeCa()).toEqual({ result: 'failed' });
    expect(s.get().trust).toBe('untrusted');
  });

  it('sets trust back to none for a new root, but not on a later restart of the same root', async () => {
    const s = await setup({ enabled: true, trust: 'trusted' });
    await s.service.start();
    expect(s.get().trust).toBe('none');
    await s.service.trustCa();
    expect(s.get().trust).toBe('trusted');
    await s.service.setPorts({ httpPort: await freePort(), httpsPort: await freePort() });
    expect(s.get().trust).toBe('trusted');
  });

  it('sets and clears a name and the Host rewrite', async () => {
    const s = await setup();
    await s.service.setName({ projectId: 'r1', label: 'store' });
    expect(s.get().names).toEqual({ r1: 'store' });
    expect((await s.service.setName({ projectId: 'r1', label: null })).routes[0]?.name).toBe(
      'shop.localhost',
    );
    expect(s.get().names).toEqual({});
    expect(
      (await s.service.setRewriteHost({ projectId: 'r1', rewrite: true })).routes[0]?.rewriteHost,
    ).toBe(true);
    expect(s.get().rewriteHost).toEqual({ r1: true });
    await s.service.setRewriteHost({ projectId: 'r1', rewrite: false });
    expect(s.get().rewriteHost).toEqual({});
  });

  it('passes projects to the router in the order given', async () => {
    const s = await setup(
      {},
      {
        projects: [
          { id: 'b', name: 'Shop', path: '/b', workspaces: [] },
          { id: 'a', name: 'Shop', path: '/a', workspaces: [] },
        ],
      },
    );
    const status = await s.service.status();
    expect(status.routes.map((r) => [r.projectId, r.name])).toEqual([
      ['b', 'shop.localhost'],
      ['a', 'shop-2.localhost'],
    ]);
    expect(status.clashes).toEqual(['a']);
  });
});
