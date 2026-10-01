import type { Logger } from '../logger';
import type { ProcessInfo } from '../platform/adapter';
import type { PidLedger } from '../processes/pid-ledger';
import { findOrphans } from './orphans';

export interface OrphanPromptDeps {
  ledger: Pick<PidLedger, 'previous' | 'dropPrevious'>;
  listProcesses(): Promise<ProcessInfo[] | null>;
  killTree(pid: number): Promise<void>;
  /** Display label for a project or workspace id, or null when it is unknown. */
  projectLabel(projectId: string): string | null;
  /** Resolves true for "Stop them". */
  ask(message: string, detail: string): Promise<boolean>;
  logger: Logger;
}

/**
 * After NestBox itself crashed, offers to stop the scripts it left running (see findOrphans for how a
 * recorded script is matched to running processes). The previous session's entries are forgotten once the user
 * has answered; if the check itself fails they are kept, so it runs again next time.
 */
export async function handleOrphans(deps: OrphanPromptDeps): Promise<void> {
  try {
    const previous = deps.ledger.previous();
    if (previous.length === 0) {
      deps.ledger.dropPrevious();
      return;
    }
    const processes = await deps.listProcesses();
    // Without the list nothing can be decided: keep the entries for the next start.
    if (processes === null) throw new Error('process list unavailable');
    const orphans = findOrphans(previous, processes);
    deps.logger.info('orphan check', { recorded: previous.length, running: orphans.length });
    if (orphans.length > 0) {
      const n = orphans.length;
      const message = `${n} ${n === 1 ? 'script' : 'scripts'} from the last session ${n === 1 ? 'is' : 'are'} still running`;
      const detail = orphans
        .map((o) => `${deps.projectLabel(o.entry.projectId) ?? 'unknown project'} · ${o.entry.script} (PID ${o.pids.join(', ')})`)
        .join('\n');
      if (await deps.ask(message, detail)) {
        await Promise.all(
          orphans.flatMap((o) => o.pids).map((pid) =>
            deps.killTree(pid).catch(() => deps.logger.warn('orphan kill failed', { pid })),
          ),
        );
      }
    }
    deps.ledger.dropPrevious();
  } catch {
    deps.logger.error('orphan check failed');
  }
}
