import type { ProcessInfo } from '../platform/adapter';
import type { LedgerEntry } from '../processes/pid-ledger';

/**
 * A process counts as part of a recorded script only if its OS creation time is this close to the
 * recorded spawn time (which is taken a few milliseconds after the root was created), or later.
 */
export const START_TIME_TOLERANCE_MS = 3_000;

export interface Orphan {
  entry: LedgerEntry;
  /** The process trees to stop: the root, or the children it left behind when it exited. */
  pids: number[];
}

/**
 * The recorded scripts that are still running. A PID alone proves nothing (Windows reuses them), so
 * entries without a recorded start time are never returned.
 *
 * The recorded root (`cmd.exe` on Windows, the package manager on macOS) can exit when NestBox dies while
 * what it started (npm, the server) keeps running. Those children still name the dead root as their parent, so when the root is
 * gone, its children that started after it are the orphans. When the root PID belongs to another
 * process now, its children are that process's, and are left alone.
 */
export function findOrphans(entries: readonly LedgerEntry[], processes: readonly ProcessInfo[]): Orphan[] {
  const orphans: Orphan[] = [];
  for (const entry of entries) {
    const recorded = entry.startTime;
    if (recorded === null) continue;
    const root = processes.find((p) => p.pid === entry.pid);
    if (root) {
      if (Math.abs(root.startTime - recorded) <= START_TIME_TOLERANCE_MS) orphans.push({ entry, pids: [entry.pid] });
      continue;
    }
    // Windows: the children still name the dead root as their parent. macOS: launchd adopted them, but they
    // are still in the process group the root led (its id is the root's PID, and can't be reused while it lives).
    const children = processes.filter(
      (p) => (p.parentPid === entry.pid || p.groupId === entry.pid) && p.startTime >= recorded - START_TIME_TOLERANCE_MS,
    );
    if (children.length > 0) orphans.push({ entry, pids: children.map((p) => p.pid) });
  }
  return orphans;
}
