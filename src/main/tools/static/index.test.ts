import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { makeDetectedForTest } from '@shared/test-fixtures';
import { ServerConfigSchema, type ServerStatus, staticDefinition, type StaticSettings } from '@shared/tools/static/contract';
import type { LogSnapshot } from '@shared/processes';
import { createMemoryLogger } from '../../logger';
import { createWin32Adapter } from '../../platform/win32';
import { noopRunner } from '../../platform/testing';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createStaticTool } from './index';

let root = '';
const blockers: Server[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nestbox-static-tool-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'index.html'), '<h1>built</h1>');
  await writeFile(join(root, 'index.html'), '<h1>root</h1>');
});

let tool: AnyMainTool | null = null;
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
  await Promise.all(blockers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  await rm(root, { recursive: true, force: true });
});

function setup(project: Partial<DetectedProject> = {}) {
  const lan = vi.fn(() => ['192.168.1.20']);
  const pickFolder = vi.fn(async (): Promise<string | null> => join(root, 'dist'));
  const certStore = { get: vi.fn(async () => ({ cert: 'x', key: 'y' })) };
  tool = createStaticTool({ certStore, pickFolder, lanAddresses: lan, logger: createMemoryLogger() });
  let settings: StaticSettings = staticDefinition.settingsSchema.parse({});
  const emit = vi.fn();
  const ctxFor = (over: Partial<DetectedProject> = {}): ToolContext =>
    ({
      project: makeDetectedForTest({ path: root, buildOutput: 'dist', ...project, ...over }),
      shared: createSharedContext().forProject('p1'),
      emit,
      platform: createWin32Adapter({ runner: noopRunner, getEditorCommand: () => 'code' }),
      settings: {
        get: () => settings,
        update: (fn: (s: StaticSettings) => StaticSettings) => (settings = staticDefinition.settingsSchema.parse(fn(settings))),
      },
    }) as unknown as ToolContext;
  const ctx = ctxFor();
  const call = <T,>(method: string, input: unknown = {}, c: ToolContext = ctx) => tool?.handlers[method]?.(c, input) as Promise<T>;
  return { call, ctx, ctxFor, emit, certStore, pickFolder };
}

async function occupy(port = 0): Promise<number> {
  const s = createServer();
  blockers.push(s);
  await new Promise<void>((r) => s.listen(port, '127.0.0.1', () => r()));
  const a = s.address();
  if (!a || typeof a === 'string') throw new Error('no port');
  return a.port;
}

describe('static tool', () => {
  it('serves the build output on localhost by default and stops', async () => {
    const { call, emit } = setup();
    const status = await call<ServerStatus>('start');
    expect(status).toMatchObject({ running: true, folder: join(root, 'dist'), lanUrls: [], configChanged: false, servesPackageRoot: false });
    expect(status.localUrl).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect(status.port).toBeGreaterThanOrEqual(4173);
    const res = await fetch(status.localUrl?.replace('localhost', '127.0.0.1') ?? '');
    expect(await res.text()).toBe('<h1>built</h1>');
    expect(emit).toHaveBeenCalledWith('changed', undefined);
    expect((await call<ServerStatus>('stop')).running).toBe(false);
  });

  it('logs requests and serves them through getLogs', async () => {
    const { call, emit } = setup();
    const status = await call<ServerStatus>('start');
    await (await fetch(`http://127.0.0.1:${status.port}/missing.js?token=abc`)).text();
    await vi.waitFor(async () => {
      const snap = await call<LogSnapshot>('getLogs');
      expect(snap.lines.map((l) => l.text).join('\n')).toMatch(/GET \/missing\.js/);
    });
    const snap = await call<LogSnapshot>('getLogs');
    expect(JSON.stringify(snap)).not.toContain('token');
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('logs', expect.objectContaining({ lines: expect.any(Array) })));
    await call('clearLogs');
    expect((await call<LogSnapshot>('getLogs')).lines).toEqual([]);
  });

  it('reports LAN URLs when sharing on the LAN', async () => {
    const { call } = setup();
    await call('setConfig', { config: ServerConfigSchema.parse({ lan: true }) });
    const status = await call<ServerStatus>('start');
    expect(status.lanUrls).toEqual([`http://192.168.1.20:${status.port}/`]);
  });

  it('says a configured port is in use, and offers the next free one', async () => {
    const busy = await occupy();
    const { call } = setup();
    await call('setConfig', { config: ServerConfigSchema.parse({ port: busy }) });
    await expect(call('start')).rejects.toMatchObject({ code: 'CONFLICT' });
    const next = await call<{ port: number }>('nextFreePort');
    expect(next.port).toBeGreaterThan(busy);
  });

  it('refuses a folder that does not exist', async () => {
    const { call } = setup();
    await call('setConfig', { config: ServerConfigSchema.parse({ folder: 'nope' }) });
    await expect(call('start')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('serves the package folder without a build output, and says so', async () => {
    const { call } = setup({ buildOutput: null });
    const status = await call<ServerStatus>('start');
    expect(status.servesPackageRoot).toBe(true);
    expect(await (await fetch(`http://127.0.0.1:${status.port}/`)).text()).toBe('<h1>root</h1>');
  });

  it('marks a changed config while running', async () => {
    const { call } = setup();
    await call('start');
    await call('setConfig', { config: ServerConfigSchema.parse({ cors: true }) });
    expect((await call<ServerStatus>('status')).configChanged).toBe(true);
  });

  it('stores a picked folder relative to the package', async () => {
    const { call } = setup();
    expect(await call('pickFolder')).toEqual({ folder: 'dist' });
  });

  it('lists running servers across projects and stops a removed project', async () => {
    const { call, ctxFor } = setup();
    const other = ctxFor({ id: 'p2', rootId: 'p2' });
    await call('start');
    await call('start', {}, other);
    const running = await call<{ projectId: string; url: string }[]>('running');
    expect(running.map((r) => r.projectId).sort()).toEqual(['p1', 'p2']);
    tool?.forgetProject?.('p2');
    await vi.waitFor(async () => expect((await call<unknown[]>('running')).length).toBe(1));
  });

  it('closes a server whose project was removed while it was starting', async () => {
    const { call, certStore } = setup();
    let release: (pems: { cert: string; key: string }) => void = () => undefined;
    const { generateWithSelfsigned } = await import('./cert-store');
    const pems = await generateWithSelfsigned([], Date.now() + 86_400_000 * 30);
    certStore.get.mockReturnValue(new Promise((r) => (release = r)));
    await call('setConfig', { config: ServerConfigSchema.parse({ https: true }) });
    const starting = call<ServerStatus>('start');
    await vi.waitFor(() => expect(certStore.get).toHaveBeenCalled());
    tool?.forgetProject?.('p1');
    release(pems);
    await expect(starting).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await call<unknown[]>('running')).toEqual([]);
  }, 30_000);

  it('uses the stored certificate for HTTPS', async () => {
    const { call, certStore } = setup();
    const { generateWithSelfsigned } = await import('./cert-store');
    const pems = await generateWithSelfsigned([], Date.now() + 86_400_000 * 30);
    certStore.get.mockResolvedValue(pems);
    await call('setConfig', { config: ServerConfigSchema.parse({ https: true }) });
    const status = await call<ServerStatus>('start');
    expect(status.localUrl).toMatch(/^https:\/\/localhost:/);
    expect(certStore.get).toHaveBeenCalledWith([]);
  }, 30_000);
});
