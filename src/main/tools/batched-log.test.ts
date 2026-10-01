import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchedLog } from './batched-log';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('BatchedLog', () => {
  it('emits lines in one batch after 50 ms', () => {
    const emit = vi.fn();
    const log = new BatchedLog(10, emit);
    log.push('stdout', 'a');
    log.push('stderr', 'b');
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0].map((l: { text: string }) => l.text)).toEqual(['a', 'b']);
  });

  it('keeps the newest lines and seq numbers across a clear', () => {
    const log = new BatchedLog(2, vi.fn());
    for (const t of ['a', 'b', 'c']) log.push('stdout', t);
    expect(log.snapshot()).toMatchObject({ firstSeq: 2, lastSeq: 3, lines: [{ text: 'b' }, { text: 'c' }] });
    expect(log.snapshot(2).lines.map((l) => l.text)).toEqual(['c']);
    log.clear();
    expect(log.snapshot()).toEqual({ lines: [], firstSeq: 4, lastSeq: 3 });
  });

  it('uses the latest emit and drops the batch on dispose', () => {
    const first = vi.fn();
    const second = vi.fn();
    const log = new BatchedLog(10, first);
    log.push('stdout', 'a');
    log.emit = second;
    vi.advanceTimersByTime(50);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    log.push('stdout', 'b');
    log.dispose();
    vi.advanceTimersByTime(50);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
