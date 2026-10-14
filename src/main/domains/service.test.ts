import { access, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect as tlsConnect } from 'node:tls';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainsSettingsSchema, type DomainsSettings } from '@shared/domains';
import { createMemoryLogger } from '../logger';
import { createLocalCa, type LocalCa } from './ca';
import type { ProjectSummary } from '@shared/detected';
import {
  createDomainsService,
  toDomainsProjects,
  type DomainsProject,
  type DomainsService,
} from './service';

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
  opts: {
    projects?: DomainsProject[];
    wrapCa?: (ca: LocalCa) => LocalCa;
    detectedPort?: () => number | null;
  } = {},
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
  const projects = vi.fn(
    async (): Promise<DomainsProject[]> =>
      opts.projects ?? [{ id: 'r1', name: 'Shop', path: '/shop', workspaces: [] }],
  );
  const caFile = join(await mkdtemp(join(tmpdir(), 'nestbox-svc-')), 'ca.json');
  const ca = createLocalCa({
    file: caFile,
    now: Date.now,
    logger: createMemoryLogger(),
  });
  service = createDomainsService({
    settings: { get: () => settings, update: (fn) => void (settings = fn(settings)) },
    projects,
    mainScript: () => null,
    processes: () => [],
    ports: async () => ({ rows: [], scannedAt: 0, stale: false }),
    detectedPort: async () => (opts.detectedPort ? opts.detectedPort() : 5173),
    ca: opts.wrapCa ? opts.wrapCa(ca) : ca,
    trust: { trust, untrust },
    confirm,
    emit,
    logger: createMemoryLogger(),
    hosts: ['127.0.0.1'],
  });
  return { get: () => settings, trust, untrust, confirm, emit, projects, service, caFile };
}

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** Resolves true when something accepts a TCP connection on the port. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
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
  it('does no rebuild work on refresh() while off, but status() still builds', async () => {
    let detected = 5173;
    const s = await setup({}, { detectedPort: () => detected });
    expect((await s.service.status()).routes.map((r) => r.port)).toEqual([5173]);
    s.projects.mockClear();
    detected = 3000;
    s.service.refresh();
    s.service.refresh();
    await new Promise((r) => setTimeout(r, 400));
    expect(s.projects).not.toHaveBeenCalled();
    // The change still shows the next time the status is asked for.
    expect((await s.service.status()).routes.map((r) => r.port)).toEqual([3000]);
    expect(s.projects).toHaveBeenCalledTimes(1);
    expect((await s.service.status()).routes.map((r) => r.port)).toEqual([3000]);
    expect(s.projects).toHaveBeenCalledTimes(1);
  });

  it('emits domains:changed only when the routes or clashes change', async () => {
    let detected = 5173;
    const s = await setup({ enabled: true }, { detectedPort: () => detected });
    await s.service.start();
    s.emit.mockClear();
    s.service.refresh();
    await new Promise((r) => setTimeout(r, 400));
    expect(s.projects).toHaveBeenCalledTimes(2);
    expect(s.emit).not.toHaveBeenCalled();
    detected = 3000;
    s.service.refresh();
    await new Promise((r) => setTimeout(r, 400));
    expect(s.emit).toHaveBeenCalledTimes(1);
    s.service.refresh();
    await new Promise((r) => setTimeout(r, 400));
    expect(s.emit).toHaveBeenCalledTimes(1);
  });

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

  it('removes a trusted CA from the store and the disk', async () => {
    const s = await setup();
    expect(await s.service.trustCa()).toEqual({ result: 'trusted' });
    expect(await exists(s.caFile)).toBe(true);
    expect(await s.service.removeCa()).toEqual({ result: 'removed' });
    expect(s.untrust).toHaveBeenCalledWith(
      expect.objectContaining({ sha1: expect.any(String), serialHex: expect.any(String) }),
    );
    expect(s.get().trust).toBe('none');
    expect(await exists(s.caFile)).toBe(false);
  });

  it('removes an untrusted CA even when the untrust command fails', async () => {
    const s = await setup();
    s.trust.mockResolvedValueOnce('cancelled');
    expect(await s.service.trustCa()).toEqual({ result: 'cancelled' });
    expect(s.get().trust).toBe('untrusted');
    s.untrust.mockResolvedValue('failed');
    expect(await s.service.removeCa()).toEqual({ result: 'removed' });
    expect(s.get().trust).toBe('none');
    expect(await exists(s.caFile)).toBe(false);
  });

  it('does not untrust a root made after the trusted one was lost', async () => {
    const s = await setup({ trust: 'trusted' });
    s.untrust.mockResolvedValue('failed');
    expect(await s.service.removeCa()).toEqual({ result: 'removed' });
    expect(s.untrust).not.toHaveBeenCalled();
    expect(s.get().trust).toBe('none');
  });

  it('keeps a removed trusted root failed when the untrust command fails', async () => {
    const s = await setup();
    await s.service.trustCa();
    s.untrust.mockResolvedValue('failed');
    expect(await s.service.removeCa()).toEqual({ result: 'failed' });
    expect(s.get().trust).toBe('trusted');
    expect(await exists(s.caFile)).toBe(true);
  });

  it('ends off when turned on and off without waiting', async () => {
    const s = await setup();
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    try {
      const on = s.service.setEnabled(true);
      const off = s.service.setEnabled(false);
      await Promise.all([on, off]);
      expect(await listening(s.get().httpPort)).toBe(false);
      expect(await listening(s.get().httpsPort)).toBe(false);
      expect(setInterval).not.toHaveBeenCalled();
      expect(await s.service.status()).toMatchObject({
        enabled: false,
        http: { state: 'off' },
        https: { state: 'off' },
      });
    } finally {
      setInterval.mockRestore();
    }
  });

  it('stop() wins over a start in flight', async () => {
    const s = await setup({ enabled: true });
    const started = s.service.start();
    await s.service.stop();
    await started;
    expect(await listening(s.get().httpPort)).toBe(false);
    expect(await listening(s.get().httpsPort)).toBe(false);
  });

  it('serialises two starts, ending on the latest ports', async () => {
    const s = await setup({ enabled: true });
    const httpPort = await freePort();
    const httpsPort = await freePort();
    const [, moved] = await Promise.all([
      s.service.start(),
      s.service.setPorts({ httpPort, httpsPort }),
    ]);
    expect(moved).toMatchObject({
      http: { state: 'running', port: httpPort },
      https: { state: 'running', port: httpsPort },
    });
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
    expect(await s.service.trustCa()).toEqual({ result: 'trusted' });
    s.untrust.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await s.service.removeCa()).toEqual({ result: 'failed' });
    expect(s.get().trust).toBe('trusted');
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

  it('keeps workspace overrides of a project that lists no workspaces, drops removed roots', async () => {
    const s = await setup({
      names: { 'r1::packages/api': 'backend', gone: 'old', 'gone::web': 'site' },
      rewriteHost: { 'r1::packages/api': true, gone: true },
    });
    await s.service.status();
    expect(s.get().names).toEqual({ 'r1::packages/api': 'backend' });
    expect(s.get().rewriteHost).toEqual({ 'r1::packages/api': true });
  });

  it('names workspaces as the sidebar does, aliases included', () => {
    const summary = {
      id: 'r1',
      name: 'Shop',
      path: '/shop',
      detected: {
        workspaces: [
          {
            id: 'r1::packages/api',
            name: 'Backend',
            relPath: 'packages/api',
            path: '/shop/packages/api',
          },
        ],
      },
    } as unknown as ProjectSummary;
    expect(toDomainsProjects([summary])).toEqual([
      {
        id: 'r1',
        name: 'Shop',
        path: '/shop',
        workspaces: [
          {
            id: 'r1::packages/api',
            name: 'Backend',
            relPath: 'packages/api',
            path: '/shop/packages/api',
          },
        ],
      },
    ]);
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
