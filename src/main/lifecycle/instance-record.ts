import { z } from 'zod';

/**
 * Who holds the single-instance lock, written to `userData/instance.json` by the running instance.
 *
 * On Windows the lock is a file handle that the scripts NestBox spawns inherit (libuv spawns with
 * handle inheritance on). When NestBox is killed while scripts run, those orphans keep the lock and a
 * relaunch would quit at once. The record lets a relaunch tell a live instance from a stale lock.
 */
export interface InstanceRecord {
  pid: number;
  /** When the process started, in epoch ms. */
  startTime: number;
}

const RecordSchema = z.object({ pid: z.number().int().positive(), startTime: z.number() });

/** How far the recorded start time (taken by Node at startup) may be from the OS creation time. */
export const INSTANCE_START_TOLERANCE_MS = 10_000;

export function serializeInstanceRecord(record: InstanceRecord): string {
  return JSON.stringify(record);
}

export function parseInstanceRecord(text: string | null): InstanceRecord | null {
  if (!text) return null;
  try {
    const parsed = RecordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface InstanceCheckDeps {
  ownPid: number;
  isAlive(pid: number): boolean;
  startTimeOf(pid: number): Promise<number | null>;
}

/**
 * Whether the recorded instance is still running, so a launch that did not get the lock should quit.
 * False means the lock is stale. When the start time cannot be read, it assumes the instance runs.
 */
export async function otherInstanceRunning(record: InstanceRecord | null, deps: InstanceCheckDeps): Promise<boolean> {
  if (!record || record.pid === deps.ownPid || !deps.isAlive(record.pid)) return false;
  const started = await deps.startTimeOf(record.pid).catch(() => null);
  return started === null || Math.abs(started - record.startTime) <= INSTANCE_START_TOLERANCE_MS;
}
