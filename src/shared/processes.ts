import { z } from 'zod';
import { WORKSPACE_ID_SEPARATOR } from './detected';

export const PROCESS_STATES = ['starting', 'running', 'stopping', 'stopped', 'exited', 'crashed'] as const;
export type ProcessState = (typeof PROCESS_STATES)[number];

export const LogLineSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.number(),
  stream: z.enum(['stdout', 'stderr', 'system']),
  text: z.string(),
});
export type LogLine = z.infer<typeof LogLineSchema>;

export const LogSnapshotSchema = z.object({
  lines: z.array(LogLineSchema),
  /** seq of the first line held, or lastSeq + 1 when empty. */
  firstSeq: z.number().int().nonnegative(),
  /** Highest seq ever assigned for this script (0 = none). Survives a clear. */
  lastSeq: z.number().int().nonnegative(),
});
export type LogSnapshot = z.infer<typeof LogSnapshotSchema>;

export const ProcessSummarySchema = z.object({
  /** Root project id or workspace id. */
  projectId: z.string(),
  script: z.string(),
  state: z.enum(PROCESS_STATES),
  pid: z.number().int().nullable(),
  startedAt: z.number().nullable(),
  exit: z
    .object({ code: z.number().int().nullable(), signal: z.string().nullable(), lastLine: z.string().nullable() })
    .nullable(),
  /** Consecutive crashes; reset after a healthy minute or a user start. */
  crashCount: z.number().int().nonnegative(),
  autoRestart: z.boolean(),
  /** Set while waiting out the auto-restart backoff. */
  nextRestartAt: z.number().nullable(),
  /** Auto-restart stopped trying after too many crashes. */
  gaveUp: z.boolean(),
  /** The Node or package manager didn't match the requirement at start (the Node tool's advice). */
  warning: z.string().nullable(),
});
export type ProcessSummary = z.infer<typeof ProcessSummarySchema>;

/** What the tray, the sidebar dots and the overview show for a set of processes. */
export type AggregateState = 'crashed' | 'starting' | 'running' | 'idle';

/** Worst state first: crashed, then starting (or stopping), then running, else idle. */
export function aggregateState(states: Iterable<ProcessState>): AggregateState {
  let starting = false;
  let running = false;
  for (const state of states) {
    if (state === 'crashed') return 'crashed';
    if (state === 'starting' || state === 'stopping') starting = true;
    if (state === 'running') running = true;
  }
  return starting ? 'starting' : running ? 'running' : 'idle';
}

export function isLive(state: ProcessState): boolean {
  return state === 'starting' || state === 'running' || state === 'stopping';
}

/** True when processProjectId is projectId itself or one of its workspace packages. */
export function belongsTo(processProjectId: string, projectId: string): boolean {
  return processProjectId === projectId || processProjectId.startsWith(`${projectId}${WORKSPACE_ID_SEPARATOR}`);
}

/** Main → renderer: show a project tab (from the tray or a notification). */
export const NavigateSchema = z.object({
  projectId: z.string().min(1),
  tab: z.string().min(1),
  script: z.string().optional(),
});
export type Navigate = z.infer<typeof NavigateSchema>;

/** Most seqs a log export may name; a larger filtered export is refused in the renderer. */
export const MAX_EXPORT_SEQS = 100_000;
