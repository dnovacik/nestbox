import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHealthScheduler } from './scheduler';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const run = vi.fn(async (_id: string) => undefined);
  const scheduler = createHealthScheduler({ run, interval: () => 30 });
  return { run, scheduler };
}

describe('createHealthScheduler', () => {
  it('runs 2 s after a package goes live, then every interval', async () => {
    const { run, scheduler } = setup();
    scheduler.setLive('p1', true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(scheduler.isLive('p1')).toBe(true);
  });

  it('stops when the package is no longer live, and ignores repeats', async () => {
    const { run, scheduler } = setup();
    scheduler.setLive('p1', true);
    scheduler.setLive('p1', true);
    await vi.advanceTimersByTimeAsync(2_000);
    scheduler.setLive('p1', false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.isLive('p1')).toBe(false);
  });

  it('never overlaps runs of one package', async () => {
    let release: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((r) => (release = r)));
    const scheduler = createHealthScheduler({ run, interval: () => 5 });
    scheduler.setLive('p1', true);
    await vi.advanceTimersByTimeAsync(2_000 + 5_000 * 3);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('checks now, live or not', async () => {
    const { run, scheduler } = setup();
    await scheduler.checkNow('p2');
    expect(run).toHaveBeenCalledWith('p2');
  });

  it('stops everything on dispose', async () => {
    const { run, scheduler } = setup();
    scheduler.setLive('a', true);
    scheduler.setLive('b', true);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled();
  });
});
