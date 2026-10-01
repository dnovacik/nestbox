import type { LedgerEntry } from '../processes/pid-ledger';

/** A recorded process counts as the same process only if its start time matches this closely. */
export const START_TIME_TOLERANCE_MS = 1_000;

/**
 * The recorded processes that are still running as the same process. A PID alone proves nothing (Windows
 * reuses them), so entries without a recorded start time are never returned.
 */
export async function findOrphans(
  entries: readonly LedgerEntry[],
  startTimeOf: (pid: number) => Promise<number | null>,
): Promise<LedgerEntry[]> {
  const checks = await Promise.all(
    entries.map(async (entry) => {
      if (entry.startTime === null) return null;
      const now = await startTimeOf(entry.pid).catch(() => null);
      return now !== null && Math.abs(now - entry.startTime) <= START_TIME_TOLERANCE_MS ? entry : null;
    }),
  );
  return checks.filter((e): e is LedgerEntry => e !== null);
}
