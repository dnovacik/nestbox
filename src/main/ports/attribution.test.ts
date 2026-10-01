import { describe, expect, it, vi } from 'vitest';
import type { ProcessInfo } from '../platform/adapter';
import { AttributionCache, findOwnerRoot } from './attribution';

const proc = (pid: number, parentPid: number, startTime = 0): ProcessInfo => ({ pid, parentPid, startTime });
const tableOf = (procs: ProcessInfo[]) => new Map(procs.map((p) => [p.pid, p]));

describe('findOwnerRoot', () => {
  const table = tableOf([proc(40, 30, 400), proc(30, 20, 300), proc(20, 10, 200), proc(10, 1, 100), proc(1, 0, 1)]);

  it('walks up to the first NestBox root', () => {
    expect(findOwnerRoot(40, table, new Set([10]))).toBe(10);
    expect(findOwnerRoot(10, table, new Set([10]))).toBe(10);
  });

  it('returns null without a root on the way up', () => {
    expect(findOwnerRoot(40, table, new Set([99]))).toBeNull();
  });

  it('does not follow a parent PID that now belongs to a newer process', () => {
    // 50 was started by a terminal (PID 10 at the time) that exited; PID 10 is now a NestBox root started later.
    const reused = tableOf([proc(50, 10, 1_000), proc(10, 1, 90_000), proc(1, 0, 1)]);
    expect(findOwnerRoot(50, reused, new Set([10]))).toBeNull();
  });

  it('stops on cycles, long chains and dead parents', () => {
    expect(findOwnerRoot(1, tableOf([proc(1, 2), proc(2, 1)]), new Set([99]))).toBeNull();
    const chain = tableOf(Array.from({ length: 21 }, (_, i) => proc(i + 1, i, i)));
    expect(findOwnerRoot(21, chain, new Set([1]))).toBeNull();
    expect(findOwnerRoot(10, chain, new Set([1]))).toBe(1);
    expect(findOwnerRoot(40, tableOf([proc(40, 30, 5)]), new Set([10]))).toBeNull();
  });
});

function setup(table: ProcessInfo[] | null = [proc(40, 30), proc(30, 20), proc(20, 10), proc(10, 1), proc(50, 1), proc(1, 0)]) {
  const listProcesses = vi.fn(async () => table);
  const describe = vi.fn(async (pids: readonly number[]) => new Map(pids.map((p) => [p, `cmd ${p}`] as [number, string])));
  return { cache: new AttributionCache({ listProcesses, describe }), listProcesses, describe };
}

describe('AttributionCache', () => {
  it('resolves owners and command lines for new PIDs with one process listing', async () => {
    const { cache, listProcesses, describe: describeFn } = setup();
    await cache.refresh([40, 50], new Set([10]));
    expect(cache.ownerRoot(40)).toBe(10);
    expect(cache.ownerRoot(50)).toBeNull();
    expect(cache.command(40)).toBe('cmd 40');
    expect(listProcesses).toHaveBeenCalledTimes(1);
    expect(describeFn).toHaveBeenCalledWith([40, 50]);
  });

  it('does not list processes again for PIDs it already knows', async () => {
    const { cache, listProcesses, describe: describeFn } = setup();
    await cache.refresh([40, 50], new Set([10]));
    await cache.refresh([40, 50], new Set([10]));
    expect(listProcesses).toHaveBeenCalledTimes(1);
    expect(describeFn).toHaveBeenCalledTimes(1);
  });

  it('re-resolves unowned PIDs when a new root appears', async () => {
    const { cache, listProcesses } = setup();
    await cache.refresh([40], new Set());
    expect(cache.ownerRoot(40)).toBeNull();
    await cache.refresh([40], new Set([20]));
    expect(cache.ownerRoot(40)).toBe(20);
    expect(listProcesses).toHaveBeenCalledTimes(2);
  });

  it('forgets PIDs that stopped listening', async () => {
    const { cache, describe: describeFn } = setup();
    await cache.refresh([40], new Set([10]));
    await cache.refresh([], new Set([10]));
    expect(cache.ownerRoot(40)).toBeNull();
    expect(cache.command(40)).toBeNull();
    await cache.refresh([40], new Set([10]));
    expect(describeFn).toHaveBeenCalledTimes(2);
  });

  it('leaves owners unknown when the process list cannot be read, and retries next time', async () => {
    const { cache, listProcesses } = setup(null);
    await cache.refresh([40], new Set([10]));
    expect(cache.ownerRoot(40)).toBeNull();
    await cache.refresh([40], new Set([10]));
    expect(listProcesses).toHaveBeenCalledTimes(2);
  });

  it('never lets a failing lookup throw', async () => {
    const cache = new AttributionCache({
      listProcesses: vi.fn(async () => Promise.reject(new Error('x'))),
      describe: vi.fn(async () => Promise.reject(new Error('y'))),
    });
    await expect(cache.refresh([40], new Set([10]))).resolves.toBeUndefined();
    expect(cache.command(40)).toBeNull();
  });

  it('reads command lines in batches of 64 over several refreshes', async () => {
    const pids = Array.from({ length: 70 }, (_, i) => i + 100);
    const { cache, describe: describeFn } = setup(pids.map((p) => proc(p, 1)));
    await cache.refresh(pids, new Set());
    expect(cache.command(163)).toBe('cmd 163');
    expect(cache.command(164)).toBeNull();
    await cache.refresh(pids, new Set());
    expect(cache.command(169)).toBe('cmd 169');
    expect(describeFn).toHaveBeenCalledTimes(2);
    expect(describeFn.mock.calls[1]?.[0]).toEqual([164, 165, 166, 167, 168, 169]);
  });

  it('retries a failed command-line lookup after a pause, not on every refresh', async () => {
    let now = 0;
    const describeFn = vi.fn(async (): Promise<Map<number, string | null>> => Promise.reject(new Error('blocked')));
    const cache = new AttributionCache({ listProcesses: vi.fn(async () => [proc(40, 1)]), describe: describeFn, now: () => now });
    await cache.refresh([40], new Set());
    await cache.refresh([40], new Set());
    expect(describeFn).toHaveBeenCalledTimes(1);
    now = 31_000;
    describeFn.mockResolvedValueOnce(new Map([[40, 'node x']]));
    await cache.refresh([40], new Set());
    expect(cache.command(40)).toBe('node x');
  });

  it('never asks for the command line of PID 0', async () => {
    const { cache, describe: describeFn } = setup([proc(0, 0)]);
    await cache.refresh([0, 40], new Set());
    expect(describeFn).toHaveBeenCalledWith([40]);
  });
});
