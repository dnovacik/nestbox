import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { ProcessSummary } from '@shared/processes';
import { createMemoryLogger } from '../logger';
import type { PortEntry, ProcessInfo } from '../platform/adapter';
import { PortService } from './port-service';

const summary = (projectId: string, script: string, pid: number | null, state: ProcessSummary['state'] = 'running'): ProcessSummary => ({
  projectId,
  script,
  state,
  pid,
  startedAt: 1,
  exit: null,
  crashCount: 0,
  autoRestart: false,
  nextRestartAt: null,
  gaveUp: false,
});

function setup(ports: PortEntry[] = [
  { port: 3000, pid: 40, addresses: ['0.0.0.0', '::'], processName: 'node.exe' },
  { port: 5432, pid: 77, addresses: ['127.0.0.1'], processName: 'postgres.exe' },
]) {
  let current: PortEntry[] | Error = ports;
  const table: ProcessInfo[] = [
    { pid: 40, parentPid: 30, startTime: 0 },
    { pid: 30, parentPid: 10, startTime: 0 },
    { pid: 10, parentPid: 1, startTime: 0 },
    { pid: 77, parentPid: 1, startTime: 0 },
    { pid: 1, parentPid: 0, startTime: 0 },
  ];
  const platform = {
    listListeningPorts: vi.fn(async () => {
      if (current instanceof Error) throw current;
      return current;
    }),
    describeProcesses: vi.fn(async (pids: readonly number[]) => new Map(pids.map((p) => [p, `cmd ${p}`] as [number, string]))),
    listProcesses: vi.fn(async () => table),
    killTree: vi.fn(async () => {}),
  };
  const processes = {
    list: vi.fn(() => [summary('shop', 'dev', 10), summary('shop', 'old', null, 'stopped')]),
    stop: vi.fn(async () => summary('shop', 'dev', null, 'stopped')),
  };
  const logger = createMemoryLogger();
  const service = new PortService({ platform, processes, ownPid: 999, now: () => Date.now(), logger });
  return {
    service,
    platform,
    processes,
    logger,
    setPorts: (next: PortEntry[] | Error) => {
      current = next;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('PortService.list', () => {
  it('returns rows with owners and command lines, sorted by port', async () => {
    const { service } = setup();
    const result = await service.list();
    expect(result.stale).toBe(false);
    expect(result.rows).toEqual([
      {
        port: 3000,
        pid: 40,
        addresses: ['0.0.0.0', '::'],
        processName: 'node.exe',
        command: 'cmd 40',
        owner: { projectId: 'shop', script: 'dev' },
      },
      { port: 5432, pid: 77, addresses: ['127.0.0.1'], processName: 'postgres.exe', command: 'cmd 77', owner: null },
    ]);
  });

  it('shares one scan between calls within a second', async () => {
    const { service, platform } = setup();
    await Promise.all([service.list(), service.list()]);
    await service.list();
    expect(platform.listListeningPorts).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_001);
    await service.list();
    expect(platform.listListeningPorts).toHaveBeenCalledTimes(2);
  });

  it('returns the last good rows as stale when a scan fails, and throws without any', async () => {
    const { service, setPorts } = setup();
    setPorts(new NestboxError('INTERNAL', 'Could not list ports'));
    await expect(service.list()).rejects.toMatchObject({ code: 'INTERNAL' });
    setPorts([{ port: 1, pid: 77, addresses: ['::'], processName: null }]);
    vi.advanceTimersByTime(1_001);
    await service.list();
    setPorts(new Error('netstat'));
    vi.advanceTimersByTime(1_001);
    const result = await service.list();
    expect(result.stale).toBe(true);
    expect(result.rows.map((r) => r.port)).toEqual([1]);
  });

  it('drops an owner whose script is no longer live', async () => {
    const { service, processes } = setup();
    await service.list();
    processes.list.mockReturnValue([summary('shop', 'dev', null, 'stopped')]);
    vi.advanceTimersByTime(1_001);
    expect((await service.list()).rows[0]?.owner).toBeNull();
  });
});

describe('PortService.kill', () => {
  it('stops the owning script instead of killing the process', async () => {
    const { service, platform, processes, logger } = setup();
    expect(await service.kill({ pid: 40, port: 3000, confirmed: false })).toEqual({ result: 'stopped-script', processName: 'node.exe' });
    expect(processes.stop).toHaveBeenCalledWith('shop', 'dev');
    expect(platform.killTree).not.toHaveBeenCalled();
    expect(logger.entries).toContainEqual({ level: 'info', message: 'ports kill', fields: { port: 3000, owned: true } });
  });

  it('asks before killing a process NestBox did not start', async () => {
    const { service, platform } = setup();
    expect(await service.kill({ pid: 77, port: 5432, confirmed: false })).toEqual({ result: 'needs-confirm', processName: 'postgres.exe' });
    expect(platform.killTree).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_001);
    expect(await service.kill({ pid: 77, port: 5432, confirmed: true })).toEqual({ result: 'killed', processName: 'postgres.exe' });
    expect(platform.killTree).toHaveBeenCalledWith(77);
  });

  it('refuses the system and NestBox itself', async () => {
    const { service } = setup([
      { port: 445, pid: 4, addresses: ['0.0.0.0'], processName: 'System' },
      { port: 9229, pid: 999, addresses: ['127.0.0.1'], processName: 'electron.exe' },
    ]);
    await expect(service.kill({ pid: 4, port: 445, confirmed: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.kill({ pid: 999, port: 9229, confirmed: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a PID that is not listening on that port in a fresh scan', async () => {
    const { service, platform } = setup();
    await service.list();
    await expect(service.kill({ pid: 77, port: 3000, confirmed: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(platform.listListeningPorts).toHaveBeenCalledTimes(2);
    expect(platform.killTree).not.toHaveBeenCalled();
  });
});

describe('PortService.kill safety', () => {
  it('refuses to act on stale rows when the fresh scan fails', async () => {
    const { service, platform, setPorts } = setup();
    await service.list();
    setPorts(new Error('netstat timed out'));
    await expect(service.kill({ pid: 77, port: 5432, confirmed: true })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(platform.killTree).not.toHaveBeenCalled();
  });

  it('refuses to kill an ancestor of NestBox (its tree would include NestBox)', async () => {
    const { service, platform } = setup();
    platform.listProcesses.mockResolvedValue([
      { pid: 999, parentPid: 500, startTime: 10 },
      { pid: 500, parentPid: 77, startTime: 5 },
      { pid: 77, parentPid: 1, startTime: 1 },
      { pid: 40, parentPid: 30, startTime: 20 },
      { pid: 30, parentPid: 10, startTime: 15 },
    ]);
    await expect(service.kill({ pid: 77, port: 5432, confirmed: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(platform.killTree).not.toHaveBeenCalled();
  });
});

describe('PortService.waitUntilFree', () => {
  it('resolves true once nothing listens on the port', async () => {
    const { service, setPorts } = setup();
    const waiting = service.waitUntilFree(3000, 5_000);
    await vi.advanceTimersByTimeAsync(600);
    setPorts([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(await waiting).toBe(true);
  });

  it('resolves false after the timeout', async () => {
    const { service } = setup();
    const waiting = service.waitUntilFree(3000, 2_000);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await waiting).toBe(false);
  });
});
