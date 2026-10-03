// Stops a process tree on POSIX: SIGTERM to the process group NestBox created (scripts are group leaders)
// and to descendants that left it (daemonising dev servers), a grace period, then SIGKILL.
import { NestboxError } from '@shared/errors';
import type { ProcessInfo } from './adapter';

export interface KillDeps {
  /** process.kill semantics: throws with code ESRCH or EPERM. A negative PID signals a process group. */
  kill(pid: number, signal: NodeJS.Signals | 0): void;
  /** Every process with its parent; null when it can't be read. */
  list(): Promise<ProcessInfo[] | null>;
  sleep(ms: number): Promise<void>;
}

const codeOf = (error: unknown) => (error as { code?: unknown }).code;

function descendantsOf(pid: number, processes: readonly ProcessInfo[]): number[] {
  const children = new Map<number, number[]>();
  for (const p of processes) children.set(p.parentPid, [...(children.get(p.parentPid) ?? []), p.pid]);
  const out: number[] = [];
  const queue = [...(children.get(pid) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift() as number;
    if (out.includes(next)) continue;
    out.push(next);
    queue.push(...(children.get(next) ?? []));
  }
  return out;
}

export async function killProcessTree(
  pid: number,
  deps: KillDeps,
  { graceMs = 3_000, pollMs = 100 }: { graceMs?: number; pollMs?: number } = {},
): Promise<void> {
  // kill(-1) signals every process the user may signal, and kill(0) the caller's own group: never PIDs 0 or 1.
  if (!Number.isInteger(pid) || pid <= 1) throw new NestboxError('VALIDATION', 'Invalid process id');
  const descendants = descendantsOf(pid, (await deps.list()) ?? []);

  const isAlive = (target: number) => {
    try {
      deps.kill(target, 0);
      return true;
    } catch (error) {
      return codeOf(error) === 'EPERM';
    }
  };
  const groupAlive = () => {
    try {
      deps.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  /** Signals the group (or the PID itself when it leads none), then descendants outside it. */
  const send = (signal: NodeJS.Signals) => {
    let viaGroup = true;
    try {
      deps.kill(-pid, signal);
    } catch (error) {
      if (codeOf(error) === 'EPERM') throw new NestboxError('FORBIDDEN', 'This process belongs to another user');
      if (codeOf(error) !== 'ESRCH') throw error;
      viaGroup = false;
    }
    if (!viaGroup) {
      try {
        deps.kill(pid, signal);
      } catch (error) {
        if (codeOf(error) === 'EPERM') throw new NestboxError('FORBIDDEN', 'This process belongs to another user');
        if (codeOf(error) !== 'ESRCH') throw error;
      }
    }
    for (const d of descendants) {
      if (!isAlive(d)) continue;
      try {
        deps.kill(d, signal);
      } catch {
        // Gone in the meantime, or not ours: nothing more to do for it.
      }
    }
  };

  const anyAlive = () => isAlive(pid) || groupAlive() || descendants.some(isAlive);

  send('SIGTERM');
  for (let waited = 0; waited < graceMs && anyAlive(); waited += pollMs) await deps.sleep(pollMs);
  if (anyAlive()) send('SIGKILL');
}
