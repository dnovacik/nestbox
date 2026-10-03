import { describe, expect, it } from 'vitest';
import type { ProcessInfo } from './adapter';
import { killProcessTree } from './posix-kill';

/** A fake process table: groups by pgid, signals recorded, processes die on the signals they don't ignore. */
function table(procs: { pid: number; ppid: number; pgid: number; ignoresTerm?: boolean }[], opts: { eperm?: number[] } = {}) {
  const alive = new Map(procs.map((p) => [p.pid, p]));
  const signals: string[] = [];
  const err = (code: string) => Object.assign(new Error(code), { code });
  const deliver = (pid: number, signal: NodeJS.Signals | 0) => {
    const p = alive.get(pid);
    if (!p) throw err('ESRCH');
    if (opts.eperm?.includes(pid)) throw err('EPERM');
    if (signal === 0) return;
    if (signal === 'SIGKILL' || !p.ignoresTerm) alive.delete(pid);
  };
  return {
    signals,
    alive,
    deps: {
      kill(target: number, signal: NodeJS.Signals | 0) {
        if (signal !== 0) signals.push(`${signal} ${target}`);
        if (target < 0) {
          const members = [...alive.values()].filter((p) => p.pgid === -target);
          if (members.length === 0) throw err('ESRCH');
          for (const m of members) deliver(m.pid, signal);
        } else {
          deliver(target, signal);
        }
      },
      list: async (): Promise<ProcessInfo[]> => [...alive.values()].map((p) => ({ pid: p.pid, parentPid: p.ppid, startTime: 0 })),
      sleep: async () => undefined,
    },
  };
}

describe('killProcessTree', () => {
  it('terminates the process group and descendants that left it', async () => {
    const t = table([
      { pid: 100, ppid: 1, pgid: 100 },
      { pid: 101, ppid: 100, pgid: 100 },
      { pid: 102, ppid: 101, pgid: 102 }, // a daemonised server in its own group
      { pid: 200, ppid: 1, pgid: 200 }, // unrelated
    ]);
    await killProcessTree(100, t.deps);
    expect(t.signals).toEqual(['SIGTERM -100', 'SIGTERM 102']);
    expect([...t.alive.keys()]).toEqual([200]);
  });

  it('escalates to SIGKILL when the tree outlives the grace period', async () => {
    const t = table([
      { pid: 100, ppid: 1, pgid: 100 },
      { pid: 101, ppid: 100, pgid: 100, ignoresTerm: true },
    ]);
    await killProcessTree(100, t.deps, { graceMs: 300, pollMs: 100 });
    // 101 is still alive after the group SIGTERM, so it is signalled directly too; harmless.
    expect(t.signals).toEqual(['SIGTERM -100', 'SIGTERM 101', 'SIGKILL -100']);
    expect(t.alive.size).toBe(0);
  });

  it('signals a PID that leads no group directly (a foreign process from the Ports page)', async () => {
    const t = table([{ pid: 300, ppid: 1, pgid: 1 }]);
    await killProcessTree(300, t.deps);
    expect(t.signals).toEqual(['SIGTERM -300', 'SIGTERM 300']);
    expect(t.alive.size).toBe(0);
  });

  it('treats a process that is already gone as stopped', async () => {
    const t = table([]);
    await expect(killProcessTree(999, t.deps)).resolves.toBeUndefined();
  });

  it('is FORBIDDEN for a process of another user', async () => {
    const t = table([{ pid: 400, ppid: 1, pgid: 1 }], { eperm: [400] });
    await expect(killProcessTree(400, t.deps)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
