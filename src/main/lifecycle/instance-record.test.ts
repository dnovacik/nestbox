import { describe, expect, it, vi } from 'vitest';
import { otherInstanceRunning, parseInstanceRecord, serializeInstanceRecord } from './instance-record';

describe('parseInstanceRecord', () => {
  it('round-trips a record', () => {
    const record = { pid: 42, startTime: 1_700_000_000_000 };
    expect(parseInstanceRecord(serializeInstanceRecord(record))).toEqual(record);
  });

  it.each([null, '', 'not json', '{"pid":"1","startTime":2}', '{"pid":1}', '{"pid":-1,"startTime":2}', '[]'])(
    'returns null for %j',
    (text) => {
      expect(parseInstanceRecord(text)).toBeNull();
    },
  );
});

describe('otherInstanceRunning', () => {
  const record = { pid: 7, startTime: 10_000 };
  const deps = (over: Partial<Parameters<typeof otherInstanceRunning>[1]> = {}) => ({
    ownPid: 1,
    isAlive: vi.fn(() => true),
    startTimeOf: vi.fn(async () => 10_500),
    ...over,
  });

  it('is false without a record (the lock is stale)', async () => {
    expect(await otherInstanceRunning(null, deps())).toBe(false);
  });

  it('is false when the record is this process', async () => {
    expect(await otherInstanceRunning({ ...record, pid: 1 }, deps())).toBe(false);
  });

  it('is false when the recorded process is gone, without asking for its start time', async () => {
    const d = deps({ isAlive: vi.fn(() => false) });
    expect(await otherInstanceRunning(record, d)).toBe(false);
    expect(d.startTimeOf).not.toHaveBeenCalled();
  });

  it('is false when the PID was reused by a process that started at another time', async () => {
    expect(await otherInstanceRunning(record, deps({ startTimeOf: vi.fn(async () => 99_000) }))).toBe(false);
  });

  it('is true when the recorded process is alive and started then', async () => {
    expect(await otherInstanceRunning(record, deps())).toBe(true);
  });

  it('assumes it is running when the start time cannot be read', async () => {
    expect(await otherInstanceRunning(record, deps({ startTimeOf: vi.fn(async () => null) }))).toBe(true);
    const failing = deps({ startTimeOf: vi.fn(async () => Promise.reject(new Error('x'))) });
    expect(await otherInstanceRunning(record, failing)).toBe(true);
  });
});
