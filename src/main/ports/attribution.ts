import type { ProcessInfo } from '../platform/adapter';

/** Deep enough for cmd.exe → npm → cmd.exe → node → worker, with room to spare. */
const MAX_HOPS = 16;

/** Walks parent links from pid to the first PID in roots (pid itself included). Null after MAX_HOPS or a cycle. */
export function findOwnerRoot(pid: number, parents: ReadonlyMap<number, number>, roots: ReadonlySet<number>): number | null {
  const seen = new Set<number>();
  let current: number | undefined = pid;
  for (let hop = 0; current !== undefined && hop <= MAX_HOPS; hop++) {
    if (roots.has(current)) return current;
    if (seen.has(current)) return null;
    seen.add(current);
    current = parents.get(current);
  }
  return null;
}

interface Known {
  /** The NestBox root this PID belongs to, or null when none was found. */
  owner: number | null;
  /** The roots that existed when owner was resolved; a null owner is re-checked when new roots appear. */
  rootsAtResolve: ReadonlySet<number>;
  /** False when the process list could not be read: resolve again next refresh. */
  resolved: boolean;
  command: string | null;
}

export interface AttributionDeps {
  listProcesses(): Promise<ProcessInfo[] | null>;
  describe(pids: readonly number[]): Promise<Map<number, string | null>>;
}

/**
 * Which NestBox script owns each listening PID, and its command line. Both cost a PowerShell call on
 * Windows, so they are looked up only for PIDs not seen before (or when new scripts started), and kept
 * until the PID stops listening.
 */
export class AttributionCache {
  private readonly known = new Map<number, Known>();

  constructor(private readonly deps: AttributionDeps) {}

  async refresh(listening: readonly number[], roots: ReadonlySet<number>): Promise<void> {
    const live = new Set(listening);
    for (const pid of this.known.keys()) if (!live.has(pid)) this.known.delete(pid);

    const fresh = [...live].filter((pid) => !this.known.has(pid));
    const recheck = [...live].filter((pid) => {
      const k = this.known.get(pid);
      return k !== undefined && (!k.resolved || (k.owner === null && [...roots].some((r) => !k.rootsAtResolve.has(r))));
    });
    if (fresh.length === 0 && recheck.length === 0) return;

    const [table, commands] = await Promise.all([
      this.deps.listProcesses().catch(() => null),
      fresh.length > 0 ? this.deps.describe(fresh.slice(0, 64)).catch(() => new Map<number, string | null>()) : null,
    ]);
    const parents = new Map((table ?? []).map((p) => [p.pid, p.parentPid]));
    for (const pid of [...fresh, ...recheck]) {
      const previous = this.known.get(pid);
      this.known.set(pid, {
        owner: table ? findOwnerRoot(pid, parents, roots) : null,
        rootsAtResolve: new Set(roots),
        resolved: table !== null,
        command: previous?.command ?? commands?.get(pid) ?? null,
      });
    }
  }

  ownerRoot(pid: number): number | null {
    return this.known.get(pid)?.owner ?? null;
  }

  command(pid: number): string | null {
    return this.known.get(pid)?.command ?? null;
  }
}
