import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring-buffer';

const line = (seq: number) => ({ seq });
const seqs = (items: { seq: number }[]) => items.map((i) => i.seq);

describe('RingBuffer', () => {
  it('keeps the newest items up to capacity', () => {
    const b = new RingBuffer<{ seq: number }>(3);
    [1, 2, 3, 4, 5].forEach((s) => b.push(line(s)));
    expect(seqs(b.toArray())).toEqual([3, 4, 5]);
    expect(b.size).toBe(3);
  });

  it('returns items after a seq', () => {
    const b = new RingBuffer<{ seq: number }>(10);
    [1, 2, 3, 4, 5].forEach((s) => b.push(line(s)));
    expect(seqs(b.after(3))).toEqual([4, 5]);
    expect(seqs(b.after(0))).toEqual([1, 2, 3, 4, 5]);
    expect(b.after(9)).toEqual([]);
  });

  it('clears', () => {
    const b = new RingBuffer<{ seq: number }>(2);
    b.push(line(1));
    b.clear();
    expect(b.size).toBe(0);
    expect(b.toArray()).toEqual([]);
    b.push(line(2));
    expect(seqs(b.toArray())).toEqual([2]);
  });

  it('rejects a capacity below 1', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(1.5)).toThrow(RangeError);
  });
});
