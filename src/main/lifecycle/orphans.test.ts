import { describe, expect, it } from 'vitest';
import { findOrphans } from './orphans';

const entry = (pid: number, startTime: number | null) => ({ pid, startTime, projectId: 'p1', script: 'dev' });
const proc = (pid: number, parentPid: number, startTime: number) => ({ pid, parentPid, startTime });

describe('findOrphans', () => {
  it('returns a live root whose start time still matches the recorded spawn time', () => {
    const processes = [proc(1, 500, 7_600), proc(2, 500, 14_000)];
    expect(findOrphans([entry(1, 10_000), entry(2, 10_000)], processes)).toEqual([
      { entry: entry(1, 10_000), pids: [1] },
    ]);
  });

  it('finds the children of a root that has exited (cmd.exe gone, npm and the server still running)', () => {
    const processes = [proc(30, 10, 10_400), proc(31, 10, 10_900), proc(40, 30, 11_000), proc(50, 10, 5_000)];
    // 50 started before the script did: its parent was an older process that had the same PID.
    expect(findOrphans([entry(10, 10_000)], processes)).toEqual([{ entry: entry(10, 10_000), pids: [30, 31] }]);
  });

  it("finds the root's process group on macOS, whose leftovers launchd adopted (parent 1)", () => {
    const grouped = (pid: number, startTime: number, groupId: number) => ({ pid, parentPid: 1, startTime, groupId });
    const processes = [grouped(31, 10_500, 10), grouped(32, 10_900, 10), grouped(60, 10_500, 60), grouped(33, 4_000, 10)];
    // 60 is in another group; 33 started before the script (an older group that reused the id).
    expect(findOrphans([entry(10, 10_000)], processes)).toEqual([{ entry: entry(10, 10_000), pids: [31, 32] }]);
  });

  it('ignores the children of a reused root PID', () => {
    const processes = [proc(10, 1, 50_000), proc(30, 10, 51_000)];
    expect(findOrphans([entry(10, 10_000)], processes)).toEqual([]);
  });

  it('never returns entries without a recorded start time', () => {
    expect(findOrphans([entry(1, null)], [proc(1, 0, 0), proc(2, 1, 0)])).toEqual([]);
  });

  it('returns nothing when the tree is gone', () => {
    expect(findOrphans([entry(1, 10_000)], [proc(2, 500, 10_000)])).toEqual([]);
  });
});
