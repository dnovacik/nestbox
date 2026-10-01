import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from './throttle';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('throttle', () => {
  it('fires on the leading edge and once more at the end of a burst', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    for (let i = 0; i < 5; i++) t();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fires again immediately after a quiet window', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    vi.advanceTimersByTime(150);
    t();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the trailing call', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    t();
    t.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
