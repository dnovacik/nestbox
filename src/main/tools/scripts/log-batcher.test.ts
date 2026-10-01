import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogLine } from '@shared/processes';
import { createLogBatcher } from './log-batcher';

const line = (seq: number): LogLine => ({ seq, ts: seq, stream: 'stdout', text: `l${seq}` });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createLogBatcher', () => {
  it('flushes each key once per interval, in order', () => {
    const flush = vi.fn();
    const b = createLogBatcher({ intervalMs: 50, flush });
    b.add('p1', 'dev', line(1));
    b.add('p2', 'dev', line(1));
    b.add('p1', 'dev', line(2));
    vi.advanceTimersByTime(49);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush.mock.calls).toEqual([
      ['p1', 'dev', [line(1), line(2)]],
      ['p2', 'dev', [line(1)]],
    ]);
  });

  it('stays quiet when idle', () => {
    const flush = vi.fn();
    createLogBatcher({ intervalMs: 50, flush });
    vi.advanceTimersByTime(500);
    expect(flush).not.toHaveBeenCalled();
  });

  it('flushNow flushes immediately and dispose drops pending lines', () => {
    const flush = vi.fn();
    const b = createLogBatcher({ intervalMs: 50, flush });
    b.add('p1', 'dev', line(1));
    b.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    b.add('p1', 'dev', line(2));
    b.dispose();
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
