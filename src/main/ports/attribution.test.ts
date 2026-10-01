import { describe, expect, it, vi } from 'vitest';
import type { ProcessInfo } from '../platform/adapter';
import { AttributionCache, findOwnerRoot } from './attribution';

const proc = (pid: number, parentPid: number): ProcessInfo => ({ pid, parentPid, startTime: 0 });

describe('findOwnerRoot', () => {
  const parents = new Map([
    [40, 30],
    [30, 20],
    [20, 10],
    [10, 1],
  ]);

  it('walks up to the first NestBox root', () => {
    expect(findOwnerRoot(40, parents, new Set([10]))).toBe(10);
    expect(findOwnerRoot(10, parents, new Set([10]))).toBe(10);
  });

  it('returns null without a root on the way up', () => {
    expect(findOwnerRoot(40, parents, new Set([99]))).toBeNull();
  });

  it('stops on cycles and long chains', () => {
    expect(findOwnerRoot(1, new Map([[1, 2], [2, 1]]), new Set([99]))).toBeNull();
    const chain = new Map(Array.from({ length: 20 }, (_, i) => [i + 2, i + 1] as [number, number]));
    expect(findOwnerRoot(21, chain, new Set([1]))).toBeNull();
    expect(findOwnerRoot(10, chain, new Set([1]))).toBe(1);
  });
});

function setup(table: ProcessInfo[] | null = [proc(40, 30), proc(30, 20), proc(20, 10), proc(50, 1)]) {
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
    const { cache, listProcesses } = setup([proc(40, 30), proc(30, 20), proc(20, 10), proc(50, 1)]);
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
});
