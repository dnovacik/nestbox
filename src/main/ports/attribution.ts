import type { ProcessInfo } from '../platform/adapter';

/** Deep enough for cmd.exe → npm → cmd.exe → node → worker, with room to spare. */
const MAX_HOPS = 16;

/** Start times are read from the OS with millisecond-ish precision; allow a little skew between parent and child. */
const START_SKEW_MS = 1_000;

/**
 * Walks parent links from pid to the first PID in roots (pid itself included). Windows keeps a dead
 * parent's PID in its children and reuses PIDs, so a link only counts when the parent started before
 * the child. Null after MAX_HOPS, a cycle, or a link that fails that check.
 */
export function findOwnerRoot(
  pid: number,
  table: ReadonlyMap<number, { parentPid: number; startTime: number }>,
  roots: ReadonlySet<number>,
): number | null {
  const seen = new Set<number>();
  let current = pid;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (roots.has(current)) return current;
    if (seen.has(current)) return null;
    seen.add(current);
    const me = table.get(current);
    const parent = me ? table.get(me.parentPid) : undefined;
    if (!me || !parent || parent.startTime > me.startTime + START_SKEW_MS) return null;
    current = me.parentPid;
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
  /** The command line was asked for (and answered, possibly with null). */
  commandRead: boolean;
}

export interface AttributionDeps {
  listProcesses(): Promise<ProcessInfo[] | null>;
  describe(pids: readonly number[]): Promise<Map<number, string | null>>;
  now?(): number;
}

/** describeProcesses takes at most this many PIDs per call; the rest wait for the next refresh. */
const DESCRIBE_BATCH = 64;
/** After a failed command-line lookup, wait this long before asking again (PowerShell may be blocked). */
const DESCRIBE_RETRY_MS = 30_000;

/**
 * Which NestBox script owns each listening PID, and its command line. Both cost a PowerShell call on
 * Windows, so they are looked up only for PIDs not seen before (or when new scripts started), and kept
 * until the PID stops listening.
 */
export class AttributionCache {
  private readonly known = new Map<number, Known>();
  private describeRetryAt = 0;

  constructor(private readonly deps: AttributionDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  async refresh(listening: readonly number[], roots: ReadonlySet<number>): Promise<void> {
    const live = new Set(listening);
    for (const pid of this.known.keys()) if (!live.has(pid)) this.known.delete(pid);

    const fresh = [...live].filter((pid) => !this.known.has(pid));
    const recheck = [...live].filter((pid) => {
      const k = this.known.get(pid);
      return k !== undefined && (!k.resolved || (k.owner === null && [...roots].some((r) => !k.rootsAtResolve.has(r))));
    });
    const needCommand = [...live]
      .filter((pid) => pid > 0 && !this.known.get(pid)?.commandRead)
      .slice(0, DESCRIBE_BATCH);
    const wantTable = fresh.length > 0 || recheck.length > 0;
    const wantDescribe = needCommand.length > 0 && this.now() >= this.describeRetryAt;
    if (!wantTable && !wantDescribe) return;

    const [table, commands] = await Promise.all([
      wantTable ? this.deps.listProcesses().catch(() => null) : null,
      wantDescribe ? this.deps.describe(needCommand).catch(() => null) : null,
    ]);
    if (wantDescribe && commands === null) this.describeRetryAt = this.now() + DESCRIBE_RETRY_MS;

    if (wantTable) {
      const byPid = new Map((table ?? []).map((p) => [p.pid, p]));
      for (const pid of [...fresh, ...recheck]) {
        const previous = this.known.get(pid);
        this.known.set(pid, {
          owner: table ? findOwnerRoot(pid, byPid, roots) : null,
          rootsAtResolve: new Set(roots),
          resolved: table !== null,
          command: previous?.command ?? null,
          commandRead: previous?.commandRead ?? false,
        });
      }
    }
    if (commands) {
      for (const pid of needCommand) {
        const k = this.known.get(pid);
        if (k) this.known.set(pid, { ...k, command: commands.get(pid) ?? null, commandRead: true });
      }
    }
  }

  ownerRoot(pid: number): number | null {
    return this.known.get(pid)?.owner ?? null;
  }

  command(pid: number): string | null {
    return this.known.get(pid)?.command ?? null;
  }
}
