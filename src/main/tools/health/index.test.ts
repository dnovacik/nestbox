import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import type { ProcessSummary } from '@shared/processes';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { CheckResult, HealthSettings, HealthStatus } from '@shared/tools/health/contract';
import { createMemoryLogger } from '../../logger';
import type { ProcessEvent } from '../../processes/process-manager';
import { createEnvFileAccess } from '../env/env-files';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createHealthTool } from './index';

let root = '';
let tool: AnyMainTool | null = null;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  root = await mkdtemp(join(tmpdir(), 'nestbox-health-'));
  await writeFile(
    join(root, '.env'),
    'PORT=3000\nAPI_URL=https://u:s3cr3t@api.local:4000/v1?token=s3cr3t\nDATABASE_URL=postgresql://x@db/y\n',
  );
});
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

const result = (state: CheckResult['state'], status: number | null = null): CheckResult => ({
  state,
  status,
  ms: 3,
  reason: state === 'ok' ? null : 'ECONNREFUSED',
  at: 1,
});

function setup(initial: Partial<HealthSettings> = {}) {
  let settings: HealthSettings = { packages: {}, notify: true, ...initial };
  let running: ProcessSummary[] = [];
  const listeners = new Set<(e: ProcessEvent) => void>();
  const processes = {
    list: () => running,
    on: (l: (e: ProcessEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const project: DetectedProject = makeDetectedForTest({ path: root, name: 'shop' });
  const check = vi.fn(async (_url: string, _o: { expect?: number }) => result('ok', 200));
  const notify = vi.fn();
  const emit = vi.fn();
  const logger = createMemoryLogger();
  tool = createHealthTool({
    processes,
    getDetected: () => project,
    readSettings: () => settings,
    envFiles: createEnvFileAccess(),
    check,
    emit,
    notify,
    logger,
  });
  const ctx = {
    project,
    shared: createSharedContext().forProject('p1'),
    emit: vi.fn(),
    platform: {},
    settings: {
      get: () => settings,
      update: (fn: (s: HealthSettings) => HealthSettings) => (settings = fn(settings)),
    },
  } as unknown as ToolContext;
  const call = <T>(method: string, input: unknown = {}) =>
    tool?.handlers[method]?.(ctx, input) as Promise<T>;
  const setRunning = (on: boolean) => {
    running = on ? [{ projectId: 'p1', script: 'dev', state: 'running' } as ProcessSummary] : [];
    for (const l of listeners) l({ type: 'changed' });
  };
  return { call, check, notify, emit, logger, setRunning };
}

describe('health tool: checks and status', () => {
  it('suggests localhost:PORT and URL-like env keys, never DATABASE_URL or values', async () => {
    const { call } = setup();
    const status = await call<HealthStatus>('status');
    expect(status).toMatchObject({
      live: false,
      intervalSec: 30,
      notify: true,
      checks: [],
      suggestions: { port: 3000, envKeys: ['API_URL'] },
    });
    expect(JSON.stringify(status)).not.toMatch(/s3cr3t|token/);
  });

  it('adds a URL check and an env-key check, labelled without the env value', async () => {
    const { call } = setup();
    await call('addCheck', { check: { kind: 'url', url: 'http://localhost:3000/' } });
    await call('addCheck', {
      check: { kind: 'env', key: 'API_URL', path: '/health', expect: 401 },
    });
    const { checks, suggestions } = await call<HealthStatus>('status');
    expect(checks.map((c) => [c.kind, c.label, c.expect])).toEqual([
      ['url', 'http://localhost:3000/', null],
      ['env', 'API_URL · api.local:4000/health', 401],
    ]);
    expect(suggestions.envKeys).toEqual([]);
    expect(JSON.stringify(checks)).not.toMatch(/s3cr3t|token/);
  });

  it('removes a check and changes the options', async () => {
    const { call } = setup();
    await call('addCheck', { check: { kind: 'url', url: 'http://localhost:3000/' } });
    const [first] = (await call<HealthStatus>('status')).checks;
    await call('removeCheck', { id: first?.id });
    await call('setOptions', { intervalSec: 10, notify: false });
    expect(await call<HealthStatus>('status')).toMatchObject({
      checks: [],
      intervalSec: 10,
      notify: false,
    });
  });

  it('caps the checks per package', async () => {
    const { call } = setup();
    for (let i = 0; i < 20; i++)
      await call('addCheck', { check: { kind: 'url', url: `http://localhost:${3000 + i}/` } });
    await expect(
      call('addCheck', { check: { kind: 'url', url: 'http://localhost:4000/' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('health tool: running checks', () => {
  it('runs the checks 2 s after a script starts, against the env value for env checks', async () => {
    const { call, check, setRunning } = setup();
    await call('addCheck', { check: { kind: 'url', url: 'http://localhost:3000/' } });
    await call('addCheck', {
      check: { kind: 'env', key: 'API_URL', path: '/health', expect: 401 },
    });
    setRunning(true);
    await vi.advanceTimersByTimeAsync(2_000);
    // The .env read is real I/O, which fake timers don't wait for.
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(check.mock.calls.map((c) => [c[0], c[1].expect])).toEqual([
      ['http://localhost:3000/', undefined],
      ['https://api.local:4000/health', 401],
    ]);
    const status = await call<HealthStatus>('status');
    expect(status.live).toBe(true);
    expect(status.checks.map((c) => c.result?.state)).toEqual(['ok', 'ok']);
  });

  it('stops when the script stops, and runs now on demand', async () => {
    const { call, check, setRunning } = setup();
    await call('addCheck', { check: { kind: 'url', url: 'http://localhost:3000/' } });
    setRunning(true);
    await vi.advanceTimersByTimeAsync(2_000);
    setRunning(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(check).toHaveBeenCalledTimes(1);
    expect((await call<HealthStatus>('status')).live).toBe(false);
    await call('checkNow');
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('reports an env check whose key is missing as a config problem, without a request', async () => {
    await writeFile(join(root, '.env'), 'PORT=3000\n');
    const { call, check } = setup({
      packages: {
        '': { checks: [{ id: 'c1', kind: 'env', key: 'API_URL', path: '/' }], intervalSec: 30 },
      },
    });
    await call('checkNow');
    expect(check).not.toHaveBeenCalled();
    expect((await call<HealthStatus>('status')).checks[0]?.result).toMatchObject({
      state: 'config',
      reason: 'not set in .env',
    });
  });

  it('notifies only when a check goes from ok to fail, and not when notify is off', async () => {
    const { call, check, notify, setRunning } = setup({
      packages: {
        '': { checks: [{ id: 'c1', kind: 'url', url: 'http://localhost:3000/' }], intervalSec: 30 },
      },
    });
    check
      .mockResolvedValueOnce(result('fail'))
      .mockResolvedValueOnce(result('ok', 200))
      .mockResolvedValueOnce(result('fail'))
      .mockResolvedValueOnce(result('fail'));
    setRunning(true);
    await vi.advanceTimersByTimeAsync(2_000); // fail first: the server may still be starting
    await vi.advanceTimersByTimeAsync(30_000); // ok
    await vi.advanceTimersByTimeAsync(30_000); // ok → fail: notify
    await vi.advanceTimersByTimeAsync(30_000); // fail → fail: no repeat
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      projectId: 'p1',
      title: 'shop health check failed',
      body: 'http://localhost:3000/: ECONNREFUSED',
    });
    await call('setOptions', { notify: false });
    check.mockResolvedValueOnce(result('ok', 200)).mockResolvedValueOnce(result('fail'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("doesn't notify for a failure right after a restart", async () => {
    const { check, notify, setRunning } = setup({
      packages: {
        '': { checks: [{ id: 'c1', kind: 'url', url: 'http://localhost:3000/' }], intervalSec: 30 },
      },
    });
    check.mockResolvedValueOnce(result('ok', 200)).mockResolvedValueOnce(result('fail'));
    setRunning(true);
    await vi.advanceTimersByTimeAsync(2_000);
    setRunning(false);
    setRunning(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(notify).not.toHaveBeenCalled();
  });

  it('tells the renderer when results change, and never logs URLs', async () => {
    const { call, emit, logger, setRunning } = setup();
    await call('addCheck', { check: { kind: 'env', key: 'API_URL', path: '/' } });
    setRunning(true);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('p1', 'changed'));
    expect(JSON.stringify(logger.entries)).not.toMatch(/api\.local|localhost|s3cr3t/);
  });
});
