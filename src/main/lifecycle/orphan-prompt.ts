import type { Logger } from '../logger';
import type { PidLedger } from '../processes/pid-ledger';
import { findOrphans } from './orphans';

export interface OrphanPromptDeps {
  ledger: Pick<PidLedger, 'previous' | 'dropPrevious'>;
  startTimeOf(pid: number): Promise<number | null>;
  killTree(pid: number): Promise<void>;
  /** Display label for a project or workspace id, or null when it is unknown. */
  projectLabel(projectId: string): string | null;
  /** Resolves true for "Stop them". */
  ask(message: string, detail: string): Promise<boolean>;
  logger: Logger;
}

/**
 * After Nestbox itself crashed, offers to stop the scripts it left running. Only processes whose start
 * time still matches the ledger are offered. The previous session's entries are forgotten once the user
 * has answered; if the check itself fails they are kept, so it runs again next time.
 */
export async function handleOrphans(deps: OrphanPromptDeps): Promise<void> {
  try {
    const previous = deps.ledger.previous();
    const orphans = await findOrphans(previous, deps.startTimeOf);
    if (previous.length > 0) {
      deps.logger.info('orphan check', { recorded: previous.length, running: orphans.length });
    }
    if (orphans.length > 0) {
      const n = orphans.length;
      const message = `${n} ${n === 1 ? 'script' : 'scripts'} from the last session ${n === 1 ? 'is' : 'are'} still running`;
      const detail = orphans
        .map((o) => `${deps.projectLabel(o.projectId) ?? 'unknown project'} · ${o.script} (PID ${o.pid})`)
        .join('\n');
      if (await deps.ask(message, detail)) {
        await Promise.all(
          orphans.map((o) =>
            deps.killTree(o.pid).catch(() => deps.logger.warn('orphan kill failed', { pid: o.pid })),
          ),
        );
      }
    }
    deps.ledger.dropPrevious();
  } catch {
    deps.logger.error('orphan check failed');
  }
}
