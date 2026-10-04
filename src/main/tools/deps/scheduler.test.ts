import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepsSchedule } from '@shared/types';
import { createMemoryLogger } from '../../logger';
import { createDepsScheduler } from './scheduler';

const DAY = 24 * 3_600_000;

function setup(schedule: DepsSchedule, last: Record<string, number | null>) {
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;
  const check = vi.fn(async (id: string) => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(id);
    await Promise.resolve();
    active--;
    if (id === 'broken') throw Object.assign(new Error('x'), { code: 'CONFLICT' });
  });
  const onChange = vi.fn();
  const scheduler = createDepsScheduler({
    rootIds: async () => Object.keys(last),
    schedule: () => schedule,
    lastChecked: (id) => last[id] ?? null,
    check,
    onChange,
    logger: createMemoryLogger(),
    now: () => 10 * DAY,
  });
  return { scheduler, check, order, onChange, maxActive: () => maxActive };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('deps scheduler', () => {
  it('does nothing while the schedule is off', async () => {
    const { scheduler, check } = setup('off', { a: null });
    await scheduler.tick();
    expect(check).not.toHaveBeenCalled();
  });

  it('checks the projects that are due, one at a time', async () => {
    const { scheduler, order, maxActive, onChange } = setup('daily', {
      a: null,
      b: 9.5 * DAY,
      c: 8 * DAY,
      broken: null,
    });
    await scheduler.tick();
    expect(order).toEqual(['a', 'c', 'broken']);
    expect(maxActive()).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(scheduler.running()).toBe(false);
  });

  it('weekly waits seven days', async () => {
    const { scheduler, order } = setup('weekly', { a: 4 * DAY, b: 2 * DAY });
    await scheduler.tick();
    expect(order).toEqual(['b']);
  });

  it('checks everything on Check all, schedule or not, and never runs twice at once', async () => {
    const { scheduler, order } = setup('off', { a: 10 * DAY, b: null });
    const first = scheduler.runAll();
    const second = scheduler.runAll();
    await Promise.all([first, second]);
    expect(order).toEqual(['a', 'b']);
  });

  it('ticks a minute after start, then hourly', async () => {
    const { scheduler, check } = setup('daily', { a: null });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });
});
