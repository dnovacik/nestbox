import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogSnapshot } from '@shared/processes';
import { makeDetectedForTest } from '@shared/test-fixtures';
import {
  type MockSettings,
  type MockStatus,
  type PackageMock,
  RouteSchema,
} from '@shared/tools/mock/contract';
import { createMemoryLogger } from '../../logger';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createMockTool } from './index';

let tool: AnyMainTool | null = null;
let blocker: Server | null = null;
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
  await new Promise<void>((resolve) => (blocker ? blocker.close(() => resolve()) : resolve()));
  blocker = null;
});

function setup(initial: MockSettings = { packages: {} }) {
  let settings = initial;
  const logger = createMemoryLogger();
  tool = createMockTool({ logger });
  const emit = vi.fn();
  const ctx = {
    project: makeDetectedForTest({ path: '/work/shop' }),
    shared: createSharedContext().forProject('p1'),
    emit,
    platform: {},
    settings: {
      get: () => settings,
      update: (fn: (s: MockSettings) => MockSettings) => (settings = fn(settings)),
    },
  } as unknown as ToolContext;
  const call = <T>(method: string, input: unknown = {}) =>
    tool?.handlers[method]?.(ctx, input) as Promise<T>;
  return { call, emit, logger, settings: () => settings };
}

const route = (id: string, patch: Record<string, unknown> = {}) =>
  RouteSchema.parse({
    id,
    method: 'GET',
    path: '/users/:id',
    body: '{"id":"{{params.id}}"}',
    ...patch,
  });

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('mock tool: routes and options', () => {
  it('adds, replaces, moves and deletes routes, keyed by package', async () => {
    const { call, settings, emit } = setup();
    await call('saveRoute', { route: route('a') });
    await call('saveRoute', { route: route('b', { path: '/b' }) });
    await call('saveRoute', { route: route('a', { status: 201 }) });
    let config = await call<PackageMock>('moveRoute', { id: 'b', to: 0 });
    expect(config.routes.map((r) => [r.id, r.status])).toEqual([
      ['b', 200],
      ['a', 201],
    ]);
    config = await call<PackageMock>('deleteRoute', { id: 'b' });
    expect(config.routes.map((r) => r.id)).toEqual(['a']);
    expect(Object.keys(settings().packages)).toEqual(['']);
    expect(emit).toHaveBeenCalledWith('changed', undefined);
    await expect(call('moveRoute', { id: 'nope', to: 0 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('caps the routes at 100', async () => {
    const routes = Array.from({ length: 100 }, (_, i) => route(`r${i}`));
    const { call } = setup({
      packages: { '': { port: null, routes, delayMs: 0, failAll: { on: false, status: 500 } } },
    });
    await expect(call('saveRoute', { route: route('extra') })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await call('saveRoute', { route: route('r5', { status: 204 }) });
  });

  it('sets the port, delay and fail-all', async () => {
    const { call } = setup();
    const config = await call<PackageMock>('setOptions', {
      port: 4999,
      delayMs: 50,
      failAll: { on: true, status: 503 },
    });
    expect(config).toMatchObject({ port: 4999, delayMs: 50, failAll: { on: true, status: 503 } });
  });
});

describe('mock tool: server', () => {
  it('serves the routes on localhost, applies edits at once, and logs only the start and stop', async () => {
    const port = await freePort();
    const { call, logger } = setup();
    await call('setOptions', { port });
    await call('saveRoute', { route: route('a') });
    const started = await call<MockStatus>('start');
    expect(started).toEqual({
      running: true,
      port,
      url: `http://localhost:${port}`,
      configChanged: false,
      requests: 0,
    });

    const res = await fetch(`http://127.0.0.1:${port}/users/7?token=s3cr3t`);
    expect(await res.json()).toEqual({ id: '7' });
    await call('saveRoute', { route: route('a', { fail: { on: true, status: 502 } }) });
    expect((await fetch(`http://127.0.0.1:${port}/users/7`)).status).toBe(502);
    expect((await call<MockStatus>('status')).requests).toBe(2);

    await vi.waitFor(async () =>
      expect((await call<LogSnapshot>('getLogs')).lines.length).toBeGreaterThanOrEqual(3),
    );
    const texts = (await call<LogSnapshot>('getLogs')).lines.map((l) => l.text);
    expect(texts[0]).toBe(`▸ mock API on http://localhost:${port} (1 routes)`);
    expect(texts.join('\n')).not.toMatch(/s3cr3t/);

    expect((await call<MockStatus>('stop')).running).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/users/7`)).rejects.toThrow();
    expect(JSON.stringify(logger.entries)).not.toMatch(/users|s3cr3t/);
  });

  it('refuses a configured port that is in use, and finds the next free one', async () => {
    blocker = createServer();
    await new Promise<void>((r) => blocker?.listen(0, '127.0.0.1', r));
    const busy = (blocker.address() as AddressInfo).port;
    const { call } = setup();
    await call('setOptions', { port: busy });
    await expect(call('start')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: `Port ${busy} is in use`,
    });
    const { port } = await call<{ port: number }>('nextFreePort');
    expect(port).toBeGreaterThan(busy);
  });

  it('says a port change needs a restart', async () => {
    const port = await freePort();
    const { call } = setup();
    await call('setOptions', { port });
    await call('start');
    await call('setOptions', { port: port === 65_535 ? port - 1 : port + 1 });
    expect((await call<MockStatus>('status')).configChanged).toBe(true);
  });

  it('stops the server on dispose', async () => {
    const port = await freePort();
    const { call } = setup();
    await call('setOptions', { port });
    await call('start');
    await tool?.dispose?.();
    tool = null;
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});
