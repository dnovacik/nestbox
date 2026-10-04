// Runs a package script to its end for "Run checks": started through the Scripts tool (so it is a normal
// ProcessManager script with its own log), then watched through ProcessManager's change events.
import { NestboxError } from '@shared/errors';
import type { ProcessState } from '@shared/processes';

/** How long one script of "Run checks" may run before it is stopped. */
export const READY_SCRIPT_TIMEOUT_MS = 15 * 60_000;

export interface ScriptRunResult {
  outcome: 'exited' | 'crashed' | 'stopped' | 'busy' | 'timeout' | 'failed';
  code: number | null;
}

interface Watchable {
  on(listener: (event: { type: string }) => void): () => void;
  get(): { state: ProcessState; exit: { code: number | null } | null } | null;
}

const ENDED: readonly ProcessState[] = ['exited', 'crashed', 'stopped'];

export async function waitForScript(opts: {
  processes: Watchable;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  timeoutMs: number;
}): Promise<ScriptRunResult> {
  try {
    await opts.start();
  } catch (error) {
    return {
      outcome: error instanceof NestboxError && error.code === 'CONFLICT' ? 'busy' : 'failed',
      code: null,
    };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ScriptRunResult) => {
      if (settled) return;
      settled = true;
      off();
      clearTimeout(timer);
      resolve(result);
    };
    const check = () => {
      const s = opts.processes.get();
      if (s && ENDED.includes(s.state))
        finish({ outcome: s.state as ScriptRunResult['outcome'], code: s.exit?.code ?? null });
    };
    const off = opts.processes.on((event) => {
      if (event.type === 'changed' || event.type === 'crashed') check();
    });
    const timer = setTimeout(() => {
      // Stopped for running too long: a timeout, whatever state the stop leaves behind.
      settled = true;
      off();
      void opts
        .stop()
        .catch(() => undefined)
        .then(() => resolve({ outcome: 'timeout', code: null }));
    }, opts.timeoutMs);
    // It may have ended before the subscription.
    check();
  });
}
