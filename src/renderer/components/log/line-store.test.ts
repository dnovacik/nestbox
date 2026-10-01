import { describe, expect, it, vi } from 'vitest';
import type { LogLine, LogSnapshot } from '@shared/processes';
import { LogLineStore } from './line-store';

const l = (seq: number): LogLine => ({ seq, ts: seq, stream: 'stdout', text: `l${seq}` });
const snap = (lines: LogLine[], lastSeq = lines.at(-1)?.seq ?? 0): LogSnapshot => ({
  lines,
  firstSeq: lines[0]?.seq ?? lastSeq + 1,
  lastSeq,
});
const seqs = (s: LogLineStore) => s.getSnapshot().map((x) => x.seq);

describe('LogLineStore', () => {
  it('queues batches that arrive before the snapshot and drops the overlap', () => {
    const s = new LogLineStore(100);
    expect(s.append([l(3), l(4)])).toBe('ok');
    expect(s.getSnapshot()).toEqual([]);
    expect(s.applySnapshot(snap([l(1), l(2), l(3)]), 'replace')).toBe('ok');
    expect(seqs(s)).toEqual([1, 2, 3, 4]);
  });

  it('reports a gap and recovers through a delta without duplicates', () => {
    const s = new LogLineStore(100);
    s.applySnapshot(snap([l(1)]), 'replace');
    expect(s.append([l(4)])).toBe('gap');
    expect(s.append([l(5)])).toBe('ok');
    expect(seqs(s)).toEqual([1]);
    expect(s.applySnapshot(snap([l(2), l(3), l(4)]), 'delta')).toBe('ok');
    expect(seqs(s)).toEqual([1, 2, 3, 4, 5]);
  });

  it('ignores a replayed batch', () => {
    const s = new LogLineStore(100);
    s.applySnapshot(snap([l(1), l(2)]), 'replace');
    const before = s.getSnapshot();
    expect(s.append([l(1), l(2)])).toBe('ok');
    expect(s.getSnapshot()).toBe(before);
  });

  it('caps to the newest lines', () => {
    const s = new LogLineStore(3);
    s.applySnapshot(snap([l(1), l(2)]), 'replace');
    s.append([l(3), l(4), l(5)]);
    expect(seqs(s)).toEqual([3, 4, 5]);
    s.setCap(2);
    expect(seqs(s)).toEqual([4, 5]);
  });

  it('keeps lastSeq through a clear so later lines continue', () => {
    const s = new LogLineStore(10);
    s.applySnapshot(snap([l(1), l(2)]), 'replace');
    s.clear();
    expect(s.getSnapshot()).toEqual([]);
    expect(s.append([l(3)])).toBe('ok');
    expect(seqs(s)).toEqual([3]);
  });

  it('accepts a delta that skips ahead (the main buffer dropped lines)', () => {
    const s = new LogLineStore(10);
    s.applySnapshot(snap([l(1)]), 'replace');
    expect(s.append([l(12)])).toBe('gap');
    expect(s.applySnapshot(snap([l(10), l(11), l(12)]), 'delta')).toBe('ok');
    expect(seqs(s)).toEqual([1, 10, 11, 12]);
  });

  it('accepts an empty snapshot whose lastSeq is past zero (cleared in main)', () => {
    const s = new LogLineStore(10);
    s.applySnapshot(snap([], 7), 'replace');
    expect(s.lastSeq).toBe(7);
    expect(s.append([l(8)])).toBe('ok');
  });

  it('notifies once per change with a new array', () => {
    const s = new LogLineStore(10);
    const listener = vi.fn();
    s.subscribe(listener);
    s.applySnapshot(snap([l(1)]), 'replace');
    const first = s.getSnapshot();
    s.append([l(2)]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(s.getSnapshot()).not.toBe(first);
  });
});
