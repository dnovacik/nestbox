// Background dependency checks on the user's schedule (off by default), and "Check all now" from the
// Dependencies page. Projects are checked one at a time through the tool host, like a click on Check.
import type { DepsSchedule } from '@shared/types';
import type { Logger } from '../../logger';

export const SCHEDULE_MS: Record<Exclude<DepsSchedule, 'off'>, number> = {
  daily: 24 * 3_600_000,
  weekly: 7 * 24 * 3_600_000,
};
const TICK_MS = 3_600_000;
const FIRST_TICK_MS = 60_000;

export interface DepsSchedulerDeps {
  rootIds(): Promise<string[]>;
  schedule(): DepsSchedule;
  /** When the root project was last checked; null when never. */
  lastChecked(rootId: string): number | null;
  check(rootId: string): Promise<void>;
  /** A run started or finished (the page shows "Checking…"). */
  onChange(): void;
  logger: Logger;
  now?: () => number;
}

export interface DepsScheduler {
  start(): void;
  stop(): void;
  /** Checks the projects that are due (the hourly tick); a no-op while the schedule is off. */
  tick(): Promise<void>;
  /** Checks every project now, whatever the schedule. Returns at once if a run is going. */
  runAll(): Promise<void>;
  running(): boolean;
}

export function createDepsScheduler(deps: DepsSchedulerDeps): DepsScheduler {
  const now = deps.now ?? Date.now;
  let busy = false;
  let first: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function run(ids: string[]): Promise<void> {
    if (busy || ids.length === 0) return;
    busy = true;
    deps.onChange();
    try {
      for (const id of ids) {
        try {
          await deps.check(id);
        } catch (error) {
          // A check already running for the project, or a project removed meanwhile: skip it.
          deps.logger.warn('deps scheduled check skipped', {
            projectId: id,
            code: (error as { code?: string }).code ?? 'unknown',
          });
        }
      }
    } finally {
      busy = false;
      deps.onChange();
    }
  }

  async function tick(): Promise<void> {
    const schedule = deps.schedule();
    if (schedule === 'off') return;
    const due = (await deps.rootIds()).filter((id) => {
      const last = deps.lastChecked(id);
      return last === null || now() - last >= SCHEDULE_MS[schedule];
    });
    await run(due);
  }

  return {
    start() {
      first = setTimeout(() => void tick(), FIRST_TICK_MS);
      timer = setInterval(() => void tick(), TICK_MS);
    },
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
    tick,
    runAll: async () => run(await deps.rootIds()),
    running: () => busy,
  };
}
