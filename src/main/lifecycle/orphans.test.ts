import { describe, expect, it, vi } from 'vitest';
import { findOrphans } from './orphans';

const entry = (pid: number, startTime: number | null) => ({ pid, startTime, projectId: 'p1', script: 'dev' });

describe('findOrphans', () => {
  it('returns entries whose start time still matches', async () => {
    const startTimeOf = vi.fn(async (pid: number) => (pid === 1 ? 10_500 : 15_000));
    expect(await findOrphans([entry(1, 10_000), entry(2, 10_000)], startTimeOf)).toEqual([entry(1, 10_000)]);
  });

  it('never returns entries without a recorded start time', async () => {
    const startTimeOf = vi.fn(async () => 0);
    expect(await findOrphans([entry(1, null)], startTimeOf)).toEqual([]);
    expect(startTimeOf).not.toHaveBeenCalled();
  });

  it('treats gone processes and lookup failures as not running', async () => {
    const startTimeOf = vi.fn(async (pid: number) => {
      if (pid === 1) return null;
      throw new Error('powershell missing');
    });
    expect(await findOrphans([entry(1, 1), entry(2, 1)], startTimeOf)).toEqual([]);
  });
});
